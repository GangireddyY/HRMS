import { Injectable } from '@nestjs/common';
import { col, fn, Op, type Transaction, type WhereOptions } from 'sequelize';
import type { LedgerKind } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { DatabaseService } from '../../database/database.service';
import { Department, Employee, LeaveLedgerEntry, LeaveRequest, LeaveType, OrganizationMembership, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { AttendanceRulesService } from '../attendance/attendance-rules.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AdjustmentDto, BalanceOverviewQueryDto, LedgerQueryDto } from './dto/leave.dto';
import { accrualPlan, carryForward, leaveYearOf, leaveYearRange, round2 } from './leave-policy';
import { LeaveTypesService } from './leave-types.service';

export const LEAVE_EMPLOYEE_ATTRS = ['id', 'organizationId', 'employeeCode', 'firstName', 'lastName', 'status', 'gender', 'dateOfJoining', 'exitDate', 'managerId', 'departmentId', 'membershipId', 'shiftId', 'locationId'];
const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();

export interface LeaveYearContext {
  startMonth: number;
  timeZone: string;
  today: string;
  currentYear: number;
}

export interface BalanceRow {
  leaveType: { id: string; code: string; name: string; color: string; isPaid: boolean; unlimited: boolean; allowHalfDay: boolean; encashable: boolean };
  /** Carried forward from last year. */
  opening: number;
  accrued: number;
  granted: number;
  adjusted: number;
  /** Net days used (approved leave minus reversals). */
  taken: number;
  encashed: number;
  lapsed: number;
  /** null for unlimited types. */
  balance: number | null;
  pending: number;
  available: number | null;
}

/** Whether a type applies to an employee (gender-specific types such as maternity leave). */
export const appliesTo = (t: Pick<LeaveType, 'applicableGender'>, e: Pick<Employee, 'gender'>) => !t.applicableGender || t.applicableGender === e.gender;

/**
 * Leave balances from the append-only ledger. Accruals, carry-forward and lapse are written lazily (whenever balances are
 * needed) with idempotency keys, so they are correct without a scheduler and safe to run concurrently or repeatedly.
 */
@Injectable()
export class LeaveBalanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly rules: AttendanceRulesService,
    private readonly types: LeaveTypesService,
    private readonly notifications: NotificationsService,
  ) {}

  async yearContext(organizationId: string): Promise<LeaveYearContext> {
    const settings = await this.types.settings(organizationId);
    const today = this.rules.today(settings.timeZone ?? 'UTC');
    return { startMonth: settings.leaveYearStartMonth, timeZone: settings.timeZone ?? 'UTC', today, currentYear: leaveYearOf(today, settings.leaveYearStartMonth) };
  }

  /**
   * Writes the accruals due so far in `year` and, at the start of a year, last year's carry-forward and lapse
   * (looking back `depth` years so a gap in activity cannot lose a carry-forward).
   */
  async ensure(organizationId: string, employees: Pick<Employee, 'id' | 'dateOfJoining' | 'exitDate' | 'gender'>[], year: number, depth = 2, asOfOverride?: string): Promise<void> {
    if (!employees.length) return;
    const ctx = await this.yearContext(organizationId);
    const range = leaveYearRange(year, ctx.startMonth);
    const asOf = asOfOverride ?? (ctx.today < range.to ? ctx.today : range.to);
    if (asOf < range.from) return;
    const types = (await LeaveType.findAll({ where: { unlimited: false } })).filter((t) => t.isActive);
    if (!types.length) return;

    const prev = leaveYearRange(year - 1, ctx.startMonth);
    const inPrev = employees.filter((e) => e.dateOfJoining <= prev.to && !(e.exitDate && e.exitDate < prev.from));
    if (depth > 0 && inPrev.length) await this.ensure(organizationId, inPrev, year - 1, depth - 1, prev.to);

    const planned: { employeeId: string; leaveTypeId: string; leaveYear: number; kind: LedgerKind; days: number; effectiveDate: string; note: string; key: string }[] = [];
    for (const e of employees) {
      for (const t of types) {
        if (!appliesTo(t, e)) continue;
        const policy = { id: t.id, annualQuota: Number(t.annualQuota), accrualFrequency: t.accrualFrequency, prorateOnJoining: t.prorateOnJoining };
        for (const p of accrualPlan(policy, e, year, ctx.startMonth, asOf)) {
          planned.push({ employeeId: e.id, leaveTypeId: t.id, leaveYear: year, kind: 'ACCRUAL', days: p.days, effectiveDate: p.effectiveDate, note: p.note, key: p.key });
        }
      }
    }

    // Year-end of last year: carry forward up to the limit, lapse the rest (pending requests of that year are held back).
    const carryCandidates = inPrev.filter((e) => !(e.exitDate && e.exitDate < range.from));
    if (carryCandidates.length) {
      const ids = carryCandidates.map((e) => e.id);
      const [sums, pending] = await Promise.all([this.sums(ids, year - 1), this.pendingSums(ids, year - 1)]);
      for (const e of carryCandidates) {
        for (const t of types) {
          if (!appliesTo(t, e)) continue;
          const k = `${e.id}:${t.id}`;
          const remaining = (sums.get(k)?.total ?? 0) - (pending.get(k) ?? 0);
          const { carried, lapsed } = carryForward(remaining, Number(t.carryForwardLimit));
          if (carried > 0) {
            planned.push({ employeeId: e.id, leaveTypeId: t.id, leaveYear: year, kind: 'CARRY_FORWARD', days: carried, effectiveDate: range.from, note: `Carried forward from ${year - 1}`, key: `cf:${t.id}:${e.id}:${year}` });
          }
          if (lapsed > 0) {
            planned.push({ employeeId: e.id, leaveTypeId: t.id, leaveYear: year - 1, kind: 'LAPSE', days: -lapsed, effectiveDate: prev.to, note: 'Lapsed at the end of the leave year', key: `lapse:${t.id}:${e.id}:${year - 1}` });
          }
        }
      }
    }
    if (!planned.length) return;

    const existing = new Set(
      (await LeaveLedgerEntry.findAll({ where: { idempotencyKey: planned.map((p) => p.key) }, attributes: ['idempotencyKey'], raw: true })).map((r) => r.idempotencyKey),
    );
    const missing = planned.filter((p) => !existing.has(p.key));
    if (!missing.length) return;
    await LeaveLedgerEntry.bulkCreate(
      missing.map((p) => ({
        organizationId,
        employeeId: p.employeeId,
        leaveTypeId: p.leaveTypeId,
        leaveYear: p.leaveYear,
        kind: p.kind,
        days: String(p.days),
        effectiveDate: p.effectiveDate,
        note: p.note,
        idempotencyKey: p.key,
      })),
      { ignoreDuplicates: true },
    );
  }

  /** Balance per leave type for each employee in a leave year (after writing due accruals). */
  async summaries(organizationId: string, employees: Employee[], year: number): Promise<Map<string, BalanceRow[]>> {
    await this.ensure(organizationId, employees, year);
    const ids = employees.map((e) => e.id);
    const [types, sums, pending] = await Promise.all([LeaveType.findAll({ order: [['name', 'ASC']] }), this.sums(ids, year), this.pendingSums(ids, year)]);
    const out = new Map<string, BalanceRow[]>();
    for (const e of employees) {
      const rows: BalanceRow[] = [];
      for (const t of types) {
        const k = `${e.id}:${t.id}`;
        const s = sums.get(k);
        if (!appliesTo(t, e) || (!t.isActive && !s)) continue;
        const by = (kind: LedgerKind) => s?.byKind.get(kind) ?? 0;
        const balance = t.unlimited ? null : round2(s?.total ?? 0);
        const pend = pending.get(k) ?? 0;
        rows.push({
          leaveType: { id: t.id, code: t.code, name: t.name, color: t.color, isPaid: t.isPaid, unlimited: t.unlimited, allowHalfDay: t.allowHalfDay, encashable: t.encashable },
          opening: by('CARRY_FORWARD'),
          accrued: by('ACCRUAL'),
          granted: by('GRANT'),
          adjusted: by('ADJUSTMENT'),
          taken: round2(-(by('TAKEN') + by('REVERSAL'))),
          encashed: -by('ENCASHMENT'),
          lapsed: -by('LAPSE'),
          balance,
          pending: pend,
          available: balance === null ? null : round2(balance - pend),
        });
      }
      out.set(e.id, rows);
    }
    return out;
  }

  async balances(auth: AuthContext, employeeId: string | undefined, year: number | undefined) {
    const employee = await this.resolveEmployee(auth, employeeId);
    const ctx = await this.yearContext(auth.organizationId!);
    const y = year ?? ctx.currentYear;
    const range = leaveYearRange(y, ctx.startMonth);
    const rows = (await this.summaries(auth.organizationId!, [employee], y)).get(employee.id) ?? [];
    return {
      employee: { id: employee.id, name: fullName(employee), employeeCode: employee.employeeCode },
      year: y,
      currentYear: ctx.currentYear,
      range,
      balances: rows,
    };
  }

  /** Available balance per employee and type, for HR (within leave.view scope). */
  async overview(auth: AuthContext, query: BalanceOverviewQueryDto) {
    const ctx = await this.yearContext(auth.organizationId!);
    const year = query.year ?? ctx.currentYear;
    const types = (await LeaveType.findAll({ where: { isActive: true }, order: [['name', 'ASC']] })).map((t) => ({ id: t.id, code: t.code, name: t.name, color: t.color, unlimited: t.unlimited }));
    const scoped = await this.scope.where(auth, 'leave.view');
    if (!scoped) return { year, currentYear: ctx.currentYear, types, page: new PaginatedResult([], paginationMeta(query, 0)) };
    const filters: WhereOptions[] = [scoped, { status: ['ACTIVE', 'ON_NOTICE'] }];
    if (query.departmentId) filters.push({ departmentId: query.departmentId });
    if (query.search) {
      const p = containsPattern(query.search);
      filters.push({ [Op.or]: [{ firstName: { [Op.iLike]: p } }, { lastName: { [Op.iLike]: p } }, { employeeCode: { [Op.iLike]: p } }] });
    }
    const { rows, count } = await Employee.findAndCountAll({
      where: { [Op.and]: filters },
      attributes: LEAVE_EMPLOYEE_ATTRS,
      include: [{ model: Department, attributes: ['id', 'name'] }],
      order: [['firstName', 'ASC'], ['lastName', 'ASC']],
      ...paginationArgs(query),
    });
    const summaries = await this.summaries(auth.organizationId!, rows, year);
    const items = rows.map((e) => ({
      employee: { id: e.id, name: fullName(e), employeeCode: e.employeeCode, department: e.department?.name ?? null },
      balances: (summaries.get(e.id) ?? []).map((b) => ({ leaveTypeId: b.leaveType.id, balance: b.balance, available: b.available, pending: b.pending, taken: b.taken })),
    }));
    return { year, currentYear: ctx.currentYear, types, page: new PaginatedResult(items, paginationMeta(query, count)) };
  }

  async ledger(auth: AuthContext, query: LedgerQueryDto) {
    const employee = await this.resolveEmployee(auth, query.employeeId);
    const ctx = await this.yearContext(auth.organizationId!);
    const year = query.year ?? ctx.currentYear;
    await this.ensure(auth.organizationId!, [employee], year);
    const rows = await LeaveLedgerEntry.findAll({
      where: { employeeId: employee.id, leaveYear: year, ...(query.leaveTypeId ? { leaveTypeId: query.leaveTypeId } : {}) },
      include: [
        { model: LeaveType, attributes: ['id', 'code', 'name', 'color'] },
        { model: LeaveRequest, attributes: ['id', 'startDate', 'endDate'] },
      ],
      order: [['effectiveDate', 'ASC'], ['createdAt', 'ASC']],
    });
    const actorIds = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))];
    const actors = new Map((actorIds.length ? await User.findAll({ where: { id: actorIds }, attributes: ['id', 'firstName', 'lastName'] }) : []).map((u) => [u.id, fullName(u)]));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      days: Number(r.days),
      effectiveDate: r.effectiveDate,
      note: r.note,
      leaveType: { id: r.leaveType!.id, code: r.leaveType!.code, name: r.leaveType!.name, color: r.leaveType!.color },
      request: r.leaveRequest ? { id: r.leaveRequest.id, startDate: r.leaveRequest.startDate, endDate: r.leaveRequest.endDate } : null,
      createdBy: r.createdById ? (actors.get(r.createdById) ?? null) : r.idempotencyKey ? 'Automatic' : null,
      createdAt: r.createdAt,
    }));
  }

  /** Manual grant, correction or encashment by HR (current leave year only). */
  async adjust(auth: AuthContext, dto: AdjustmentDto) {
    const employee = await this.resolveEmployee(auth, dto.employeeId, 'leave.allocate');
    const type = await LeaveType.findByPk(dto.leaveTypeId);
    if (!type) throw AppError.notFound('Leave type');
    if (type.unlimited) throw AppError.validation([{ field: 'leaveTypeId', message: `${type.name} has no balance to adjust` }]);
    if (!appliesTo(type, employee)) throw AppError.validation([{ field: 'leaveTypeId', message: `${type.name} does not apply to this employee` }]);
    if (!Number.isInteger(dto.days * 2)) throw AppError.validation([{ field: 'days', message: 'Use whole or half days' }]);
    if (dto.kind !== 'ADJUSTMENT' && dto.days < 0) throw AppError.validation([{ field: 'days', message: 'Enter a positive number of days' }]);
    if (dto.kind === 'ENCASHMENT' && !type.encashable) throw AppError.validation([{ field: 'kind', message: `${type.name} cannot be encashed` }]);
    const ctx = await this.yearContext(auth.organizationId!);
    const signed = dto.kind === 'ENCASHMENT' ? -dto.days : dto.days;
    await this.ensure(auth.organizationId!, [employee], ctx.currentYear);

    const entry = await this.db.transaction(async (transaction) => {
      await this.lockEmployee(employee.id, transaction);
      if (signed < 0) {
        const available = await this.available(employee, type, ctx.currentYear, undefined, transaction);
        if (available + signed < 0 && !(dto.kind === 'ADJUSTMENT' && type.allowNegativeBalance)) {
          throw AppError.validation([{ field: 'days', message: `Only ${available} day${available === 1 ? '' : 's'} available (pending requests are held back)` }]);
        }
      }
      const created = await LeaveLedgerEntry.create(
        {
          organizationId: auth.organizationId!,
          employeeId: employee.id,
          leaveTypeId: type.id,
          leaveYear: ctx.currentYear,
          kind: dto.kind,
          days: String(signed),
          effectiveDate: ctx.today,
          note: dto.note,
          createdById: auth.userId,
        },
        { transaction },
      );
      await this.audit.record(
        {
          action: `leave.balance_${dto.kind.toLowerCase()}`,
          entityType: 'Employee',
          entityId: employee.id,
          summary: `${type.code}: ${signed > 0 ? '+' : ''}${signed} day${Math.abs(signed) === 1 ? '' : 's'} for ${fullName(employee)} (${dto.kind.toLowerCase()})`,
          metadata: { leaveTypeId: type.id, days: signed, note: dto.note },
        },
        transaction,
      );
      return created;
    });

    const userId = await this.userIdOf(employee.membershipId);
    if (userId && userId !== auth.userId) {
      const verb = dto.kind === 'ENCASHMENT' ? `${dto.days} day${dto.days === 1 ? '' : 's'} of ${type.name} encashed` : `${type.name} balance ${signed > 0 ? 'increased' : 'reduced'} by ${Math.abs(signed)} day${Math.abs(signed) === 1 ? '' : 's'}`;
      await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'leave.balance', title: verb, body: dto.note, link: '/me/leave' });
    }
    return { id: entry.id, kind: entry.kind, days: Number(entry.days), effectiveDate: entry.effectiveDate };
  }

  /** Writes due accruals (and year-end carry-forward) for every current employee; safe to repeat. */
  async runAccruals(auth: AuthContext) {
    const ctx = await this.yearContext(auth.organizationId!);
    const range = leaveYearRange(ctx.currentYear, ctx.startMonth);
    const employees = await Employee.findAll({
      where: { dateOfJoining: { [Op.lte]: range.to }, [Op.or]: [{ exitDate: null }, { exitDate: { [Op.gte]: leaveYearRange(ctx.currentYear - 1, ctx.startMonth).from } }] },
      attributes: ['id', 'dateOfJoining', 'exitDate', 'gender'],
      order: [['id', 'ASC']],
    });
    const before = await LeaveLedgerEntry.count({ where: { idempotencyKey: { [Op.ne]: null } } });
    for (let i = 0; i < employees.length; i += 500) await this.ensure(auth.organizationId!, employees.slice(i, i + 500), ctx.currentYear);
    const written = (await LeaveLedgerEntry.count({ where: { idempotencyKey: { [Op.ne]: null } } })) - before;
    await this.audit.record({ action: 'leave.accruals_run', entityType: 'Organization', entityId: auth.organizationId!, summary: `Leave accruals brought up to date (${written} entries)`, metadata: { employees: employees.length, entries: written } });
    return { employees: employees.length, entries: written, year: ctx.currentYear };
  }

  /** Balance minus pending requests (optionally ignoring one request). Call `ensure` first, outside the transaction. */
  async available(employee: Pick<Employee, 'id'>, type: Pick<LeaveType, 'id'>, year: number, excludeRequestId?: string, transaction?: Transaction): Promise<number> {
    const [sum, pending] = await Promise.all([
      LeaveLedgerEntry.sum('days', { where: { employeeId: employee.id, leaveTypeId: type.id, leaveYear: year }, transaction }),
      LeaveRequest.sum('days', {
        where: { employeeId: employee.id, leaveTypeId: type.id, leaveYear: year, status: 'PENDING', ...(excludeRequestId ? { id: { [Op.ne]: excludeRequestId } } : {}) },
        transaction,
      }),
    ]);
    return round2(Number(sum ?? 0) - Number(pending ?? 0));
  }

  /** Serializes balance-changing operations per employee (NO KEY UPDATE does not block foreign-key checks elsewhere). */
  async lockEmployee(employeeId: string, transaction: Transaction): Promise<void> {
    await Employee.findByPk(employeeId, { attributes: ['id'], transaction, lock: transaction.LOCK.NO_KEY_UPDATE });
  }

  /** The employee whose leave is requested, within the caller's scope for `permission` (default: own record). */
  async resolveEmployee(auth: AuthContext, employeeId: string | undefined, permission = 'leave.view'): Promise<Employee> {
    if (!employeeId) {
      const self = await this.scope.self(auth);
      if (!self) throw AppError.notFound('Employee record linked to your account');
      if (!auth.permissions.has(permission)) throw AppError.forbidden();
      return (await Employee.findByPk(self.id, { attributes: LEAVE_EMPLOYEE_ATTRS }))!;
    }
    const employee = await Employee.findByPk(employeeId, { attributes: LEAVE_EMPLOYEE_ATTRS });
    if (!employee || !(await this.scope.covers(auth, 'leave.view', employee))) throw AppError.notFound('Employee');
    if (permission !== 'leave.view' && !(await this.scope.covers(auth, permission, employee))) throw AppError.forbidden();
    return employee;
  }

  async userIdOf(membershipId: string | null | undefined): Promise<string | null> {
    if (!membershipId) return null;
    const m = await OrganizationMembership.findByPk(membershipId, { attributes: ['userId', 'status'] });
    return m && m.status === 'ACTIVE' ? m.userId : null;
  }

  private async sums(employeeIds: string[], year: number) {
    const rows = (await LeaveLedgerEntry.findAll({
      where: { employeeId: employeeIds, leaveYear: year },
      attributes: ['employeeId', 'leaveTypeId', 'kind', [fn('SUM', col('days')), 'total']],
      group: ['employeeId', 'leaveTypeId', 'kind'],
      raw: true,
    })) as unknown as { employeeId: string; leaveTypeId: string; kind: LedgerKind; total: string }[];
    const out = new Map<string, { total: number; byKind: Map<LedgerKind, number> }>();
    for (const r of rows) {
      const k = `${r.employeeId}:${r.leaveTypeId}`;
      const entry = out.get(k) ?? { total: 0, byKind: new Map() };
      entry.total = round2(entry.total + Number(r.total));
      entry.byKind.set(r.kind, round2(Number(r.total)));
      out.set(k, entry);
    }
    return out;
  }

  private async pendingSums(employeeIds: string[], year: number) {
    const rows = (await LeaveRequest.findAll({
      where: { employeeId: employeeIds, leaveYear: year, status: 'PENDING' },
      attributes: ['employeeId', 'leaveTypeId', [fn('SUM', col('days')), 'total']],
      group: ['employeeId', 'leaveTypeId'],
      raw: true,
    })) as unknown as { employeeId: string; leaveTypeId: string; total: string }[];
    return new Map(rows.map((r) => [`${r.employeeId}:${r.leaveTypeId}`, round2(Number(r.total))]));
  }
}
