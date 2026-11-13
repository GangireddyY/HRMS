import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Op, UniqueConstraintError, fn, col, where as sqlWhere, type Transaction } from 'sequelize';
import { DEVICE_BATCH_MAX, type PunchDirection } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { RequestContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { addDays } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { AttendanceDevice, AttendanceOvertime, AttendancePunch, AttendanceRecord, Employee, Location, Organization } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { AccessService } from '../rbac/access.service';
import { AttendanceRulesService } from './attendance-rules.service';
import type { DevicePunchesDto, DeviceDto, UpdateDeviceDto } from './dto/attendance.dto';
import { OvertimeService } from './overtime.service';

const KEY = /^hrmsd_([0-9a-f]{12})_([A-Za-z0-9_-]{32})$/;
/** Employee-days rebuilt per transaction when a batch is folded into records. */
const FOLD_CHUNK = 100;
const hash = (key: string) => createHash('sha256').update(key).digest('hex');

function newKey() {
  const prefix = randomBytes(6).toString('hex');
  const key = `hrmsd_${prefix}_${randomBytes(24).toString('base64url')}`;
  return { prefix, key, hash: hash(key) };
}

interface PunchResult {
  received: number;
  accepted: number;
  duplicates: number;
  unknownUsers: string[];
  skipped: { userCode: string; timestamp: string; reason: string }[];
}

/**
 * Biometric / RFID devices (`attendance.configure`). Each device has its own API key (shown once; only a hash is
 * kept) and pushes punches to `POST /attendance/device/punches`. Punches are matched to employees by their biometric
 * code (or employee code), stored once (duplicates are ignored) and folded into the day's record: the earliest punch
 * is the punch-in, the latest the punch-out (or as the device says), on the work date of the employee's shift.
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly rules: AttendanceRulesService,
    private readonly overtime: OvertimeService,
  ) {}

  async list() {
    const devices = await AttendanceDevice.findAll({ order: [['name', 'ASC']] });
    const locations = new Map((await Location.findAll({ where: { id: devices.map((d) => d.locationId).filter((x): x is string => !!x) }, attributes: ['id', 'name'] })).map((l) => [l.id, l.name]));
    const since = new Date(Date.now() - 86_400_000);
    const counts = devices.length
      ? ((await AttendancePunch.findAll({
          attributes: ['deviceId', [fn('COUNT', col('id')), 'count']],
          where: { deviceId: devices.map((d) => d.id), createdAt: { [Op.gte]: since } },
          group: ['deviceId'],
          raw: true,
        })) as unknown as { deviceId: string; count: string }[])
      : [];
    const byDevice = new Map(counts.map((c) => [c.deviceId, Number(c.count)]));
    return devices.map((d) => ({ ...this.present(d), location: d.locationId ? { id: d.locationId, name: locations.get(d.locationId) ?? '' } : null, punchesLast24h: byDevice.get(d.id) ?? 0 }));
  }

  async create(auth: AuthContext, dto: DeviceDto) {
    await this.checkLocation(dto.locationId);
    const k = newKey();
    const device = await this.guard(() =>
      this.db.transaction(async (transaction) => {
        const d = await AttendanceDevice.create(
          {
            organizationId: auth.organizationId!,
            name: dto.name,
            locationId: dto.locationId ?? null,
            serialNumber: dto.serialNumber ?? null,
            keyPrefix: k.prefix,
            keyHash: k.hash,
            createdById: auth.userId,
          },
          { transaction },
        );
        await this.audit.record({ action: 'attendance.device_added', entityType: 'AttendanceDevice', entityId: d.id, summary: `Device "${d.name}" added` }, transaction);
        return d;
      }),
    );
    return { ...this.present(device), apiKey: k.key };
  }

  async update(auth: AuthContext, id: string, dto: UpdateDeviceDto) {
    const d = await this.find(id);
    if (dto.locationId !== undefined) await this.checkLocation(dto.locationId);
    await this.guard(() =>
      this.db.transaction(async (transaction) => {
        await d.update(
          {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.locationId !== undefined ? { locationId: dto.locationId } : {}),
            ...(dto.serialNumber !== undefined ? { serialNumber: dto.serialNumber } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          },
          { transaction },
        );
        await this.audit.record(
          {
            action: dto.isActive === false ? 'attendance.device_deactivated' : 'attendance.device_updated',
            entityType: 'AttendanceDevice',
            entityId: id,
            summary: `Device "${d.name}" ${dto.isActive === false ? 'deactivated' : 'updated'}`,
          },
          transaction,
        );
      }),
    );
    return this.present(d);
  }

  /** A new key; the old one stops working immediately. */
  async rotateKey(id: string) {
    const d = await this.find(id);
    const k = newKey();
    await this.db.transaction(async (transaction) => {
      await d.update({ keyPrefix: k.prefix, keyHash: k.hash }, { transaction });
      await this.audit.record({ action: 'attendance.device_key_rotated', entityType: 'AttendanceDevice', entityId: id, summary: `New API key for device "${d.name}"` }, transaction);
    });
    return { ...this.present(d), apiKey: k.key };
  }

  async remove(id: string) {
    const d = await this.find(id);
    if (await AttendancePunch.count({ where: { deviceId: id } })) throw AppError.conflict('This device has sent punches. Deactivate it instead.');
    await this.db.transaction(async (transaction) => {
      await d.destroy({ transaction });
      await this.audit.record({ action: 'attendance.device_deleted', entityType: 'AttendanceDevice', entityId: id, summary: `Device "${d.name}" deleted` }, transaction);
    });
  }

  async setBiometricCode(auth: AuthContext, employeeId: string, code: string | null) {
    const employee = await Employee.findByPk(employeeId, { attributes: ['id', 'organizationId', 'employeeCode', 'biometricCode'] });
    if (!employee) throw AppError.notFound('Employee');
    try {
      await this.db.transaction(async (transaction) => {
        await employee.update({ biometricCode: code, updatedById: auth.userId }, { transaction });
        await this.audit.record(
          { action: 'attendance.biometric_code_set', entityType: 'Employee', entityId: employeeId, summary: `Device user number of ${employee.employeeCode} ${code ? `set to ${code}` : 'removed'}` },
          transaction,
        );
      });
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.validation([{ field: 'biometricCode', message: 'Another employee already has this device user number' }]);
      throw e;
    }
    return { employeeId, biometricCode: employee.biometricCode };
  }

  // ---- Push API (device key, no user session) ----------------------------------------------------

  async ingest(apiKey: string | undefined, dto: DevicePunchesDto): Promise<PunchResult> {
    const m = apiKey ? KEY.exec(apiKey) : null;
    if (!m) throw new AppError('UNAUTHENTICATED', 'A valid device key is required (X-Device-Key)');
    const device = await AttendanceDevice.findOne({ where: { keyPrefix: m[1] }, skipTenantScope: true });
    const expected = Buffer.from(device?.keyHash ?? '0'.repeat(64), 'hex');
    const actual = Buffer.from(hash(apiKey!), 'hex');
    if (!device || !timingSafeEqual(expected, actual)) throw new AppError('UNAUTHENTICATED', 'A valid device key is required (X-Device-Key)');
    if (!device.isActive) throw AppError.forbidden('This device has been deactivated');
    const org = await Organization.findByPk(device.organizationId, { attributes: ['id', 'status'] });
    if (org?.status !== 'ACTIVE') throw AppError.forbidden('The organization is not active');
    if (!(await this.access.entitlements(org.id)).has('attendance')) throw AppError.forbidden('Attendance is not enabled for this organization');
    if (dto.punches.length > DEVICE_BATCH_MAX) throw AppError.validation([{ field: 'punches', message: `Send at most ${DEVICE_BATCH_MAX} punches at a time` }]);
    const store = RequestContext.get();
    return RequestContext.runForTenant(org.id, () => this.process(device, dto), { requestId: store?.requestId, ipAddress: store?.ipAddress, userAgent: store?.userAgent });
  }

  private async process(device: AttendanceDevice, dto: DevicePunchesDto): Promise<PunchResult> {
    const result: PunchResult = { received: dto.punches.length, accepted: 0, duplicates: 0, unknownUsers: [], skipped: [] };
    await device.update({ lastSeenAt: new Date() });
    const codes = [...new Set(dto.punches.map((p) => p.userCode.trim().toLowerCase()))];
    const employees = codes.length
      ? await Employee.findAll({
          where: { status: ['ACTIVE', 'ON_NOTICE'], [Op.or]: [sqlWhere(fn('lower', col('biometric_code')), { [Op.in]: codes }), sqlWhere(fn('lower', col('employee_code')), { [Op.in]: codes })] },
          attributes: ['id', 'organizationId', 'employeeCode', 'biometricCode', 'shiftId', 'locationId', 'dateOfJoining', 'exitDate'],
        })
      : [];
    const byCode = new Map<string, Employee>();
    for (const e of employees) byCode.set(e.employeeCode.toLowerCase(), e);
    for (const e of employees) if (e.biometricCode) byCode.set(e.biometricCode.toLowerCase(), e);

    const now = Date.now();
    const valid: { employee: Employee; at: Date; direction: PunchDirection; userCode: string; timestamp: string }[] = [];
    for (const p of dto.punches) {
      const employee = byCode.get(p.userCode.trim().toLowerCase());
      if (!employee) {
        if (!result.unknownUsers.includes(p.userCode)) result.unknownUsers.push(p.userCode);
        continue;
      }
      const at = new Date(p.timestamp);
      if (Number.isNaN(at.getTime())) result.skipped.push({ userCode: p.userCode, timestamp: p.timestamp, reason: 'Unreadable time' });
      else if (at.getTime() > now + 5 * 60_000) result.skipped.push({ userCode: p.userCode, timestamp: p.timestamp, reason: 'In the future' });
      else if (at.getTime() < now - 60 * 86_400_000) result.skipped.push({ userCode: p.userCode, timestamp: p.timestamp, reason: 'Older than 60 days' });
      else valid.push({ employee, at, direction: p.direction ?? 'AUTO', userCode: p.userCode, timestamp: p.timestamp });
    }
    if (!valid.length) return result;

    const times = valid.map((v) => v.at.toISOString().slice(0, 10)).sort();
    const contexts = await this.rules.contexts(device.organizationId, [...new Set(valid.map((v) => v.employee))], { from: addDays(times[0]!, -1), to: times[times.length - 1]! });
    const closed = new Map<string, boolean>();
    const rows: { employeeId: string; punchedAt: string; direction: PunchDirection; workDate: string }[] = [];
    const byId = new Map<string, Employee>();
    for (const v of valid.sort((a, b) => a.at.getTime() - b.at.getTime())) {
      const ctx = contexts.get(v.employee.id)!;
      const workDate = this.rules.workDateOf(v.at, ctx);
      if (workDate < v.employee.dateOfJoining || (v.employee.exitDate && workDate > v.employee.exitDate)) {
        result.skipped.push({ userCode: v.userCode, timestamp: v.timestamp, reason: 'Not employed on this day' });
        continue;
      }
      const month = workDate.slice(0, 7);
      if (!closed.has(month)) closed.set(month, await this.rules.isClosed(workDate));
      if (closed.get(month)) {
        result.skipped.push({ userCode: v.userCode, timestamp: v.timestamp, reason: `Attendance for ${month} is closed` });
        continue;
      }
      rows.push({ employeeId: v.employee.id, punchedAt: v.at.toISOString(), direction: v.direction, workDate });
      byId.set(v.employee.id, v.employee);
    }
    if (!rows.length) return result;

    // One statement for the batch; punches already stored (same employee and instant) are skipped.
    const [inserted] = (await this.db.sequelize.query(
      `INSERT INTO attendance_punches (id, organization_id, employee_id, device_id, punched_at, direction, work_date)
       SELECT gen_random_uuid(), :organizationId, x.employee_id, :deviceId, x.punched_at, x.direction, x.work_date
         FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS x(employee_id uuid, punched_at timestamptz, direction text, work_date date)
       ON CONFLICT (employee_id, punched_at) DO NOTHING
       RETURNING employee_id AS "employeeId", to_char(work_date, 'YYYY-MM-DD') AS "workDate"`,
      { replacements: { organizationId: device.organizationId, deviceId: device.id, rows: JSON.stringify(rows.map((r) => ({ employee_id: r.employeeId, punched_at: r.punchedAt, direction: r.direction, work_date: r.workDate }))) } },
    )) as [{ employeeId: string; workDate: string }[], unknown];
    result.accepted = inserted.length;
    result.duplicates += rows.length - inserted.length;

    const touched = new Map<string, { employee: Employee; workDate: string }>();
    for (const r of inserted) touched.set(`${r.employeeId}:${r.workDate}`, { employee: byId.get(r.employeeId)!, workDate: r.workDate });
    if (!touched.size) return result;
    const dates = [...new Set([...touched.values()].map((t) => t.workDate))].sort();
    const calendar = await this.rules.holidays(dates[0]!, dates[dates.length - 1]!);
    const pairs = [...touched.values()];
    for (let i = 0; i < pairs.length; i += FOLD_CHUNK) {
      await this.db.transaction((transaction) => this.fold(device, pairs.slice(i, i + FOLD_CHUNK), contexts, calendar, transaction));
    }
    return result;
  }

  /**
   * Rebuilds the records of the days that got new punches: the earliest punch is the punch-in, the latest the
   * punch-out (or as the device says). Records are locked in a fixed order so concurrent batches can't deadlock.
   */
  private async fold(
    device: AttendanceDevice,
    pairs: { employee: Employee; workDate: string }[],
    contexts: Awaited<ReturnType<AttendanceRulesService['contexts']>>,
    calendar: Awaited<ReturnType<AttendanceRulesService['holidays']>>,
    transaction: Transaction,
  ): Promise<void> {
    const employeeId = [...new Set(pairs.map((p) => p.employee.id))];
    const workDate = [...new Set(pairs.map((p) => p.workDate))];
    const key = (r: { employeeId: string; workDate: string }) => `${r.employeeId}:${r.workDate}`;
    const records = new Map(
      (await AttendanceRecord.findAll({ where: { employeeId, workDate }, order: [['employeeId', 'ASC'], ['workDate', 'ASC']], transaction, lock: transaction.LOCK.UPDATE })).map((r) => [key(r), r]),
    );
    const punchesOf = new Map<string, AttendancePunch[]>();
    for (const p of await AttendancePunch.findAll({ where: { employeeId, workDate }, order: [['punchedAt', 'ASC']], transaction })) {
      const list = punchesOf.get(key(p)) ?? [];
      list.push(p);
      punchesOf.set(key(p), list);
    }
    const overtime = new Map((await AttendanceOvertime.findAll({ where: { employeeId, workDate }, transaction })).map((o) => [key(o), o]));

    for (const { employee, workDate: day } of pairs) {
      const k = `${employee.id}:${day}`;
      const ctx = contexts.get(employee.id)!;
      const punches = punchesOf.get(k) ?? [];
      const record = records.get(k) ?? null;
      const ins = punches.filter((p) => p.direction !== 'OUT').map((p) => p.punchedAt);
      const outs = punches.filter((p) => p.direction === 'OUT').map((p) => p.punchedAt);
      const autos = punches.filter((p) => p.direction === 'AUTO').map((p) => p.punchedAt);
      const candidatesIn = [...ins, ...(record?.checkInAt ? [record.checkInAt] : [])];
      const checkInAt = candidatesIn.length ? new Date(Math.min(...candidatesIn.map((d) => d.getTime()))) : null;
      if (!checkInAt) continue;
      // With AUTO punches, the latest one is the punch-out once there is more than one punch on the day.
      const candidatesOut = [...outs, ...(autos.length > 1 || (autos.length && record?.checkInAt) ? autos : []), ...(record?.checkOutAt ? [record.checkOutAt] : [])].filter(
        (d) => d.getTime() - checkInAt.getTime() >= 60_000,
      );
      const checkOutAt = candidatesOut.length ? new Date(Math.max(...candidatesOut.map((d) => d.getTime()))) : null;
      const outcome = await this.rules.evaluate(ctx, day, checkInAt, checkOutAt, transaction, calendar);
      const values = { ...outcome, checkInAt, checkOutAt, deviceId: device.id, source: 'DEVICE' as const };
      const saved = record
        ? await record.update(values, { transaction })
        : await AttendanceRecord.create({ ...values, organizationId: device.organizationId, employeeId: employee.id, workDate: day }, { transaction });
      await this.overtime.sync(saved, transaction, overtime.get(k) ?? null);
    }
  }

  // ---- Internals --------------------------------------------------------------------------------

  private async find(id: string) {
    const d = await AttendanceDevice.findByPk(id);
    if (!d) throw AppError.notFound('Device');
    return d;
  }

  private async checkLocation(locationId: string | null | undefined) {
    if (locationId && !(await Location.count({ where: { id: locationId } }))) throw AppError.validation([{ field: 'locationId', message: 'Choose one of your locations' }]);
  }

  private present(d: AttendanceDevice) {
    return {
      id: d.id,
      name: d.name,
      locationId: d.locationId,
      serialNumber: d.serialNumber,
      keyHint: `hrmsd_${d.keyPrefix}_…`,
      isActive: d.isActive,
      lastSeenAt: d.lastSeenAt,
      createdAt: d.createdAt,
    };
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.validation([{ field: 'name', message: 'A device with this name already exists' }]);
      throw e;
    }
  }
}
