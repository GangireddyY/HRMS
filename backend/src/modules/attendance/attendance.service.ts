import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Op, type WhereOptions } from 'sequelize';
import { PUNCH_PHOTO_MAX_BYTES, type DayStatus } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { ipAllowed, normalizeIp } from '../../common/utils/networks';
import { minutesToTime, monthRange } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { AttendanceOvertime, AttendanceRecord, AttendanceRegularization, Department, Designation, Employee, Location } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { AttendanceRulesService, OPEN_PUNCH_HOURS, distanceMetres, type EffectiveShift, type EmployeeContext } from './attendance-rules.service';
import type { CalendarQueryDto, DailyQueryDto, PunchDto, UpsertRecordDto } from './dto/attendance.dto';
import { OvertimeService } from './overtime.service';
import { fullName } from '../../common/utils/names';

const EMPLOYEE_ATTRS = [
  'id',
  'organizationId',
  'employeeCode',
  'firstName',
  'lastName',
  'status',
  'dateOfJoining',
  'exitDate',
  'shiftId',
  'locationId',
  'managerId',
  'departmentId',
  'membershipId',
  'biometricCode',
];

export function presentRecord(r: AttendanceRecord | undefined | null) {
  if (!r) return null;
  return {
    id: r.id,
    workDate: r.workDate,
    checkInAt: r.checkInAt,
    checkOutAt: r.checkOutAt,
    workedMinutes: r.workedMinutes,
    lateMinutes: r.lateMinutes,
    overtimeMinutes: r.overtimeMinutes,
    status: r.status,
    source: r.source,
    workMode: r.workMode,
    note: r.note,
    hasPhoto: !!r.checkInPhotoKey,
  };
}

const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** A `data:image/...;base64,` photo from the camera: its bytes and type, or a validation error. */
export function decodePunchPhoto(dataUrl: string): { data: Buffer; contentType: string; ext: string } {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw AppError.validation([{ field: 'photo', message: 'The photo must be a JPEG, PNG or WebP image' }]);
  const data = Buffer.from(m[2]!, 'base64');
  if (!data.length) throw AppError.validation([{ field: 'photo', message: 'The photo is empty' }]);
  if (data.length > PUNCH_PHOTO_MAX_BYTES) throw AppError.validation([{ field: 'photo', message: `The photo is too large (up to ${Math.round(PUNCH_PHOTO_MAX_BYTES / 1000)} KB)` }]);
  const jpeg = data[0] === 0xff && data[1] === 0xd8;
  const png = data.subarray(0, 4).toString('hex') === '89504e47';
  const webp = data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!(jpeg || png || webp)) throw AppError.validation([{ field: 'photo', message: "The photo isn't a valid image" }]);
  return { data, contentType: m[1]!, ext: PHOTO_TYPES[m[1]!]! };
}

