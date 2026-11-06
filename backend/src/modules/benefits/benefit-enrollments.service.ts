import { Injectable } from '@nestjs/common';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { LIVE_BENEFIT_STATUSES, type BenefitEnrollmentReason } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { addDays } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { BenefitEnrollment, BenefitEnrollmentDependent, BenefitPlan, BenefitPlanOption, Department, Employee, EmployeeFamilyMember, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { fullName, organizationToday, userIdsOf, usersWithPermission } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import { coverageStart, dependentProblems, eligibleFrom, enrollmentWindow, ineligibility, isDependentRelation, lifeEventProblem } from './benefits-rules';
import { ENROLLMENT_INCLUDE, presentEnrollment, presentPlan } from './benefits-present';
import type { DecisionDto, EndEnrollmentDto, EnrollDto, EnrollmentQueryDto, RejectDto, WaiveDto } from './dto/benefits.dto';

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Enrolments: employees choose an option and the family members it covers during the open enrolment window, within
 * 30 days of becoming eligible, or after a life event (approved by HR). `benefits.manage` approves, rejects and ends
 * coverage (never their own); `benefits.view` sees enrolments within its scope.
 */
@Injectable()
export class BenefitEnrollmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Employee ---------------------------------------------------------------------------------

  /** Plans offered to the caller with their window and current choice, plus the family members they can cover. */
  async mine(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return { plans: [], dependents: [], history: [], monthlyContribution: 0 };
    const today = await organizationToday(auth.organizationId!);
    const [plans, enrollments, family] = await Promise.all([
      BenefitPlan.findAll({ where: { status: 'ACTIVE' }, include: [{ model: BenefitPlanOption }], order: [['name', 'ASC']] }),
      BenefitEnrollment.findAll({ where: { employeeId: self.id }, include: ENROLLMENT_INCLUDE(), order: [['createdAt', 'DESC']] }),
      EmployeeFamilyMember.findAll({ where: { employeeId: self.id }, order: [['name', 'ASC']] }),
    ]);
    const current = (planId: string) => enrollments.find((e) => e.planId === planId && e.status === 'ACTIVE' && (!e.effectiveTo || e.effectiveTo >= today));
    const offered = plans
      .map((p) => ({ p, reason: ineligibility(p, self) }))
      .filter(({ p, reason }) => !reason || enrollments.some((e) => e.planId === p.id && LIVE_BENEFIT_STATUSES.includes(e.status)));
    return {
      plans: offered.map(({ p, reason }) => {
        const active = current(p.id);
        const window = reason ? null : enrollmentWindow(p, self, today);
        return {
          ...presentPlan(p),
          ineligible: reason,
          eligibleFrom: eligibleFrom(p, self),
          window,
          current: active ? presentEnrollment(active) : null,
          pending: (() => {
            const x = enrollments.find((e) => e.planId === p.id && e.status === 'PENDING');
            return x ? presentEnrollment(x) : null;
          })(),
          waived: enrollments.some((e) => e.planId === p.id && e.status === 'WAIVED'),
          canWaive: !reason && !p.mandatory && (!active || (!!window && !!active.effectiveFrom && active.effectiveFrom > today)),
        };
      }),
      dependents: family.map((f) => ({ id: f.id, name: f.name, relationship: f.relationship, dateOfBirth: f.dateOfBirth, isDependent: f.isDependent, coverable: isDependentRelation(f.relationship) })),
      history: enrollments.filter((e) => !LIVE_BENEFIT_STATUSES.includes(e.status)).slice(0, 20).map((e) => presentEnrollment(e)),
      monthlyContribution: plans.reduce((s, p) => s + Number(current(p.id)?.employeeMonthly ?? 0), 0),
    };
  }

  async enroll(auth: AuthContext, planId: string, dto: EnrollDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees can enrol in benefits');
    const plan = await BenefitPlan.findByPk(planId, { include: [{ model: BenefitPlanOption }] });
    if (!plan || plan.status !== 'ACTIVE') throw AppError.notFound('Plan');
    const blocked = ineligibility(plan, self);
    if (blocked) throw AppError.forbidden(blocked);
    const today = await organizationToday(auth.organizationId!);

    let reason: BenefitEnrollmentReason;
    if (dto.lifeEvent || dto.lifeEventDate) {
      if (!dto.lifeEvent || !dto.lifeEventDate) throw AppError.validation([{ field: dto.lifeEvent ? 'lifeEventDate' : 'lifeEvent', message: 'Give the life event and its date' }]);
      const problem = lifeEventProblem(dto.lifeEventDate, today, plan);
      if (problem) throw AppError.validation([{ field: 'lifeEventDate', message: problem }]);
      reason = 'LIFE_EVENT';
    } else {
      const window = enrollmentWindow(plan, self, today);
      if (!window) throw AppError.conflict('Enrolment is closed for this plan. Within 30 days of a life event, such as marriage or the birth of a child, you can still change your cover.');
      reason = window.kind;
    }
    const effectiveFrom = coverageStart(plan, self, reason, today, dto.lifeEventDate);
    if (effectiveFrom > plan.coverageEndsOn) throw AppError.conflict('The policy period has ended');
    const option = plan.options?.find((o) => o.id === dto.optionId);
    if (!option) throw AppError.validation([{ field: 'optionId', message: 'Choose one of the plan’s options' }]);
    const family = dto.dependentIds.length ? await EmployeeFamilyMember.findAll({ where: { id: dto.dependentIds, employeeId: self.id } }) : [];
    if (family.length !== dto.dependentIds.length) throw AppError.validation([{ field: 'dependentIds', message: 'Choose family members from your profile' }]);
    const problems = dependentProblems(option, plan.maxChildAge, family, effectiveFrom);
    if (problems.length) throw AppError.validation(problems.map((message) => ({ field: 'dependentIds', message })));
    const status = plan.requiresApproval || reason === 'LIFE_EVENT' ? 'PENDING' : 'ACTIVE';

    const id = await this.db.transaction(async (transaction) => {
      await Employee.findByPk(self.id, { attributes: ['id'], transaction, lock: transaction.LOCK.NO_KEY_UPDATE });
      const live = await BenefitEnrollment.findAll({ where: { planId, employeeId: self.id, status: LIVE_BENEFIT_STATUSES }, include: [{ model: BenefitEnrollmentDependent }], transaction });
      const active = live.find((e) => e.status === 'ACTIVE');
      const waived = live.find((e) => e.status === 'WAIVED');
      const pending = live.find((e) => e.status === 'PENDING');
      if (active && active.optionId === option.id && sameSet((active.dependents ?? []).map((d) => d.familyMemberId ?? ''), dto.dependentIds)) {
        throw AppError.conflict('You are already enrolled in this option with these dependants');
      }
      if (pending) await pending.update({ status: 'CANCELLED' }, { transaction });
      if (status === 'ACTIVE') {
        if (active) await this.endBefore(active, effectiveFrom, transaction);
        if (waived) await waived.update({ status: 'CANCELLED' }, { transaction });
      }
      const created = await BenefitEnrollment.create(
        {
          organizationId: auth.organizationId!,
          planId,
          optionId: option.id,
          employeeId: self.id,
          status,
          reason,
          lifeEvent: dto.lifeEvent ?? null,
          lifeEventDate: dto.lifeEventDate ?? null,
          note: dto.note ?? null,
          effectiveFrom,
          optionName: option.name,
          coverageAmount: option.coverageAmount,
          employeeMonthly: option.employeeMonthly,
          employerMonthly: option.employerMonthly,
          replacesId: status === 'PENDING' ? (active?.id ?? waived?.id ?? null) : null,
          createdById: auth.userId,
        },
        { transaction },
      );
      if (family.length) {
        await BenefitEnrollmentDependent.bulkCreate(
          family.map((f) => ({ organizationId: auth.organizationId!, enrollmentId: created.id, familyMemberId: f.id, name: f.name, relationship: f.relationship as 'SPOUSE', dateOfBirth: f.dateOfBirth, gender: f.gender })),
          { transaction },
        );
      }
      await this.audit.record(
        { action: status === 'PENDING' ? 'benefits.enrollment_requested' : 'benefits.enrolled', entityType: 'BenefitEnrollment', entityId: created.id, summary: `${self.employeeCode} ${status === 'PENDING' ? 'asked to enrol in' : 'enrolled in'} "${plan.name}" (${option.name})` },
        transaction,
      );
      if (status === 'PENDING') {
        for (const userId of await usersWithPermission('benefits.manage', transaction)) {
          if (userId !== auth.userId) await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'benefits.approval', title: `${fullName(self)} asked to enrol in ${plan.name}`, body: option.name, link: '/hr/benefits/enrollments' }, transaction);
        }
      }
      return created.id;
    });
    return this.get(id);
  }

  async waive(auth: AuthContext, planId: string, dto: WaiveDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees can waive benefits');
    const plan = await BenefitPlan.findByPk(planId);
    if (!plan || plan.status !== 'ACTIVE') throw AppError.notFound('Plan');
    if (plan.mandatory) throw AppError.conflict("This plan is mandatory and can't be waived");
    const blocked = ineligibility(plan, self);
    if (blocked) throw AppError.forbidden(blocked);
    const today = await organizationToday(auth.organizationId!);
    const window = enrollmentWindow(plan, self, today);
    const id = await this.db.transaction(async (transaction) => {
      await Employee.findByPk(self.id, { attributes: ['id'], transaction, lock: transaction.LOCK.NO_KEY_UPDATE });
      const live = await BenefitEnrollment.findAll({ where: { planId, employeeId: self.id, status: LIVE_BENEFIT_STATUSES }, transaction });
      if (live.some((e) => e.status === 'WAIVED')) throw AppError.conflict('You have already waived this plan');
      const active = live.find((e) => e.status === 'ACTIVE');
      if (active) {
        if (!window || !active.effectiveFrom || active.effectiveFrom <= today) throw AppError.conflict("Coverage that has started can't be dropped. Ask HR to end it, for example after a life event.");
        await active.update({ status: 'CANCELLED' }, { transaction });
      }
      for (const p of live.filter((e) => e.status === 'PENDING')) await p.update({ status: 'CANCELLED' }, { transaction });
      const created = await BenefitEnrollment.create(
        { organizationId: auth.organizationId!, planId, employeeId: self.id, status: 'WAIVED', reason: window?.kind ?? 'OPEN_ENROLLMENT', note: dto.note ?? null, createdById: auth.userId },
        { transaction },
      );
      await this.audit.record({ action: 'benefits.waived', entityType: 'BenefitEnrollment', entityId: created.id, summary: `${self.employeeCode} waived "${plan.name}"` }, transaction);
      return created.id;
    });
    return this.get(id);
  }

  async cancel(auth: AuthContext, id: string) {
    const self = await this.scope.self(auth);
    await this.db.transaction(async (transaction) => {
      const e = await BenefitEnrollment.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!e || !self || e.employeeId !== self.id) throw AppError.notFound('Enrolment');
      if (e.status !== 'PENDING') throw AppError.conflict('Only a pending request can be withdrawn');
      await e.update({ status: 'CANCELLED' }, { transaction });
      await this.audit.record({ action: 'benefits.enrollment_cancelled', entityType: 'BenefitEnrollment', entityId: id, summary: `${self.employeeCode} withdrew a benefit enrolment request` }, transaction);
    });
    return this.get(id);
  }

  // ---- HR ---------------------------------------------------------------------------------------

  async list(auth: AuthContext, query: EnrollmentQueryDto) {
    const scoped = auth.permissions.has('benefits.manage') ? {} : await this.scope.where(auth, 'benefits.view', 'employeeId');
    if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
    const conditions: WhereOptions[] = [scoped];
    if (query.planId) conditions.push({ planId: query.planId });
    if (query.status) conditions.push({ status: query.status });
    const like = query.search ? containsPattern(query.search) : null;
    const employeeWhere = like ? { [Op.or]: [{ firstName: { [Op.iLike]: like } }, { lastName: { [Op.iLike]: like } }, { employeeCode: { [Op.iLike]: like } }] } : undefined;
    const where = { [Op.and]: conditions };
    const count = await BenefitEnrollment.count({ where, include: [{ model: Employee, where: employeeWhere, required: !!like }] });
    const rows = await BenefitEnrollment.findAll({
      where,
      include: [
        { model: BenefitPlan, attributes: ['id', 'name', 'type', 'provider'] },
        { model: Employee, attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'departmentId'], where: employeeWhere, required: !!like, include: [{ model: Department, attributes: ['id', 'name'] }] },
        { model: BenefitEnrollmentDependent },
      ],
      order: [['createdAt', 'DESC']],
      ...paginationArgs(query),
    });
    const names = await this.names(rows.map((r) => r.decidedById));
    return new PaginatedResult(
      rows.map((r) => presentEnrollment(r, names)),
      paginationMeta(query, count),
    );
  }

  async approve(auth: AuthContext, id: string, dto: DecisionDto) {
    await this.db.transaction(async (transaction) => {
      const { e, plan } = await this.decidable(auth, id, transaction);
      const others = await BenefitEnrollment.findAll({ where: { planId: e.planId, employeeId: e.employeeId, status: ['ACTIVE', 'WAIVED'] }, transaction });
      for (const o of others) {
        if (o.status === 'ACTIVE') await this.endBefore(o, e.effectiveFrom!, transaction);
        else await o.update({ status: 'CANCELLED' }, { transaction });
      }
      await e.update({ status: 'ACTIVE', decidedById: auth.userId, decidedAt: new Date(), decisionNote: dto.note ?? null }, { transaction });
      await this.audit.record({ action: 'benefits.enrollment_approved', entityType: 'BenefitEnrollment', entityId: id, summary: `Enrolment in "${plan.name}" approved` }, transaction);
      await this.notifyEmployee(e, `Your enrolment in ${plan.name} was approved`, `Covered from ${e.effectiveFrom}.`, transaction);
    });
    return this.get(id);
  }

  async reject(auth: AuthContext, id: string, dto: RejectDto) {
    await this.db.transaction(async (transaction) => {
      const { e, plan } = await this.decidable(auth, id, transaction);
      await e.update({ status: 'REJECTED', decidedById: auth.userId, decidedAt: new Date(), decisionNote: dto.note }, { transaction });
      await this.audit.record({ action: 'benefits.enrollment_rejected', entityType: 'BenefitEnrollment', entityId: id, summary: `Enrolment in "${plan.name}" rejected` }, transaction);
      await this.notifyEmployee(e, `Your enrolment in ${plan.name} was not approved`, dto.note, transaction);
    });
    return this.get(id);
  }

  /** Ends active coverage on a date (e.g. after a divorce or when someone leaves); before it started, it's cancelled. */
  async end(auth: AuthContext, id: string, dto: EndEnrollmentDto) {
    await this.db.transaction(async (transaction) => {
      const e = await BenefitEnrollment.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!e) throw AppError.notFound('Enrolment');
      const self = await this.scope.self(auth);
      if (self && e.employeeId === self.id) throw AppError.forbidden("You can't end your own coverage");
      if (e.status !== 'ACTIVE') throw AppError.conflict('Only active coverage can be ended');
      const plan = (await BenefitPlan.findByPk(e.planId, { transaction }))!;
      if (dto.effectiveTo > plan.coverageEndsOn) throw AppError.validation([{ field: 'effectiveTo', message: 'Coverage ends with the policy period anyway' }]);
      const cancelled = dto.effectiveTo < e.effectiveFrom!;
      await e.update(cancelled ? { status: 'CANCELLED', decisionNote: dto.note ?? null } : { status: 'ENDED', effectiveTo: dto.effectiveTo, decisionNote: dto.note ?? e.decisionNote }, { transaction });
      await this.audit.record({ action: 'benefits.enrollment_ended', entityType: 'BenefitEnrollment', entityId: id, summary: `Coverage under "${plan.name}" ${cancelled ? 'cancelled before it started' : `ended on ${dto.effectiveTo}`}` }, transaction);
      await this.notifyEmployee(e, cancelled ? `Your coverage under ${plan.name} was cancelled` : `Your coverage under ${plan.name} ends on ${dto.effectiveTo}`, dto.note ?? undefined, transaction);
    });
    return this.get(id);
  }

  async get(id: string) {
    const e = await BenefitEnrollment.findByPk(id, { include: ENROLLMENT_INCLUDE() });
    if (!e) throw AppError.notFound('Enrolment');
    return presentEnrollment(e, await this.names([e.decidedById]));
  }

  // ---- Internals --------------------------------------------------------------------------------

  private async decidable(auth: AuthContext, id: string, transaction: Transaction) {
    const e = await BenefitEnrollment.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!e) throw AppError.notFound('Enrolment');
    const self = await this.scope.self(auth);
    if (self && e.employeeId === self.id) throw AppError.forbidden("You can't decide on your own enrolment");
    if (e.status !== 'PENDING') throw AppError.conflict('Only a pending request can be decided');
    const plan = (await BenefitPlan.findByPk(e.planId, { transaction }))!;
    if (plan.status !== 'ACTIVE') throw AppError.conflict('The plan is no longer active');
    return { e, plan };
  }

  /** Ends coverage the day before a replacement starts (or cancels it when it hadn't started yet). */
  private async endBefore(active: BenefitEnrollment, nextFrom: string, transaction: Transaction) {
    const last = addDays(nextFrom, -1);
    if (!active.effectiveFrom || last < active.effectiveFrom) await active.update({ status: 'CANCELLED' }, { transaction });
    else await active.update({ status: 'ENDED', effectiveTo: active.effectiveTo && active.effectiveTo < last ? active.effectiveTo : last }, { transaction });
  }

  private async notifyEmployee(e: BenefitEnrollment, title: string, body: string | undefined, transaction: Transaction) {
    const userId = (await userIdsOf([e.employeeId], transaction)).get(e.employeeId);
    if (userId) await this.notifications.notify(userId, { organizationId: e.organizationId, type: 'benefits.enrollment', title, body, link: '/me/benefits' }, transaction);
  }

  private async names(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }
}
