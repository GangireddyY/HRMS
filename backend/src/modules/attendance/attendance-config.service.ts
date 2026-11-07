import { Injectable } from '@nestjs/common';
import { col, fn, Op, UniqueConstraintError, type Transaction } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { AttendanceRecord, Employee, Holiday, Shift } from '../../database/models';
import { AuditService, diff } from '../../infrastructure/audit/audit.service';
import type { CreateHolidayDto, CreateShiftDto, UpdateHolidayDto, UpdateShiftDto } from './dto/attendance.dto';

const toTime = (v: string | undefined) => (v ? `${v}:00` : undefined);
const shortTime = (v: string) => v.slice(0, 5);

function present(s: Shift, employeeCount: number) {
  return {
    id: s.id,
    name: s.name,
    startTime: shortTime(s.startTime),
    endTime: shortTime(s.endTime),
    breakMinutes: s.breakMinutes,
    graceMinutes: s.graceMinutes,
    halfDayMinutes: s.halfDayMinutes,
    fullDayMinutes: s.fullDayMinutes,
    weeklyOffs: (s.weeklyOffs ?? []).map(Number).sort(),
    overtimeEnabled: s.overtimeEnabled,
    overtimeAfterMinutes: s.overtimeAfterMinutes,
    overtimeMinMinutes: s.overtimeMinMinutes,
    isDefault: s.isDefault,
    isActive: s.isActive,
    employeeCount,
  };
}