function shiftSummary(shift: EffectiveShift) {
  return {
    name: shift.name,
    startTime: minutesToTime(shift.startMinutes),
    endTime: minutesToTime(shift.endMinutes),
    crossesMidnight: shift.crossesMidnight,
    graceMinutes: shift.graceMinutes,
    fullDayMinutes: shift.fullDayMinutes,
    halfDayMinutes: shift.halfDayMinutes,
    weeklyOffs: shift.weeklyOffs,
    overtimeEnabled: shift.overtimeEnabled,
  };
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly rules: AttendanceRulesService,
    private readonly overtime: OvertimeService,
    private readonly storage: StorageService,
  ) {}

  // ---- Self-service ----------------------------------------------------------------------------

  async today(auth: AuthContext, ip?: string) {
    const self = await this.scope.self(auth);
    if (!self) return { employee: null };
    const ctx = await this.rules.context(auth.organizationId!, self);
    const now = new Date();
    const date = this.rules.today(ctx.timeZone, now);
    const [record, open, holidays, closed, wfh, location] = await Promise.all([
      AttendanceRecord.findOne({ where: { employeeId: self.id, workDate: date } }),
      this.findOpen(self.id, now),
      this.rules.holidays(date, date),
      this.rules.isClosed(date),
      this.rules.workFromHomeDays([self.id], date, date),
      self.locationId ? Location.findByPk(self.locationId, { attributes: ['id', 'name', 'latitude', 'longitude', 'geofenceRadiusM', 'allowedNetworks', 'punchPhotoRequired'] }) : null,
    ]);
    const holiday = holidays.on(date, ctx.locationId);
    const workFromHome = !!wfh.get(self.id)?.has(date);
    return {
      employee: { id: self.id, name: fullName(self), employeeCode: self.employeeCode, status: self.status },
      date,
      timeZone: ctx.timeZone,
      shift: shiftSummary(this.rules.shiftOn(ctx, date)),
      rostered: !!this.rules.rosterOn(ctx, date),
      holiday: holiday ? { name: holiday.name, isOptional: holiday.isOptional } : null,
      isWeeklyOff: this.rules.isRestDay(ctx, date),
      workFromHome,
      geofence: location?.geofenceRadiusM && !workFromHome ? { location: location.name, radiusMetres: location.geofenceRadiusM } : null,
      officeNetwork: location?.allowedNetworks?.length && !workFromHome ? { location: location.name, onNetwork: ipAllowed(ip, location.allowedNetworks) } : null,
      photoRequired: !!location?.punchPhotoRequired,
      record: presentRecord(record),
      openRecord: presentRecord(open),
      periodClosed: closed,
      serverTime: now,
    };
  }

  async punchIn(auth: AuthContext, dto: PunchDto, ip: string | undefined) {
    const self = await this.requireSelf(auth);
    const ctx = await this.rules.context(auth.organizationId!, self);
    const now = new Date();
    const date = this.rules.today(ctx.timeZone, now);
    const open = await this.findOpen(self.id, now);
    if (open) throw AppError.conflict(`You are already punched in since ${this.localTime(open.checkInAt!, ctx)}. Punch out first.`);
    await this.rules.assertOpen(date);
    const existing = await AttendanceRecord.findOne({ where: { employeeId: self.id, workDate: date } });
    if (existing?.checkInAt) throw AppError.conflict(`You already recorded attendance today (in at ${this.localTime(existing.checkInAt, ctx)}). Ask for a regularization if it is wrong.`);
    const workFromHome = !!(await this.rules.workFromHomeDays([self.id], date, date)).get(self.id)?.has(date);
    const location = self.locationId ? await Location.findByPk(self.locationId, { attributes: ['name', 'allowedNetworks', 'punchPhotoRequired'] }) : null;
    if (!workFromHome) {
      await this.checkGeofence(self, dto);
      if (location?.allowedNetworks?.length && !ipAllowed(ip, location.allowedNetworks)) {
        throw AppError.validation([{ field: 'network', message: `Punch in from the ${location.name} office network${ip ? ` (you're on ${normalizeIp(ip)})` : ''}, or ask to work from home.` }]);
      }
    }
    const photo = dto.photo ? decodePunchPhoto(dto.photo) : null;
    if (location?.punchPhotoRequired && !photo) throw AppError.validation([{ field: 'photo', message: `${location.name} needs a photo with every punch-in. Allow the camera and try again.` }]);
    const outcome = await this.rules.evaluate(ctx, date, now, null);
    const photoKey = photo ? `organizations/${auth.organizationId}/attendance/${self.id}/${date}-${randomUUID()}.${photo.ext}` : null;
    if (photo) await this.storage.put(photoKey!, photo.data, photo.contentType);
    try {
      await AttendanceRecord.create({
        organizationId: auth.organizationId!,
        employeeId: self.id,
        workDate: date,
        shiftId: outcome.shiftId,
        checkInAt: now,
        lateMinutes: outcome.lateMinutes,
        source: 'WEB',
        workMode: workFromHome ? 'REMOTE' : 'OFFICE',
        checkInIp: ip ?? null,
        checkInLatitude: dto.latitude === undefined ? null : String(dto.latitude),
        checkInLongitude: dto.longitude === undefined ? null : String(dto.longitude),
        checkInPhotoKey: photoKey,
        updatedById: auth.userId,
      });
    } catch (e) {
      if (photoKey) await this.storage.deleteQuietly([photoKey]);
      throw e;
    }
    return this.today(auth, ip);
  }

  /** The punch-in photo of a record: the employee's own, or within `attendance.view` scope. */
  async photo(auth: AuthContext, recordId: string) {
    const record = await AttendanceRecord.findByPk(recordId, { attributes: ['id', 'employeeId', 'workDate', 'checkInPhotoKey'] });
    if (!record?.checkInPhotoKey) throw AppError.notFound('Photo');
    const employee = await Employee.findByPk(record.employeeId, { attributes: EMPLOYEE_ATTRS });
    const self = await this.scope.self(auth);
    if (!employee || (self?.id !== employee.id && !(await this.scope.covers(auth, 'attendance.view', employee)))) throw AppError.notFound('Photo');
    const ext = record.checkInPhotoKey.split('.').pop()!;
    const contentType = Object.entries(PHOTO_TYPES).find(([, e]) => e === ext)?.[0] ?? 'image/jpeg';
    return { stream: await this.storage.get(record.checkInPhotoKey), contentType, fileName: `punch-${record.workDate}.${ext}` };
  }

  async punchOut(auth: AuthContext, ip: string | undefined) {
    const self = await this.requireSelf(auth);
    const ctx = await this.rules.context(auth.organizationId!, self);
    const now = new Date();
    const open = await this.findOpen(self.id, now);
    if (!open) throw AppError.conflict("You haven't punched in yet.");
    await this.rules.assertOpen(open.workDate);
    await this.db.transaction(async (transaction) => {
      const outcome = await this.rules.evaluate(ctx, open.workDate, open.checkInAt!, now, transaction);
      await open.update({ checkOutAt: now, checkOutIp: ip ?? null, ...outcome, updatedById: auth.userId }, { transaction });
      await this.overtime.sync(open, transaction);
    });
    return this.today(auth, ip);
  }

  // ---- Calendars & registers -------------------------------------------------------------------

  async calendar(auth: AuthContext, query: CalendarQueryDto) {
    const employee = await this.resolveEmployee(auth, query.employeeId);
    const [year, month] = query.month.split('-').map(Number) as [number, number];
    const { from, to, days } = monthRange(year, month);
    const ctx = await this.rules.context(auth.organizationId!, employee, { from, to });
    const today = this.rules.today(ctx.timeZone);
    const [records, holidays, pending, closed, leave, wfh, overtime] = await Promise.all([
      AttendanceRecord.findAll({ where: { employeeId: employee.id, workDate: { [Op.between]: [from, to] } } }),
      this.rules.holidays(from, to),
      AttendanceRegularization.findAll({ where: { employeeId: employee.id, status: 'PENDING', workDate: { [Op.between]: [from, to] } }, attributes: ['id', 'workDate'] }),
      this.rules.isClosed(from),
      this.rules.approvedLeave([employee.id], from, to),
      this.rules.workFromHomeDays([employee.id], from, to),
      AttendanceOvertime.findAll({ where: { employeeId: employee.id, workDate: { [Op.between]: [from, to] } }, attributes: ['workDate', 'status', 'minutes', 'approvedMinutes'] }),
    ]);
    const byDate = new Map(records.map((r) => [r.workDate, r]));
    const pendingDates = new Map(pending.map((p) => [p.workDate, p.id]));
    const leaveByDate = leave.get(employee.id);
    const wfhDays = wfh.get(employee.id);
    const otByDate = new Map(overtime.map((o) => [o.workDate, o]));
    const result = days.map((date) => {
      const holiday = holidays.on(date, ctx.locationId);
      const record = byDate.get(date);
      const dayLeave = leaveByDate?.get(date);
      const shift = this.rules.shiftOn(ctx, date);
      const ot = otByDate.get(date);
      return {
        date,
        status: this.rules.dayStatus(date, today, employee, ctx, holiday, record, dayLeave),
        holiday: holiday ? { name: holiday.name, isOptional: holiday.isOptional } : null,
        leave: dayLeave ? { code: dayLeave.code, name: dayLeave.name, color: dayLeave.color, session: dayLeave.session, isPaid: dayLeave.isPaid } : null,
        record: presentRecord(record),
        pendingRegularizationId: pendingDates.get(date) ?? null,
        shift: { name: shift.name, startTime: minutesToTime(shift.startMinutes), endTime: minutesToTime(shift.endMinutes), rostered: !!this.rules.rosterOn(ctx, date) },
        workFromHome: !!wfhDays?.has(date),
        overtime: ot ? { status: ot.status, minutes: ot.approvedMinutes ?? ot.minutes } : null,
      };
    });
    const count = (s: DayStatus) => result.filter((d) => d.status === s).length;
    return {
      employee: { id: employee.id, name: fullName(employee), employeeCode: employee.employeeCode, biometricCode: employee.biometricCode },
      month: query.month,
      timeZone: ctx.timeZone,
      shift: shiftSummary(ctx.shift),
      closed,
      today,
      days: result,
      summary: {
        present: count('PRESENT'),
        halfDay: count('HALF_DAY'),
        absent: count('ABSENT'),
        missedPunch: count('MISSED_PUNCH'),
        onLeave: result.reduce((n, d) => n + (d.status === 'ON_LEAVE' ? (d.leave?.session === 'FULL' ? 1 : 0.5) : 0), 0),
        holidays: count('HOLIDAY'),
        weeklyOffs: count('WEEKLY_OFF'),
        lateDays: records.filter((r) => r.lateMinutes > 0).length,
        workedMinutes: records.reduce((n, r) => n + (r.workedMinutes ?? 0), 0),
        workFromHomeDays: result.filter((d) => d.workFromHome).length,
        overtimeMinutes: overtime.filter((o) => o.status === 'APPROVED').reduce((n, o) => n + (o.approvedMinutes ?? 0), 0),
      },
    };
  }

  async daily(auth: AuthContext, query: DailyQueryDto) {
    const scoped = await this.scope.where(auth, 'attendance.view');
    const date = query.date ?? this.rules.today(await this.rules.organizationTimeZone(auth.organizationId!));
    const emptySummary = { total: 0, present: 0, halfDay: 0, absent: 0, inProgress: 0, missedPunch: 0, onLeave: 0, late: 0, off: 0, remote: 0 };
    if (!scoped) return { date, summary: emptySummary, page: new PaginatedResult([], paginationMeta(query, 0)) };

    const filters: WhereOptions[] = [scoped, { dateOfJoining: { [Op.lte]: date } }, { [Op.or]: [{ exitDate: null }, { exitDate: { [Op.gte]: date } }] }];
    if (query.departmentId) filters.push({ departmentId: query.departmentId });
    if (query.search) {
      const p = containsPattern(query.search);
      filters.push({ [Op.or]: [{ firstName: { [Op.iLike]: p } }, { lastName: { [Op.iLike]: p } }, { employeeCode: { [Op.iLike]: p } }] });
    }
    const employees = await Employee.findAll({
      where: { [Op.and]: filters },
      attributes: EMPLOYEE_ATTRS,
      include: [
        { model: Department, attributes: ['id', 'name'] },
        { model: Designation, attributes: ['id', 'name'] },
      ],
      order: [
        ['firstName', 'ASC'],
        ['lastName', 'ASC'],
      ],
      limit: 5000,
    });
    const ids = employees.map((e) => e.id);
    const [contexts, records, holidays, leave, wfh] = await Promise.all([
      this.rules.contexts(auth.organizationId!, employees, { from: date, to: date }),
      employees.length ? AttendanceRecord.findAll({ where: { workDate: date, employeeId: ids } }) : [],
      this.rules.holidays(date, date),
      this.rules.approvedLeave(ids, date, date),
      this.rules.workFromHomeDays(ids, date, date),
    ]);
    const byEmployee = new Map(records.map((r) => [r.employeeId, r]));
    const rows = employees.map((e) => {
      const ctx = contexts.get(e.id)!;
      const record = byEmployee.get(e.id);
      const dayLeave = leave.get(e.id)?.get(date);
      const status = this.rules.dayStatus(date, this.rules.today(ctx.timeZone), e, ctx, holidays.on(date, ctx.locationId), record, dayLeave);
      const shift = this.rules.shiftOn(ctx, date);
      return {
        employee: {
          id: e.id,
          name: fullName(e),
          employeeCode: e.employeeCode,
          department: e.department ? { id: e.department.id, name: e.department.name } : null,
          designation: e.designation?.name ?? null,
        },
        status,
        leave: dayLeave ? { code: dayLeave.code, name: dayLeave.name, color: dayLeave.color, session: dayLeave.session } : null,
        record: presentRecord(record),
        workFromHome: !!wfh.get(e.id)?.has(date),
        shift: { name: shift.name, startTime: minutesToTime(shift.startMinutes), endTime: minutesToTime(shift.endMinutes), rostered: !!this.rules.rosterOn(ctx, date) },
      };
    });
    const is = (s: DayStatus) => rows.filter((r) => r.status === s).length;
    const summary = {
      total: rows.length,
      present: is('PRESENT'),
      halfDay: is('HALF_DAY'),
      absent: is('ABSENT') + is('UPCOMING'),
      inProgress: is('IN_PROGRESS'),
      missedPunch: is('MISSED_PUNCH'),
      onLeave: is('ON_LEAVE'),
      late: rows.filter((r) => (r.record?.lateMinutes ?? 0) > 0).length,
      off: is('HOLIDAY') + is('WEEKLY_OFF'),
      remote: rows.filter((r) => r.workFromHome).length,
    };
    const filtered = query.status
      ? rows.filter((r) =>
          query.status === 'LATE'
            ? (r.record?.lateMinutes ?? 0) > 0
            : query.status === 'REMOTE'
              ? r.workFromHome
              : query.status === 'ABSENT'
                ? r.status === 'ABSENT' || r.status === 'UPCOMING'
                : r.status === query.status,
        )
      : rows;
    const start = (query.page - 1) * query.pageSize;
    return { date, summary, page: new PaginatedResult(filtered.slice(start, start + query.pageSize), paginationMeta(query, filtered.length)) };
  }

  // ---- HR corrections --------------------------------------------------------------------------

  async upsertRecord(auth: AuthContext, dto: UpsertRecordDto) {
    const employee = await this.resolveEmployee(auth, dto.employeeId, 'attendance.manage');
    if (dto.workDate < employee.dateOfJoining || (employee.exitDate && dto.workDate > employee.exitDate)) {
      throw AppError.validation([{ field: 'workDate', message: 'The employee was not employed on this date' }]);
    }
    const ctx = await this.rules.context(auth.organizationId!, employee, { from: dto.workDate, to: dto.workDate });
    if (dto.workDate > this.rules.today(ctx.timeZone)) throw AppError.validation([{ field: 'workDate', message: 'Attendance cannot be recorded for a future date' }]);
    await this.rules.assertOpen(dto.workDate);
    const { checkInAt, checkOutAt } = this.rules.instants(dto.workDate, dto.checkIn, dto.checkOut, ctx.timeZone);
    if (checkOutAt && checkOutAt > new Date()) throw AppError.validation([{ field: 'checkOut', message: 'Check-out cannot be in the future' }]);
    const record = await this.db.transaction(async (transaction) => {
      const values = {
        ...(await this.rules.evaluate(ctx, dto.workDate, checkInAt, checkOutAt, transaction)),
        checkInAt,
        checkOutAt,
        source: 'MANUAL' as const,
        note: dto.note,
        updatedById: auth.userId,
      };
      const existing = await AttendanceRecord.findOne({ where: { employeeId: employee.id, workDate: dto.workDate }, transaction });
      const before = existing ? { checkInAt: existing.checkInAt, checkOutAt: existing.checkOutAt, status: existing.status } : null;
      const saved = existing
        ? await existing.update(values, { transaction })
        : await AttendanceRecord.create({ ...values, organizationId: auth.organizationId!, employeeId: employee.id, workDate: dto.workDate }, { transaction });
      await this.overtime.sync(saved, transaction);
      await this.audit.record(
        {
          action: 'attendance.record_corrected',
          entityType: 'AttendanceRecord',
          entityId: saved.id,
          summary: `Attendance of ${fullName(employee)} on ${dto.workDate} corrected`,
          changes: {
            checkInAt: { from: before?.checkInAt ?? null, to: checkInAt },
            checkOutAt: { from: before?.checkOutAt ?? null, to: checkOutAt },
            status: { from: before?.status ?? null, to: saved.status },
          },
          metadata: { note: dto.note },
        },
        transaction,
      );
      return saved;
    });
    return presentRecord(record);
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  /** The office geofence of the employee's location: web punch-ins must come from within the radius. */
  private async checkGeofence(self: Employee, dto: PunchDto) {
    if (!self.locationId) return;
    const location = await Location.findByPk(self.locationId, { attributes: ['name', 'latitude', 'longitude', 'geofenceRadiusM'] });
    if (!location?.geofenceRadiusM || location.latitude === null || location.longitude === null) return;
    if (dto.latitude === undefined || dto.longitude === undefined) {
      throw AppError.validation([{ field: 'location', message: `Share your location to punch in: ${location.name} only accepts punches from the office` }]);
    }
    const distance = distanceMetres({ latitude: dto.latitude, longitude: dto.longitude }, { latitude: Number(location.latitude), longitude: Number(location.longitude) });
    if (distance > location.geofenceRadiusM) {
      const away = distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${distance} m`;
      throw AppError.validation([{ field: 'location', message: `You are about ${away} from ${location.name}. Punch in from the office, or ask to work from home.` }]);
    }
  }

  private async requireSelf(auth: AuthContext): Promise<Employee> {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.notFound('Employee record linked to your account');
    if (self.status === 'EXITED') throw AppError.forbidden('Exited employees cannot record attendance');
    return self;
  }

  /** The employee whose data is requested, within the caller's scope for `permission` (default: own record). */
  async resolveEmployee(auth: AuthContext, employeeId: string | undefined, permission = 'attendance.view'): Promise<Employee> {
    if (!employeeId) {
      const self = await this.scope.self(auth);
      if (!self) throw AppError.notFound('Employee record linked to your account');
      if (!auth.permissions.has(permission)) throw AppError.forbidden();
      return self;
    }
    const employee = await Employee.findByPk(employeeId, { attributes: EMPLOYEE_ATTRS });
    if (!employee || !(await this.scope.covers(auth, 'attendance.view', employee))) throw AppError.notFound('Employee');
    if (permission !== 'attendance.view' && !(await this.scope.covers(auth, permission, employee))) throw AppError.forbidden();
    return employee;
  }

  /** The latest punch-in without a punch-out within the last OPEN_PUNCH_HOURS (supports night shifts). */
  private findOpen(employeeId: string, now: Date) {
    return AttendanceRecord.findOne({
      where: { employeeId, checkOutAt: null, checkInAt: { [Op.gte]: new Date(now.getTime() - OPEN_PUNCH_HOURS * 3_600_000) } },
      order: [['checkInAt', 'DESC']],
    });
  }

  private localTime(instant: Date, ctx: EmployeeContext): string {
    return new Intl.DateTimeFormat('en-IN', { timeZone: ctx.timeZone, hour: '2-digit', minute: '2-digit' }).format(instant);
  }
}
