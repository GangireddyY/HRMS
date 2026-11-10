import { Injectable } from '@nestjs/common';
import { literal, Op, type Transaction, type WhereOptions } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { fullName } from '../../common/utils/names';
import { DatabaseService } from '../../database/database.service';
import { Employee, LeaveEncashment, LeaveLedgerEntry, LeaveType, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { userIdsOf, usersWithPermission } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { EncashmentQueryDto, EncashmentRequestDto, RejectLeaveDto, ReviewLeaveDto } from './dto/leave.dto';
import { appliesTo, LEAVE_EMPLOYEE_ATTRS, LeaveBalanceService } from './leave-balance.service';
import { round2 } from './leave-policy';

const dayWord = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
/** Requests that use up the yearly encashment limit. */
const COUNTED = ['PENDING', 'APPROVED', 'PAID'] as const;

/**
 * Leave encashment while in service: an employee asks to be paid for unused days of an encashable type (within the
 * type's yearly limit, keeping its minimum balance); HR (`leave.allocate`, never for themselves) approves, which takes
 * the days out of the balance, and the next payroll run pays them as a taxable earning (Basic or gross per day, from
 * payroll setup). Without payroll, approval records it as paid outside payroll.
 */
@Injectable()
export class EncashmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly balances: LeaveBalanceService,
    private readonly notifications: NotificationsService,
  ) {}

  /** What the signed-in employee can encash this leave year, per encashable type. */
  async options(auth: AuthContext) {
    const employee = await this.self(auth);
    const year = await this.balances.yearContext(auth.organizationId!);
    const types = (await LeaveType.findAll({ where: { encashable: true, isActive: true, unlimited: false }, order: [['name', 'ASC']] })).filter((t) => appliesTo(t, employee));
    if (!types.length) return { year: year.currentYear, types: [] };
    await this.balances.ensure(auth.organizationId!, [employee], year.currentYear);
    const used = await this.usedThisYear(employee.id, year.currentYear);
    const out = [];
    for (const t of types) {
      const available = await this.balances.available(employee, t, year.currentYear);
      out.push({ ...this.limits(t, available, used.get(t.id) ?? 0), leaveType: { id: t.id, code: t.code, name: t.name, color: t.color } });
    }
    return { year: year.currentYear, types: out };
  }

  async request(auth: AuthContext, dto: EncashmentRequestDto) {
    const employee = await this.self(auth);
    if (employee.status === 'EXITED') throw AppError.forbidden('You have exited the organization');
    if (employee.status === 'ON_NOTICE') throw AppError.conflict('Unused leave is settled in your full & final settlement');
    const type = await LeaveType.findByPk(dto.leaveTypeId);
    if (!type || !type.isActive || !appliesTo(type, employee)) throw AppError.validation([{ field: 'leaveTypeId', message: 'Choose a leave type that applies to you' }]);
    if (!type.encashable || type.unlimited) throw AppError.validation([{ field: 'leaveTypeId', message: `${type.name} can't be encashed` }]);
    if (!Number.isInteger(dto.days * 2)) throw AppError.validation([{ field: 'days', message: 'Use whole or half days' }]);
    const year = await this.balances.yearContext(auth.organizationId!);
    await this.balances.ensure(auth.organizationId!, [employee], year.currentYear);
    const id = await this.db.transaction(async (transaction) => {
      await this.balances.lockEmployee(employee.id, transaction);
      if (await LeaveEncashment.count({ where: { employeeId: employee.id, leaveTypeId: type.id, status: 'PENDING' }, transaction }))
        throw AppError.conflict(`You already have a ${type.name} encashment waiting for approval`);
      await this.checkLimits(employee, type, year.currentYear, dto.days, transaction);
      const r = await LeaveEncashment.create(
        { organizationId: auth.organizationId!, employeeId: employee.id, leaveTypeId: type.id, leaveYear: year.currentYear, days: String(dto.days), reason: dto.reason ?? null, requestedById: auth.userId },
        { transaction },
      );
      await this.audit.record({ action: 'leave.encashment_requested', entityType: 'LeaveEncashment', entityId: r.id, summary: `${type.code}: ${dayWord(dto.days)} to encash (${employee.employeeCode})` }, transaction);
      for (const userId of await usersWithPermission('leave.allocate', transaction)) {
        if (userId === auth.userId) continue;
        await this.notifications.notify(
          userId,
          { organizationId: auth.organizationId, type: 'leave.encashment', title: `${fullName(employee)} asked to encash ${dayWord(dto.days)} of ${type.name}`, body: dto.reason ?? undefined, link: '/hr/leave/balances' },
          transaction,
        );
      }
      return r.id;
    });
    return this.get(auth, id);
  }

  async list(auth: AuthContext, query: EncashmentQueryDto) {
    const filters: WhereOptions[] = [];
    if ((query.view ?? 'mine') === 'all') {
      if (!auth.permissions.has('leave.allocate')) throw AppError.forbidden();
    } else {
      const self = await this.scope.self(auth);
      if (!self) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push({ employeeId: self.id });
    }
    if (query.status) filters.push({ status: query.status });
    const { rows, count } = await LeaveEncashment.findAndCountAll({
      where: { [Op.and]: filters },
      include: [
        { model: Employee, attributes: ['id', 'firstName', 'lastName', 'employeeCode'] },
        { model: LeaveType, attributes: ['id', 'code', 'name', 'color'] },
      ],
      order: [
        [literal(`CASE WHEN "LeaveEncashment"."status" = 'PENDING' THEN 0 ELSE 1 END`), 'ASC'],
        ['createdAt', 'DESC'],
      ],
      ...paginationArgs(query),
    });
    const names = await this.names(rows.map((r) => r.reviewedById));
    const self = await this.scope.self(auth);
    return new PaginatedResult(
      rows.map((r) => this.present(auth, r, names, self?.id ?? null)),
      paginationMeta(query, count),
    );
  }

  async approve(auth: AuthContext, id: string, dto: ReviewLeaveDto) {
    const year = await this.balances.yearContext(auth.organizationId!);
    const viaPayroll = auth.features.has('payroll');
    await this.review(auth, id, async (r, employee, type, transaction) => {
      if (r.leaveYear !== year.currentYear) throw AppError.conflict(`This request was for the ${r.leaveYear} leave year; the employee can ask again for this year`);
      await this.checkLimits(employee, type, year.currentYear, Number(r.days), transaction, r.id);
      const now = new Date();
      await r.update(
        { status: viaPayroll ? 'APPROVED' : 'PAID', paidAt: viaPayroll ? null : now, reviewedById: auth.userId, reviewedAt: now, reviewNote: dto.note ?? null },
        { transaction },
      );
      await LeaveLedgerEntry.create(
        {
          organizationId: r.organizationId,
          employeeId: r.employeeId,
          leaveTypeId: r.leaveTypeId,
          leaveYear: r.leaveYear,
          kind: 'ENCASHMENT',
          days: String(-Number(r.days)),
          effectiveDate: year.today,
          note: viaPayroll ? 'Encashed; paid with the next payroll' : 'Encashed (paid outside payroll)',
          idempotencyKey: `encash:${r.id}`,
          createdById: auth.userId,
        },
        { transaction },
      );
      await this.audit.record({ action: 'leave.encashment_approved', entityType: 'LeaveEncashment', entityId: id, summary: `${type.code}: ${dayWord(Number(r.days))} encashment for ${employee.employeeCode} approved` }, transaction);
      await this.tell(r, `Encashment of ${dayWord(Number(r.days))} of ${type.name} approved`, viaPayroll ? 'It will be paid with your next salary.' : (dto.note ?? undefined), transaction);
    });
    return this.get(auth, id);
  }

  async reject(auth: AuthContext, id: string, dto: RejectLeaveDto) {
    await this.review(auth, id, async (r, employee, type, transaction) => {
      await r.update({ status: 'REJECTED', reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note }, { transaction });
      await this.audit.record({ action: 'leave.encashment_rejected', entityType: 'LeaveEncashment', entityId: id, summary: `${type.code}: encashment for ${employee.employeeCode} rejected` }, transaction);
      await this.tell(r, `Encashment of ${type.name} was not approved`, dto.note, transaction);
    });
    return this.get(auth, id);
  }

  async cancel(auth: AuthContext, id: string) {
    const self = await this.scope.self(auth);
    await this.db.transaction(async (transaction) => {
      const r = await LeaveEncashment.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!r || !self || r.employeeId !== self.id) throw AppError.notFound('Encashment');
      if (r.status !== 'PENDING') throw AppError.conflict('Only a pending request can be withdrawn');
      await r.update({ status: 'CANCELLED' }, { transaction });
    });
    return this.get(auth, id);
  }

  private async checkLimits(employee: Employee, type: LeaveType, year: number, days: number, transaction: Transaction, excludeId?: string) {
    const available = await this.balances.available(employee, type, year, undefined, transaction);
    const used = (await this.usedThisYear(employee.id, year, transaction, excludeId)).get(type.id) ?? 0;
    const limits = this.limits(type, available, used);
    if (days > limits.max) throw AppError.validation([{ field: 'days', message: limits.blocked ?? `Up to ${dayWord(limits.max)} can be encashed now` }]);
  }

  /** The most that can be encashed now: the balance above the minimum to keep, within what's left of the yearly limit. */
  private limits(type: LeaveType, available: number, used: number) {
    const keep = Number(type.encashMinBalance ?? 0);
    const yearly = type.encashMaxDays === null ? null : Number(type.encashMaxDays);
    const byBalance = Math.max(0, available - keep);
    const byYear = yearly === null ? Infinity : Math.max(0, yearly - used);
    const max = Math.floor(Math.min(byBalance, byYear) * 2) / 2;
    const blocked = max > 0 ? null : byYear <= 0 ? `The ${yearly}-day yearly limit is used up` : keep ? `At least ${dayWord(keep)} must stay in the balance` : 'No balance to encash';
    return { available: round2(available), keep, yearlyLimit: yearly, usedThisYear: used, max, blocked };
  }

  private async usedThisYear(employeeId: string, year: number, transaction?: Transaction, excludeId?: string) {
    const rows = await LeaveEncashment.findAll({
      where: { employeeId, leaveYear: year, status: [...COUNTED], ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) },
      attributes: ['leaveTypeId', 'days'],
      transaction,
    });
    const out = new Map<string, number>();
    for (const r of rows) out.set(r.leaveTypeId, round2((out.get(r.leaveTypeId) ?? 0) + Number(r.days)));
    return out;
  }

  private async review(auth: AuthContext, id: string, fn: (r: LeaveEncashment, employee: Employee, type: LeaveType, transaction: Transaction) => Promise<void>) {
    const pre = await LeaveEncashment.findByPk(id, { attributes: ['employeeId', 'leaveYear'] });
    if (!pre) throw AppError.notFound('Encashment');
    const employee = (await Employee.findByPk(pre.employeeId, { attributes: LEAVE_EMPLOYEE_ATTRS }))!;
    if (auth.membershipId && employee.membershipId === auth.membershipId) throw AppError.forbidden("You can't review your own encashment");
    await this.balances.ensure(auth.organizationId!, [employee], pre.leaveYear);
    await this.db.transaction(async (transaction) => {
      await this.balances.lockEmployee(employee.id, transaction);
      const r = (await LeaveEncashment.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE }))!;
      if (r.status !== 'PENDING') throw AppError.conflict(`This request is already ${r.status.toLowerCase()}`);
      const type = (await LeaveType.findByPk(r.leaveTypeId, { transaction }))!;
      await fn(r, employee, type, transaction);
    });
  }

  private async self(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.notFound('Employee record linked to your account');
    return (await Employee.findByPk(self.id, { attributes: LEAVE_EMPLOYEE_ATTRS }))!;
  }

  private async get(auth: AuthContext, id: string) {
    const r = (await LeaveEncashment.findByPk(id, {
      include: [
        { model: Employee, attributes: ['id', 'firstName', 'lastName', 'employeeCode'] },
        { model: LeaveType, attributes: ['id', 'code', 'name', 'color'] },
      ],
    }))!;
    const self = await this.scope.self(auth);
    return this.present(auth, r, await this.names([r.reviewedById]), self?.id ?? null);
  }

  private async tell(r: LeaveEncashment, title: string, body: string | undefined, transaction: Transaction) {
    const userId = (await userIdsOf([r.employeeId], transaction)).get(r.employeeId);
    if (userId) await this.notifications.notify(userId, { organizationId: r.organizationId, type: 'leave.encashment', title, body, link: '/me/leave' }, transaction);
  }

  private present(auth: AuthContext, r: LeaveEncashment, names: Map<string, string>, selfId: string | null) {
    const own = r.employeeId === selfId;
    return {
      id: r.id,
      employee: r.employee ? { id: r.employee.id, name: fullName(r.employee), employeeCode: r.employee.employeeCode } : null,
      leaveType: r.leaveType ? { id: r.leaveType.id, code: r.leaveType.code, name: r.leaveType.name, color: r.leaveType.color } : null,
      leaveYear: r.leaveYear,
      days: Number(r.days),
      reason: r.reason,
      status: r.status,
      reviewNote: r.reviewNote,
      reviewedBy: r.reviewedById ? (names.get(r.reviewedById) ?? 'Former user') : null,
      reviewedAt: r.reviewedAt,
      payrollRunId: r.payrollRunId,
      amount: r.amount === null ? null : Number(r.amount),
      paidAt: r.paidAt,
      createdAt: r.createdAt,
      permissions: { review: r.status === 'PENDING' && !own && auth.permissions.has('leave.allocate'), cancel: own && r.status === 'PENDING' },
    };
  }

  private async names(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }
}