/** Shifts (attendance.configure) and holidays (organization.calendar.manage). */
@Injectable()
export class AttendanceConfigService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async listShifts() {
    const [shifts, counts] = await Promise.all([
      Shift.findAll({ order: [['isDefault', 'DESC'], ['name', 'ASC']] }),
      Employee.findAll({ attributes: ['shiftId', [fn('COUNT', col('id')), 'count']], where: { shiftId: { [Op.ne]: null }, status: ['ACTIVE', 'ON_NOTICE'] }, group: ['shiftId'], raw: true }) as unknown as Promise<{ shiftId: string; count: string }[]>,
    ]);
    const byShift = new Map(counts.map((c) => [c.shiftId, Number(c.count)]));
    const unassigned = await Employee.count({ where: { shiftId: null, status: ['ACTIVE', 'ON_NOTICE'] } });
    // Employees without an assigned shift follow the default shift.
    return shifts.map((s) => present(s, (byShift.get(s.id) ?? 0) + (s.isDefault ? unassigned : 0)));
  }

  async createShift(auth: AuthContext, dto: CreateShiftDto) {
    this.assertThresholds(dto);
    return this.guard(() =>
      this.db.transaction(async (transaction) => {
        const isFirst = (await Shift.count({ transaction })) === 0;
        const isDefault = dto.isDefault ?? isFirst;
        if (isDefault) await this.clearDefault(transaction);
        const shift = await Shift.create(
          { ...dto, startTime: toTime(dto.startTime)!, endTime: toTime(dto.endTime)!, isDefault, organizationId: auth.organizationId!, createdById: auth.userId, updatedById: auth.userId },
          { transaction },
        );
        await this.audit.record({ action: 'shift.created', entityType: 'Shift', entityId: shift.id, summary: `Shift "${shift.name}" created` }, transaction);
        return present(shift, 0);
      }),
    );
  }

  async updateShift(auth: AuthContext, id: string, dto: UpdateShiftDto) {
    const shift = await Shift.findByPk(id);
    if (!shift) throw AppError.notFound('Shift');
    this.assertThresholds({ halfDayMinutes: dto.halfDayMinutes ?? shift.halfDayMinutes, fullDayMinutes: dto.fullDayMinutes ?? shift.fullDayMinutes });
    if (dto.isDefault === false && shift.isDefault) throw AppError.validation([{ field: 'isDefault', message: 'Make another shift the default instead' }]);
    if (dto.isActive === false && shift.isDefault) throw AppError.validation([{ field: 'isActive', message: 'The default shift cannot be deactivated' }]);
    const before = shift.get({ plain: true, clone: true }) as Record<string, unknown>;
    const values = { ...dto, startTime: toTime(dto.startTime), endTime: toTime(dto.endTime) };
    for (const k of Object.keys(values) as (keyof typeof values)[]) if (values[k] === undefined) delete values[k];
    return this.guard(() =>
      this.db.transaction(async (transaction) => {
        if (dto.isDefault && !shift.isDefault) await this.clearDefault(transaction);
        await shift.update({ ...values, updatedById: auth.userId }, { transaction });
        await this.audit.record({ action: 'shift.updated', entityType: 'Shift', entityId: id, changes: diff(before, values as Record<string, unknown>) }, transaction);
        return present(shift, 0);
      }),
    );
  }

  async removeShift(id: string): Promise<void> {
    const shift = await Shift.findByPk(id);
    if (!shift) throw AppError.notFound('Shift');
    if (shift.isDefault) throw AppError.conflict('The default shift cannot be deleted. Make another shift the default first.');
    const assigned = await Employee.count({ where: { shiftId: id } });
    if (assigned) throw AppError.conflict(`${assigned} employee${assigned === 1 ? ' is' : 's are'} on this shift. Move them to another shift or deactivate it instead.`);
    if (await AttendanceRecord.count({ where: { shiftId: id } })) throw AppError.conflict('Attendance has been recorded on this shift. Deactivate it instead.');
    await this.db.transaction(async (transaction) => {
      await shift.destroy({ transaction });
      await this.audit.record({ action: 'shift.deleted', entityType: 'Shift', entityId: id, summary: `Shift "${shift.name}" deleted` }, transaction);
    });
  }

  listHolidays(year: number) {
    return Holiday.findAll({ where: { date: { [Op.between]: [`${year}-01-01`, `${year}-12-31`] } }, order: [['date', 'ASC']] });
  }

  async createHoliday(auth: AuthContext, dto: CreateHolidayDto) {
    return this.holidayGuard(() =>
      this.db.transaction(async (transaction) => {
        const holiday = await Holiday.create({ ...dto, organizationId: auth.organizationId!, createdById: auth.userId, updatedById: auth.userId }, { transaction });
        await this.audit.record({ action: 'holiday.created', entityType: 'Holiday', entityId: holiday.id, summary: `Holiday "${holiday.name}" on ${holiday.date}` }, transaction);
        return holiday;
      }),
    );
  }

  async updateHoliday(auth: AuthContext, id: string, dto: UpdateHolidayDto) {
    const holiday = await Holiday.findByPk(id);
    if (!holiday) throw AppError.notFound('Holiday');
    const before = holiday.get({ plain: true, clone: true }) as Record<string, unknown>;
    return this.holidayGuard(() =>
      this.db.transaction(async (transaction) => {
        await holiday.update({ ...dto, updatedById: auth.userId }, { transaction });
        await this.audit.record({ action: 'holiday.updated', entityType: 'Holiday', entityId: id, changes: diff(before, dto as Record<string, unknown>) }, transaction);
        return holiday;
      }),
    );
  }

  async removeHoliday(id: string): Promise<void> {
    const holiday = await Holiday.findByPk(id);
    if (!holiday) throw AppError.notFound('Holiday');
    await this.db.transaction(async (transaction) => {
      await holiday.destroy({ transaction });
      await this.audit.record({ action: 'holiday.deleted', entityType: 'Holiday', entityId: id, summary: `Holiday "${holiday.name}" on ${holiday.date} deleted` }, transaction);
    });
  }

  private async clearDefault(transaction: Transaction) {
    await Shift.update({ isDefault: false }, { where: { isDefault: true }, transaction });
  }

  private assertThresholds(dto: { halfDayMinutes?: number; fullDayMinutes?: number }) {
    if (dto.halfDayMinutes !== undefined && dto.fullDayMinutes !== undefined && dto.halfDayMinutes > dto.fullDayMinutes) {
      throw AppError.validation([{ field: 'halfDayMinutes', message: 'Half-day minimum cannot exceed the full-day minimum' }]);
    }
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.validation([{ field: 'name', message: 'A shift with this name already exists' }]);
      throw e;
    }
  }

  private async holidayGuard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.validation([{ field: 'date', message: 'There is already a holiday on this date' }]);
      throw e;
    }
  }
}
