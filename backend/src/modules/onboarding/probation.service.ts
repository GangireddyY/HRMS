import { Injectable } from '@nestjs/common';
import { literal, Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import { PROBATION_MAX_EXTENSION_DAYS } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { addDays, zonedParts } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { Department, Designation, Employee, EmployeeLifecycleEvent, Organization, OrganizationMembership, ProbationReview, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { DecideReviewDto, ProbationReviewDto, ProbationReviewQueryDto } from './dto/onboarding.dto';
import { fullName } from '../../common/utils/names';

const EMPLOYEE_ATTRS = ['id', 'organizationId', 'employeeCode', 'firstName', 'lastName', 'status', 'dateOfJoining', 'probationEndDate', 'confirmedOn', 'managerId', 'departmentId', 'membershipId'];
const EMPLOYEE_INCLUDE = [
  { model: Department, attributes: ['id', 'name'] },
  { model: Designation, attributes: ['id', 'name'] },
];

/**
 * Probation confirmation. The employee's direct manager (or HR with onboarding.manage) recommends confirming or extending;
 * someone with onboarding.confirmation.approve in scope decides — never the person who recommended it, nor the employee.
 * Approval updates the employee record and writes a lifecycle event.
 */
@Injectable()
export class ProbationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Unconfirmed employees whose probation ends within `days` (or already ended): in onboarding.view scope, plus own direct reports. */
  async due(auth: AuthContext, days: number) {
    this.assertEntitled(auth);
    const today = await this.today(auth.organizationId!);
    const self = await this.scope.self(auth);
    const scoped = await this.scope.where(auth, 'onboarding.view');
    const organizationWide = !!scoped && Object.keys(scoped).length === 0 && Object.getOwnPropertySymbols(scoped).length === 0;
    const visibility: WhereOptions[] = [...(scoped ? [scoped] : []), ...(self ? [{ managerId: self.id }] : [])];
    if (!visibility.length) return [];
    const rows = await Employee.findAll({
      where: {
        [Op.and]: [
          ...(organizationWide ? [] : [{ [Op.or]: visibility }]),
          { status: 'ACTIVE', confirmedOn: null, probationEndDate: { [Op.ne]: null, [Op.lte]: addDays(today, days) } },
          ...(self ? [{ id: { [Op.ne]: self.id } }] : []),
        ],
      },
      attributes: EMPLOYEE_ATTRS,
      include: EMPLOYEE_INCLUDE,
      order: [['probationEndDate', 'ASC']],
      limit: 500,
    });
    const pending = rows.length ? await ProbationReview.findAll({ where: { employeeId: rows.map((r) => r.id), status: 'PENDING' } }) : [];
    const byEmployee = new Map(pending.map((p) => [p.employeeId, p]));
    return rows.map((e) => ({
      employee: this.ref(e),
      probationEndDate: e.probationEndDate,
      daysLeft: Math.round((new Date(`${e.probationEndDate}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000),
      isDirectReport: !!self && e.managerId === self.id,
      pendingReview: byEmployee.has(e.id) ? { id: byEmployee.get(e.id)!.id, recommendation: byEmployee.get(e.id)!.recommendation, submittedAt: byEmployee.get(e.id)!.createdAt } : null,
    }));
  }

  async submit(auth: AuthContext, dto: ProbationReviewDto) {
    this.assertEntitled(auth);
    const employee = await Employee.findByPk(dto.employeeId, { attributes: EMPLOYEE_ATTRS });
    if (!employee) throw AppError.notFound('Employee');
    const self = await this.scope.self(auth);
    if (self?.id === employee.id) throw AppError.forbidden('You cannot review your own probation');
    const isManager = !!self && employee.managerId === self.id;
    const isHr = auth.permissions.has('onboarding.manage') && (await this.scope.covers(auth, 'onboarding.view', employee));
    if (!isManager && !isHr) throw AppError.notFound('Employee');
    if (employee.status !== 'ACTIVE') throw AppError.validation([{ field: 'employeeId', message: 'The employee is not active' }]);
    if (employee.confirmedOn) throw AppError.conflict(`${fullName(employee)} was already confirmed on ${employee.confirmedOn}`);
    if (!employee.probationEndDate) throw AppError.validation([{ field: 'employeeId', message: 'Set a probation end date on the employee first' }]);
    if (dto.recommendation === 'EXTEND') {
      if (!dto.extendTo) throw AppError.validation([{ field: 'extendTo', message: 'Choose the new probation end date' }]);
      if (dto.extendTo <= employee.probationEndDate) throw AppError.validation([{ field: 'extendTo', message: 'The new date must be after the current probation end date' }]);
      if (dto.extendTo > addDays(employee.probationEndDate, PROBATION_MAX_EXTENSION_DAYS)) throw AppError.validation([{ field: 'extendTo', message: `Extend by at most ${PROBATION_MAX_EXTENSION_DAYS} days at a time` }]);
    }
    try {
      const review = await this.db.transaction(async (transaction) => {
        const created = await ProbationReview.create(
          {
            organizationId: auth.organizationId!,
            employeeId: employee.id,
            probationEndDate: employee.probationEndDate!,
            recommendation: dto.recommendation,
            extendTo: dto.recommendation === 'EXTEND' ? dto.extendTo! : null,
            comments: dto.comments,
            submittedById: auth.userId,
          },
          { transaction },
        );
        await this.audit.record(
          { action: 'probation.review_submitted', entityType: 'Employee', entityId: employee.id, summary: `Probation ${dto.recommendation === 'CONFIRM' ? 'confirmation' : 'extension'} recommended for ${fullName(employee)}` },
          transaction,
        );
        return created;
      });
      return this.get(review.id);
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict(`A review for ${fullName(employee)} is already waiting for a decision`);
      throw e;
    }
  }

  async list(auth: AuthContext, query: ProbationReviewQueryDto) {
    this.assertEntitled(auth);
    const filters: WhereOptions[] = [];
    if ((query.view ?? 'approve') === 'mine') filters.push({ submittedById: auth.userId });
    else {
      const scoped = await this.scope.where(auth, 'onboarding.confirmation.approve', 'employeeId');
      if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
      const self = await this.scope.self(auth);
      filters.push(scoped, { submittedById: { [Op.ne]: auth.userId } });
      if (self) filters.push({ employeeId: { [Op.ne]: self.id } });
    }
    if (query.status) filters.push({ status: query.status });
    const { rows, count } = await ProbationReview.findAndCountAll({
      where: { [Op.and]: filters },
      include: [{ model: Employee, attributes: EMPLOYEE_ATTRS, include: EMPLOYEE_INCLUDE }],
      order: [[literal(`CASE WHEN "ProbationReview"."status" = 'PENDING' THEN 0 ELSE 1 END`), 'ASC'], ['createdAt', 'DESC']],
      distinct: true,
      ...paginationArgs(query),
    });
    const names = await this.names(rows);
    return new PaginatedResult(rows.map((r) => this.present(r, names)), paginationMeta(query, count));
  }

  async approve(auth: AuthContext, id: string, dto: DecideReviewDto) {
    const { review, employee } = await this.forDecision(auth, id);
    const today = await this.today(auth.organizationId!);
    if (employee.confirmedOn) throw AppError.conflict(`${fullName(employee)} was already confirmed on ${employee.confirmedOn}`);
    await this.db.transaction(async (transaction) => {
      const fresh = await ProbationReview.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (fresh!.status !== 'PENDING') throw AppError.conflict('This review was already decided');
      const before = employee.probationEndDate;
      if (review.recommendation === 'CONFIRM') {
        // Confirmed as of the probation end date, or today when confirming early.
        const effective = before && before <= today ? before : today;
        await employee.update({ confirmedOn: effective, probationEndDate: effective, updatedById: auth.userId }, { transaction });
        await EmployeeLifecycleEvent.create(
          {
            organizationId: auth.organizationId!,
            employeeId: employee.id,
            type: 'CONFIRMATION',
            effectiveDate: effective,
            changes: before === effective ? {} : { probationEndDate: { from: before, to: effective } },
            note: review.comments.slice(0, 500),
            createdById: auth.userId,
          },
          { transaction },
        );
      } else {
        await employee.update({ probationEndDate: review.extendTo, updatedById: auth.userId }, { transaction });
        await EmployeeLifecycleEvent.create(
          {
            organizationId: auth.organizationId!,
            employeeId: employee.id,
            type: 'PROBATION_EXTENDED',
            effectiveDate: today,
            changes: { probationEndDate: { from: before, to: review.extendTo } },
            note: review.comments.slice(0, 500),
            createdById: auth.userId,
          },
          { transaction },
        );
      }
      await fresh!.update({ status: 'APPROVED', reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note ?? null }, { transaction });
      await this.audit.record(
        {
          action: review.recommendation === 'CONFIRM' ? 'probation.confirmed' : 'probation.extended',
          entityType: 'Employee',
          entityId: employee.id,
          summary: review.recommendation === 'CONFIRM' ? `${fullName(employee)} confirmed` : `Probation of ${fullName(employee)} extended to ${review.extendTo}`,
        },
        transaction,
      );
    });

    const employeeUser = await this.userIdOf(employee.membershipId);
    const title = review.recommendation === 'CONFIRM' ? 'Congratulations! Your probation is confirmed' : `Your probation has been extended to ${review.extendTo}`;
    if (employeeUser && employeeUser !== auth.userId) await this.notifications.notify(employeeUser, { organizationId: auth.organizationId, type: 'probation', title, link: '/me/employment' });
    await this.notifySubmitter(auth, review, `Your probation review for ${fullName(employee)} was approved`, dto.note);
    return this.get(id);
  }

  async reject(auth: AuthContext, id: string, dto: DecideReviewDto) {
    if (!dto.note) throw AppError.validation([{ field: 'note', message: 'Explain why the recommendation is rejected' }]);
    const { review, employee } = await this.forDecision(auth, id);
    await this.db.transaction(async (transaction) => {
      const [count] = await ProbationReview.update({ status: 'REJECTED', reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note }, { where: { id, status: 'PENDING' }, transaction });
      if (!count) throw AppError.conflict('This review was already decided');
      await this.audit.record({ action: 'probation.review_rejected', entityType: 'Employee', entityId: employee.id, summary: `Probation review for ${fullName(employee)} rejected` }, transaction);
    });
    await this.notifySubmitter(auth, review, `Your probation review for ${fullName(employee)} was rejected`, dto.note);
    return this.get(id);
  }

  async cancel(auth: AuthContext, id: string) {
    this.assertEntitled(auth);
    const review = await ProbationReview.findByPk(id);
    if (!review || review.submittedById !== auth.userId) throw AppError.notFound('Probation review');
    if (review.status !== 'PENDING') throw AppError.conflict('Only pending reviews can be withdrawn');
    await this.db.transaction(async (transaction) => {
      await review.update({ status: 'CANCELLED' }, { transaction });
      await this.audit.record({ action: 'probation.review_cancelled', entityType: 'Employee', entityId: review.employeeId }, transaction);
    });
    return this.get(id);
  }

  // ---------------------------------------------------------------------------------------------

  private assertEntitled(auth: AuthContext) {
    if (!auth.features.has('onboarding')) throw AppError.forbidden('Onboarding is not included in your organization’s plan');
  }

  private async forDecision(auth: AuthContext, id: string) {
    this.assertEntitled(auth);
    const review = await ProbationReview.findByPk(id);
    if (!review) throw AppError.notFound('Probation review');
    const employee = await Employee.findByPk(review.employeeId, { attributes: EMPLOYEE_ATTRS });
    if (!employee || !(await this.scope.covers(auth, 'onboarding.confirmation.approve', employee))) throw AppError.notFound('Probation review');
    const self = await this.scope.self(auth);
    if (self?.id === employee.id) throw AppError.forbidden('You cannot decide on your own probation');
    if (review.submittedById === auth.userId) throw AppError.forbidden('Someone other than the person who recommended it must decide');
    if (review.status !== 'PENDING') throw AppError.conflict('This review was already decided');
    return { review, employee };
  }

  private async get(id: string) {
    const r = await ProbationReview.findByPk(id, { include: [{ model: Employee, attributes: EMPLOYEE_ATTRS, include: EMPLOYEE_INCLUDE }] });
    return this.present(r!, await this.names([r!]));
  }

  private present(r: ProbationReview, names: Map<string, string>) {
    return {
      id: r.id,
      employee: r.employee ? this.ref(r.employee) : null,
      probationEndDate: r.probationEndDate,
      recommendation: r.recommendation,
      extendTo: r.extendTo,
      comments: r.comments,
      status: r.status,
      submittedBy: r.submittedById ? (names.get(r.submittedById) ?? null) : null,
      submittedAt: r.createdAt,
      reviewedBy: r.reviewedById ? (names.get(r.reviewedById) ?? null) : null,
      reviewedAt: r.reviewedAt,
      reviewNote: r.reviewNote,
    };
  }

  private ref(e: Employee) {
    return {
      id: e.id,
      name: fullName(e),
      employeeCode: e.employeeCode,
      dateOfJoining: e.dateOfJoining,
      probationEndDate: e.probationEndDate,
      designation: e.designation ? { id: e.designation.id, name: e.designation.name } : null,
      department: e.department ? { id: e.department.id, name: e.department.name } : null,
    };
  }

  private async names(rows: ProbationReview[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.flatMap((r) => [r.submittedById, r.reviewedById]).filter((x): x is string => !!x))];
    if (!ids.length) return new Map();
    return new Map((await User.findAll({ where: { id: ids }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }

  private async notifySubmitter(auth: AuthContext, review: ProbationReview, title: string, note?: string | null) {
    if (!review.submittedById || review.submittedById === auth.userId) return;
    await this.notifications.notify(review.submittedById, { organizationId: auth.organizationId, type: 'probation', title, body: note ?? undefined, link: '/me/onboarding' });
  }

  private async today(organizationId: string): Promise<string> {
    const org = await Organization.findByPk(organizationId, { attributes: ['timezone'] });
    return zonedParts(new Date(), org?.timezone ?? 'UTC').date;
  }

  private async userIdOf(membershipId: string | null | undefined): Promise<string | null> {
    if (!membershipId) return null;
    const m = await OrganizationMembership.findByPk(membershipId, { attributes: ['userId', 'status'] });
    return m && m.status !== 'SUSPENDED' ? m.userId : null;
  }
}
