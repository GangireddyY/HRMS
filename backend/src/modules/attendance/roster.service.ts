import { Injectable } from '@nestjs/common';
import { Op, UniqueConstraintError, type Transaction, type WhereOptions } from 'sequelize';
import { ROSTER_MAX_DAYS } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { addDays, minutesToTime } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { Department, Employee, Shift, ShiftAssignment, ShiftRotation } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { fullName } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { AttendanceRulesService } from './attendance-rules.service';
import type { ApplyRotationDto, AssignRosterDto, ClearRosterDto, RosterQueryDto, RotationDto } from './dto/attendance.dto';
import { carve, cycleLength, daysBetween, rotationSpans, type Span } from './roster-rules';

/**
 * Rosters (`attendance.configure`): the shift — or a day off — each employee works on each day, overriding their usual
 * shift. Planned from today onwards by assigning a shift to people for a range, or by laying a rotation (a repeating
 * cycle such as 5 mornings, 2 off, 5 nights, 2 off) over the range. Attendance, leave day counts and payroll follow
 * the roster. Anyone with `attendance.view` at team scope or wider can read the roster of the people they see.
 */
@Injectable()
export class RosterService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly rules: AttendanceRulesService,
  ) {}

  // ---- Rotations --------------------------------------------------------------------------------

  async listRotations() {
    const [rotations, shifts] = await Promise.all([
      ShiftRotation.findAll({
        order: [
          ['isActive', 'DESC'],
          ['name', 'ASC'],
        ],
      }),
      Shift.findAll({ attributes: ['id', 'name'] }),
    ]);
    const names = new Map(shifts.map((s) => [s.id, s.name]));
    return rotations.map((r) => ({
      id: r.id,
      name: r.name,
      isActive: r.isActive,
      cycleDays: cycleLength(r.pattern),
      pattern: r.pattern.map((s) => ({ shiftId: s.shiftId, shiftName: s.shiftId ? (names.get(s.shiftId) ?? 'Deleted shift') : null, days: s.days })),
    }));
  }

  async createRotation(auth: AuthContext, dto: RotationDto) {
    await this.checkPattern(dto.pattern);
    const id = await this.guard(() =>
      this.db.transaction(async (transaction) => {
        const r = await ShiftRotation.create(
          {
            organizationId: auth.organizationId!,
            name: dto.name,
            pattern: dto.pattern.map((s) => ({ shiftId: s.shiftId ?? null, days: s.days })),
            isActive: dto.isActive ?? true,
            createdById: auth.userId,
          },
          { transaction },
        );
        await this.audit.record(
          { action: 'rotation.created', entityType: 'ShiftRotation', entityId: r.id, summary: `Rotation "${r.name}" created (${cycleLength(r.pattern)}-day cycle)` },
          transaction,
        );
        return r.id;
      }),
    );
    return (await this.listRotations()).find((r) => r.id === id)!;
  }

  async updateRotation(auth: AuthContext, id: string, dto: Partial<RotationDto>) {
    const r = await ShiftRotation.findByPk(id);
    if (!r) throw AppError.notFound('Rotation');
    if (dto.pattern) await this.checkPattern(dto.pattern);
    await this.guard(() =>
      this.db.transaction(async (transaction) => {
        await r.update(
          {
            ...(dto.name ? { name: dto.name } : {}),
            ...(dto.pattern ? { pattern: dto.pattern.map((s) => ({ shiftId: s.shiftId ?? null, days: s.days })) } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          },
          { transaction },
        );
        await this.audit.record({ action: 'rotation.updated', entityType: 'ShiftRotation', entityId: id, summary: `Rotation "${r.name}" updated` }, transaction);
      }),
    );
    return (await this.listRotations()).find((x) => x.id === id)!;
  }

  async removeRotation(id: string) {
    const r = await ShiftRotation.findByPk(id);
    if (!r) throw AppError.notFound('Rotation');
    if (await ShiftAssignment.count({ where: { rotationId: id } })) throw AppError.conflict('This rotation is used in the roster. Deactivate it instead.');
    await this.db.transaction(async (transaction) => {
      await r.destroy({ transaction });
      await this.audit.record({ action: 'rotation.deleted', entityType: 'ShiftRotation', entityId: id, summary: `Rotation "${r.name}" deleted` }, transaction);
    });
  }

  // ---- Roster -----------------------------------------------------------------------------------

  /** People in scope × days, with the shift (or day off) of each day and whether it comes from the roster. */
  async roster(auth: AuthContext, query: RosterQueryDto) {
    const span = daysBetween(query.from, query.to);
    if (span < 0) throw AppError.validation([{ field: 'to', message: "The end can't be before the start" }]);
    if (span >= ROSTER_MAX_DAYS) throw AppError.validation([{ field: 'to', message: `Look at most ${ROSTER_MAX_DAYS} days at a time` }]);
    if (!auth.permissions.has('attendance.configure') && (this.scope.scopeOf(auth, 'attendance.view') ?? 'OWN') === 'OWN') throw AppError.forbidden();
    const scoped = auth.permissions.has('attendance.configure') ? {} : await this.scope.where(auth, 'attendance.view');
    const days = Array.from({ length: span + 1 }, (_, i) => addDays(query.from, i));
    const shifts = (await Shift.findAll({ order: [['name', 'ASC']] })).map((s) => ({
      id: s.id,
      name: s.name,
      startTime: s.startTime.slice(0, 5),
      endTime: s.endTime.slice(0, 5),
      isActive: s.isActive,
    }));
    if (!scoped) return { days, shifts, page: new PaginatedResult([], paginationMeta(query, 0)) };
    const filters: WhereOptions[] = [scoped, { status: ['ACTIVE', 'ON_NOTICE'] }];
    if (query.departmentId) filters.push({ departmentId: query.departmentId });
    if (query.search) {
      const like = containsPattern(query.search);
      filters.push({ [Op.or]: [{ firstName: { [Op.iLike]: like } }, { lastName: { [Op.iLike]: like } }, { employeeCode: { [Op.iLike]: like } }] });
    }
    const where = { [Op.and]: filters };
    const count = await Employee.count({ where });
    const employees = await Employee.findAll({
      where,
      attributes: ['id', 'organizationId', 'firstName', 'lastName', 'employeeCode', 'shiftId', 'locationId', 'dateOfJoining', 'exitDate'],
      include: [{ model: Department, attributes: ['id', 'name'] }],
      order: [
        ['firstName', 'ASC'],
        ['lastName', 'ASC'],
      ],
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    const contexts = await this.rules.contexts(auth.organizationId!, employees, { from: query.from, to: query.to });
    const rows = employees.map((e) => {
      const ctx = contexts.get(e.id)!;
      return {
        employee: { id: e.id, name: fullName(e), employeeCode: e.employeeCode, department: e.department?.name ?? null },
        usualShift: { id: ctx.shift.id, name: ctx.shift.name },
        days: days.map((date) => {
          const r = this.rules.rosterOn(ctx, date);
          const shift = this.rules.shiftOn(ctx, date);
          return {
            date,
            rostered: !!r,
            off: this.rules.isRestDay(ctx, date),
            shiftId: shift.id,
            shiftName: shift.name,
            time: `${minutesToTime(shift.startMinutes)}–${minutesToTime(shift.endMinutes)}`,
          };
        }),
      };
    });
    return { days, shifts, page: new PaginatedResult(rows, paginationMeta(query, count)) };
  }

  async assign(auth: AuthContext, dto: AssignRosterDto) {
    await this.checkRange(auth, dto.from, dto.to);
    let label = 'Day off';
    if (dto.shiftId) {
      const shift = await Shift.findByPk(dto.shiftId);
      if (!shift || !shift.isActive) throw AppError.validation([{ field: 'shiftId', message: 'Choose an active shift' }]);
      label = shift.name;
    }
    const employees = await this.employees(dto.employeeIds);
    await this.db.transaction(async (transaction) => {
      for (const e of employees) {
        await this.clearRange(e.id, dto.from, dto.to, transaction);
        await ShiftAssignment.create(
          { organizationId: auth.organizationId!, employeeId: e.id, shiftId: dto.shiftId ?? null, startDate: dto.from, endDate: dto.to, createdById: auth.userId },
          { transaction },
        );
      }
      await this.audit.record(
        {
          action: 'roster.assigned',
          entityType: 'ShiftAssignment',
          summary: `${label} rostered for ${employees.length} employee${employees.length === 1 ? '' : 's'} from ${dto.from} to ${dto.to}`,
          metadata: { employeeIds: dto.employeeIds, shiftId: dto.shiftId ?? null },
        },
        transaction,
      );
    });
    return { employees: employees.length, from: dto.from, to: dto.to };
  }

  async applyRotation(auth: AuthContext, dto: ApplyRotationDto) {
    await this.checkRange(auth, dto.from, dto.to);
    const rotation = await ShiftRotation.findByPk(dto.rotationId);
    if (!rotation || !rotation.isActive) throw AppError.validation([{ field: 'rotationId', message: 'Choose an active rotation' }]);
    await this.checkPattern(rotation.pattern, true);
    const employees = await this.employees(dto.employeeIds);
    const spans: Span[] = rotationSpans(rotation.pattern, dto.from, dto.to, dto.offset ?? 0);
    await this.db.transaction(async (transaction) => {
      for (const e of employees) {
        await this.clearRange(e.id, dto.from, dto.to, transaction);
        await ShiftAssignment.bulkCreate(
          spans.map((s) => ({ organizationId: auth.organizationId!, employeeId: e.id, shiftId: s.shiftId, startDate: s.from, endDate: s.to, rotationId: rotation.id, createdById: auth.userId })),
          { transaction },
        );
      }
      await this.audit.record(
        {
          action: 'roster.rotation_applied',
          entityType: 'ShiftRotation',
          entityId: rotation.id,
          summary: `Rotation "${rotation.name}" applied to ${employees.length} employee${employees.length === 1 ? '' : 's'} from ${dto.from} to ${dto.to}`,
          metadata: { employeeIds: dto.employeeIds, offset: dto.offset ?? 0 },
        },
        transaction,
      );
    });
    return { employees: employees.length, from: dto.from, to: dto.to };
  }

  /** Back to the usual shift for the range. */
  async clear(auth: AuthContext, dto: ClearRosterDto) {
    await this.checkRange(auth, dto.from, dto.to);
    const employees = await this.employees(dto.employeeIds);
    await this.db.transaction(async (transaction) => {
      for (const e of employees) await this.clearRange(e.id, dto.from, dto.to, transaction);
      await this.audit.record(
        {
          action: 'roster.cleared',
          entityType: 'ShiftAssignment',
          summary: `Roster cleared for ${employees.length} employee${employees.length === 1 ? '' : 's'} from ${dto.from} to ${dto.to}`,
          metadata: { employeeIds: dto.employeeIds },
        },
        transaction,
      );
    });
    return { employees: employees.length, from: dto.from, to: dto.to };
  }

  /** Rosters one day for one employee (null = day off), replacing whatever was planned (shift swaps). */
  async setDay(organizationId: string, employeeId: string, date: string, shiftId: string | null, createdById: string | null, transaction: Transaction) {
    await this.clearRange(employeeId, date, date, transaction);
    await ShiftAssignment.create({ organizationId, employeeId, shiftId, startDate: date, endDate: date, createdById }, { transaction });
  }

  // ---- Internals --------------------------------------------------------------------------------

  private async clearRange(employeeId: string, from: string, to: string, transaction: Transaction) {
    const overlapping = await ShiftAssignment.findAll({ where: { employeeId, startDate: { [Op.lte]: to }, endDate: { [Op.gte]: from } }, transaction, lock: transaction.LOCK.UPDATE });
    for (const a of overlapping) {
      const pieces = carve({ from: a.startDate, to: a.endDate }, from, to);
      if (!pieces.length) {
        await a.destroy({ transaction });
        continue;
      }
      await a.update({ startDate: pieces[0]!.from, endDate: pieces[0]!.to }, { transaction });
      if (pieces[1])
        await ShiftAssignment.create(
          { organizationId: a.organizationId, employeeId, shiftId: a.shiftId, startDate: pieces[1].from, endDate: pieces[1].to, rotationId: a.rotationId, createdById: a.createdById },
          { transaction },
        );
    }
  }

  /** Rosters are planned from today (in the organization's time zone) and at most ROSTER_MAX_DAYS at a time. */
  private async checkRange(auth: AuthContext, from: string, to: string) {
    const today = this.rules.today(await this.rules.organizationTimeZone(auth.organizationId!));
    if (from < today) throw AppError.validation([{ field: 'from', message: 'Rosters are planned from today onwards' }]);
    if (to < from) throw AppError.validation([{ field: 'to', message: "The end can't be before the start" }]);
    if (daysBetween(from, to) >= ROSTER_MAX_DAYS) throw AppError.validation([{ field: 'to', message: `Plan at most ${ROSTER_MAX_DAYS} days at a time` }]);
  }

  private async employees(ids: string[]) {
    const rows = await Employee.findAll({ where: { id: ids, status: ['ACTIVE', 'ON_NOTICE'] }, attributes: ['id', 'employeeCode'] });
    if (rows.length !== new Set(ids).size) throw AppError.validation([{ field: 'employeeIds', message: 'Every employee must be active' }]);
    return rows;
  }

  private async checkPattern(pattern: { shiftId?: string | null; days: number }[], existing = false) {
    const ids = [...new Set(pattern.map((s) => s.shiftId).filter((x): x is string => !!x))];
    if (!ids.length) throw AppError.validation([{ field: 'pattern', message: 'Include at least one shift' }]);
    const shifts = await Shift.findAll({ where: { id: ids }, attributes: ['id', 'isActive'] });
    if (shifts.length !== ids.length || shifts.some((s) => !s.isActive)) {
      throw AppError.validation([{ field: 'pattern', message: existing ? 'This rotation uses a shift that is no longer active' : 'Every shift in the pattern must be active' }]);
    }
    if (cycleLength(pattern as { shiftId: string | null; days: number }[]) > 56) throw AppError.validation([{ field: 'pattern', message: 'A cycle can be at most 8 weeks long' }]);
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.validation([{ field: 'name', message: 'A rotation with this name already exists' }]);
      throw e;
    }
  }
}
