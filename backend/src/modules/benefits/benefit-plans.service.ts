import { Injectable } from '@nestjs/common';
import { col, fn, Op, type Transaction, type WhereOptions } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { csvCell } from '../../common/utils/csv';
import { containsPattern } from '../../common/utils/like';
import { DatabaseService } from '../../database/database.service';
import { BenefitEnrollment, BenefitEnrollmentDependent, BenefitPlan, BenefitPlanOption, Employee } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { fullName, organizationToday, userIdsOf } from '../employees/employee-people';
import { NotificationsService } from '../notifications/notifications.service';
import { ageOn, carriedDependents, coverageStart, ineligibility, renewalPeriod } from './benefits-rules';
import { presentOption, presentPlan } from './benefits-present';
import type { PlanDto, PlanOptionDto, PlanQueryDto, RenewPlanDto, UpdatePlanDto } from './dto/benefits.dto';

type PlanValues = Omit<PlanDto, 'options'>;
/** Fixed once a plan is active (they decide how existing enrolments started). */
const LOCKED_WHEN_ACTIVE = ['type', 'coverageStartsOn'] as const;

/** Benefit plans and their coverage options (`benefits.manage`); employees see active plans. */
@Injectable()
export class BenefitPlansService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(auth: AuthContext, query: PlanQueryDto) {
    const manage = auth.permissions.has('benefits.manage');
    const conditions: WhereOptions[] = [manage ? (query.status ? { status: query.status } : {}) : { status: 'ACTIVE' }];
    if (query.search) conditions.push({ name: { [Op.iLike]: containsPattern(query.search) } });
    const where = { [Op.and]: conditions };
    const count = await BenefitPlan.count({ where });
    const rows = await BenefitPlan.findAll({ where, include: [{ model: BenefitPlanOption }], order: [['status', 'ASC'], ['coverageStartsOn', 'DESC'], ['name', 'ASC']], ...paginationArgs(query) });
    const stats = manage ? await this.stats(rows.map((r) => r.id)) : null;
    return new PaginatedResult(
      rows.map((p) => ({ ...presentPlan(p), ...(stats ? { stats: stats.get(p.id) ?? EMPTY_STATS } : {}) })),
      paginationMeta(query, count),
    );
  }

  async get(auth: AuthContext, id: string) {
    const p = await this.find(id);
    const manage = auth.permissions.has('benefits.manage');
    if (!manage && p.status !== 'ACTIVE') throw AppError.notFound('Plan');
    if (!manage) return presentPlan(p);
    const [renewal, renewedFrom] = await Promise.all([
      BenefitPlan.findOne({ where: { renewedFromId: p.id }, attributes: ['id', 'name', 'status', 'coverageStartsOn'] }),
      p.renewedFromId ? BenefitPlan.findByPk(p.renewedFromId, { attributes: ['id', 'name', 'status', 'coverageEndsOn'] }) : null,
    ]);
    return {
      ...presentPlan(p),
      stats: (await this.stats([p.id])).get(p.id) ?? EMPTY_STATS,
      renewal: renewal ? { id: renewal.id, name: renewal.name, status: renewal.status, coverageStartsOn: renewal.coverageStartsOn } : null,
      renewedFrom: renewedFrom ? { id: renewedFrom.id, name: renewedFrom.name, status: renewedFrom.status, coverageEndsOn: renewedFrom.coverageEndsOn } : null,
    };
  }

  async create(auth: AuthContext, dto: PlanDto) {
    const { options, ...values } = dto;
    this.validate(values, options);
    const plan = await this.db.transaction(async (transaction) => {
      const p = await BenefitPlan.create({ organizationId: auth.organizationId!, ...this.columns(values), createdById: auth.userId, updatedById: auth.userId }, { transaction });
      await this.syncOptions(p, options, transaction);
      await this.audit.record({ action: 'benefits.plan_created', entityType: 'BenefitPlan', entityId: p.id, summary: `Benefit plan "${p.name}" created` }, transaction);
      return p;
    });
    return this.get(auth, plan.id);
  }

  async update(auth: AuthContext, id: string, dto: UpdatePlanDto) {
    await this.db.transaction(async (transaction) => {
      const p = await this.find(id, transaction);
      if (p.status === 'ARCHIVED') throw AppError.conflict('An archived plan can no longer change');
      const { options, ...changes } = dto;
      if (p.status === 'ACTIVE') {
        const locked = LOCKED_WHEN_ACTIVE.filter((k) => changes[k] !== undefined && changes[k] !== p[k]);
        if (locked.length) throw AppError.conflict(`The ${locked.map((k) => (k === 'type' ? 'type' : 'coverage start')).join(' and ')} can't change once the plan is active`);
        if (changes.coverageEndsOn && changes.coverageEndsOn < p.coverageEndsOn) throw AppError.conflict('The policy period of an active plan can only be extended');
      }
      const merged: PlanValues = { ...presentPlan(p), ...changes } as PlanValues;
      const nextOptions = options ?? (p.options ?? []).map((o) => ({ ...o.get(), coverageAmount: o.coverageAmount === null ? null : Number(o.coverageAmount), employeeMonthly: Number(o.employeeMonthly), employerMonthly: Number(o.employerMonthly) }));
      this.validate(merged, nextOptions as PlanOptionDto[]);
      await p.update({ ...this.columns(merged), updatedById: auth.userId }, { transaction });
      if (options) await this.syncOptions(p, options, transaction);
      await this.audit.record({ action: 'benefits.plan_updated', entityType: 'BenefitPlan', entityId: p.id, summary: `Benefit plan "${p.name}" updated` }, transaction);
    });
    return this.get(auth, id);
  }

  async activate(auth: AuthContext, id: string) {
    const carried = await this.db.transaction(async (transaction) => {
      const p = await this.find(id, transaction);
      if (p.status !== 'DRAFT') throw AppError.conflict('Only a draft plan can be activated');
      if (p.coverageEndsOn < (await organizationToday(p.organizationId))) throw AppError.conflict('The policy period has already ended');
      if (!p.options?.length) throw AppError.conflict('Add at least one coverage option');
      await p.update({ status: 'ACTIVE', updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'benefits.plan_activated', entityType: 'BenefitPlan', entityId: p.id, summary: `Benefit plan "${p.name}" activated` }, transaction);
      return p.renewedFromId ? this.carryOver(auth, p, transaction) : null;
    });
    return { ...(await this.get(auth, id)), ...(carried ? { carriedOver: carried } : {}) };
  }

  /**
   * The plan for the next policy period: a draft copy with the same options, starting the day after this one ends,
   * with a renewal enrolment window just before. Activating it carries current enrolments over.
   */
  async renew(auth: AuthContext, id: string, dto: RenewPlanDto) {
    const renewalId = await this.db.transaction(async (transaction) => {
      const source = await this.find(id, transaction);
      if (source.status !== 'ACTIVE') throw AppError.conflict('Only an active plan can be renewed');
      const existing = await BenefitPlan.findOne({ where: { renewedFromId: source.id }, attributes: ['name'], transaction });
      if (existing) throw AppError.conflict(`This plan has already been renewed as "${existing.name}"`);
      const period = renewalPeriod(source, await organizationToday(source.organizationId));
      const values: PlanValues = {
        ...(presentPlan(source) as unknown as PlanValues),
        name: dto.name ?? source.name,
        policyNumber: dto.policyNumber !== undefined ? dto.policyNumber : source.policyNumber,
        coverageStartsOn: dto.coverageStartsOn ?? period.coverageStartsOn,
        coverageEndsOn: dto.coverageEndsOn ?? period.coverageEndsOn,
        enrollmentOpensOn: dto.enrollmentOpensOn !== undefined ? dto.enrollmentOpensOn : period.enrollmentOpensOn,
        enrollmentClosesOn: dto.enrollmentClosesOn !== undefined ? dto.enrollmentClosesOn : period.enrollmentClosesOn,
      };
      if (values.coverageStartsOn <= source.coverageStartsOn) throw AppError.validation([{ field: 'coverageStartsOn', message: 'The renewed policy must start after the current one' }]);
      const options = (source.options ?? []).map((o) => ({ ...presentOption(o), id: undefined })) as PlanOptionDto[];
      this.validate(values, options);
      const p = await BenefitPlan.create({ organizationId: source.organizationId, ...this.columns(values), renewedFromId: source.id, createdById: auth.userId, updatedById: auth.userId }, { transaction });
      await this.syncOptions(p, options, transaction);
      await this.audit.record({ action: 'benefits.plan_renewed', entityType: 'BenefitPlan', entityId: p.id, summary: `Benefit plan "${source.name}" renewed for ${values.coverageStartsOn} – ${values.coverageEndsOn} (draft)` }, transaction);
      return p.id;
    });
    return this.get(auth, renewalId);
  }

  /**
   * Activating a renewal: everyone still covered at the end of the previous period (and still eligible) continues in
   * the same option — or the default one — from the start of the new period, with the dependants it still covers.
   */
  private async carryOver(auth: AuthContext, p: BenefitPlan, transaction: Transaction) {
    const source = (await BenefitPlan.findByPk(p.renewedFromId!, { transaction }))!;
    const rows = await BenefitEnrollment.findAll({
      where: { planId: source.id, status: 'ACTIVE', [Op.or]: [{ effectiveTo: null }, { effectiveTo: { [Op.gte]: source.coverageEndsOn } }] },
      include: [{ model: BenefitEnrollmentDependent }],
      transaction,
    });
    const employees = new Map((rows.length ? await Employee.findAll({ where: { id: rows.map((r) => r.employeeId) }, transaction }) : []).map((e) => [e.id, e]));
    const already = new Set((await BenefitEnrollment.findAll({ where: { planId: p.id, status: ['ACTIVE', 'PENDING', 'WAIVED'] }, attributes: ['employeeId'], transaction })).map((e) => e.employeeId));
    const carried: { enrollment: BenefitEnrollment; employeeId: string; option: string }[] = [];
    let skipped = 0;
    for (const r of rows) {
      const e = employees.get(r.employeeId);
      const leaving = e?.exitDate && e.exitDate < p.coverageStartsOn;
      if (!e || already.has(e.id) || leaving || ineligibility(p, e)) {
        skipped++;
        continue;
      }
      const option = p.options?.find((o) => o.name.toLowerCase() === (r.optionName ?? '').toLowerCase()) ?? p.options?.find((o) => o.isDefault);
      if (!option) {
        skipped++;
        continue;
      }
      const effectiveFrom = coverageStart(p, e, 'HR', p.coverageStartsOn);
      if (effectiveFrom > p.coverageEndsOn) {
        skipped++;
        continue;
      }
      const dependents = carriedDependents(option, p.maxChildAge, (r.dependents ?? []).map((d) => ({ ...d.get({ plain: true }), relationship: d.relationship })), effectiveFrom);
      const created = await BenefitEnrollment.create(
        {
          organizationId: p.organizationId,
          planId: p.id,
          optionId: option.id,
          employeeId: e.id,
          status: 'ACTIVE',
          reason: 'RENEWAL',
          effectiveFrom,
          optionName: option.name,
          coverageAmount: option.coverageAmount,
          employeeMonthly: option.employeeMonthly,
          employerMonthly: option.employerMonthly,
          replacesId: r.id,
          decidedById: auth.userId,
          decidedAt: new Date(),
          createdById: auth.userId,
        },
        { transaction },
      );
      if (dependents.length) {
        await BenefitEnrollmentDependent.bulkCreate(
          dependents.map((d) => ({ organizationId: p.organizationId, enrollmentId: created.id, familyMemberId: d.familyMemberId, name: d.name, relationship: d.relationship, dateOfBirth: d.dateOfBirth, gender: d.gender })),
          { transaction },
        );
      }
      if (!r.effectiveTo) await r.update({ effectiveTo: source.coverageEndsOn }, { transaction });
      carried.push({ enrollment: created, employeeId: e.id, option: option.name });
    }
    const users = await userIdsOf(carried.map((c) => c.employeeId), transaction);
    for (const c of carried) {
      const userId = users.get(c.employeeId);
      if (userId) {
        await this.notifications.notify(
          userId,
          { organizationId: p.organizationId, type: 'benefits.enrollment', title: `Your cover continues in ${p.name}`, body: `${c.option} from ${c.enrollment.effectiveFrom}. You can change it while renewal enrolment is open.`, link: '/me/benefits' },
          transaction,
        );
      }
    }
    await this.audit.record({ action: 'benefits.renewal_carried_over', entityType: 'BenefitPlan', entityId: p.id, summary: `${carried.length} enrolment${carried.length === 1 ? '' : 's'} carried over from "${source.name}"${skipped ? ` (${skipped} not carried over)` : ''}` }, transaction);
    return { carried: carried.length, skipped };
  }

  /** Ends the plan: active coverage ends today (or at the end of the policy period), pending requests are cancelled. */
  async archive(auth: AuthContext, id: string) {
    await this.db.transaction(async (transaction) => {
      const p = await this.find(id, transaction);
      if (p.status !== 'ACTIVE') throw AppError.conflict('Only an active plan can be archived');
      const today = await organizationToday(p.organizationId);
      const last = today < p.coverageEndsOn ? today : p.coverageEndsOn;
      await BenefitEnrollment.update({ status: 'CANCELLED' }, { where: { planId: p.id, status: 'PENDING' }, transaction });
      await BenefitEnrollment.update({ status: 'CANCELLED' }, { where: { planId: p.id, status: 'ACTIVE', effectiveFrom: { [Op.gt]: last } }, transaction });
      await BenefitEnrollment.update({ status: 'ENDED', effectiveTo: last }, { where: { planId: p.id, status: 'ACTIVE', [Op.or]: [{ effectiveTo: null }, { effectiveTo: { [Op.gt]: last } }] }, transaction });
      await BenefitEnrollment.update({ status: 'ENDED' }, { where: { planId: p.id, status: 'ACTIVE' }, transaction });
      await p.update({ status: 'ARCHIVED', updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'benefits.plan_archived', entityType: 'BenefitPlan', entityId: p.id, summary: `Benefit plan "${p.name}" archived; coverage ended ${last}` }, transaction);
    });
    return this.get(auth, id);
  }

  async remove(auth: AuthContext, id: string) {
    await this.db.transaction(async (transaction) => {
      const p = await this.find(id, transaction);
      if (p.status !== 'DRAFT') throw AppError.conflict('Only a draft plan can be deleted');
      await p.destroy({ transaction });
      await this.audit.record({ action: 'benefits.plan_deleted', entityType: 'BenefitPlan', entityId: id, summary: `Draft benefit plan "${p.name}" deleted` }, transaction);
    });
  }

  /** Mandatory plans: covers every eligible employee who isn't enrolled yet, in the default option. Safe to repeat. */
  async enrollEligible(auth: AuthContext, id: string) {
    const result = await this.db.transaction(async (transaction) => {
      const p = await this.find(id, transaction);
      if (p.status !== 'ACTIVE') throw AppError.conflict('Activate the plan first');
      if (!p.mandatory) throw AppError.conflict('Only mandatory plans enrol everyone automatically');
      const option = p.options?.find((o) => o.isDefault);
      if (!option) throw AppError.conflict('Choose a default option for the plan');
      const today = await organizationToday(p.organizationId);
      const employees = await Employee.findAll({ where: { status: ['ACTIVE', 'ON_NOTICE'] }, transaction });
      const covered = new Set((await BenefitEnrollment.findAll({ where: { planId: p.id, status: ['ACTIVE', 'PENDING'] }, attributes: ['employeeId'], transaction })).map((e) => e.employeeId));
      const enrolled: Employee[] = [];
      for (const e of employees) {
        if (covered.has(e.id) || ineligibility(p, e)) continue;
        const from = coverageStart(p, e, 'HR', today);
        if (from > p.coverageEndsOn) continue;
        await BenefitEnrollment.update({ status: 'CANCELLED' }, { where: { planId: p.id, employeeId: e.id, status: 'WAIVED' }, transaction });
        await BenefitEnrollment.create(
          {
            organizationId: p.organizationId,
            planId: p.id,
            optionId: option.id,
            employeeId: e.id,
            status: 'ACTIVE',
            reason: 'HR',
            effectiveFrom: from,
            optionName: option.name,
            coverageAmount: option.coverageAmount,
            employeeMonthly: option.employeeMonthly,
            employerMonthly: option.employerMonthly,
            decidedById: auth.userId,
            decidedAt: new Date(),
            createdById: auth.userId,
          },
          { transaction },
        );
        enrolled.push(e);
      }
      const users = await userIdsOf(enrolled.map((e) => e.id), transaction);
      for (const e of enrolled) {
        const userId = users.get(e.id);
        if (userId) await this.notifications.notify(userId, { organizationId: p.organizationId, type: 'benefits.enrollment', title: `You're covered by ${p.name}`, body: `${option.name}. Add dependants from Benefits while enrolment is open.`, link: '/me/benefits' }, transaction);
      }
      await this.audit.record({ action: 'benefits.plan_enrolled_eligible', entityType: 'BenefitPlan', entityId: p.id, summary: `${enrolled.length} employee${enrolled.length === 1 ? '' : 's'} enrolled in "${p.name}"` }, transaction);
      return { enrolled: enrolled.length };
    });
    return result;
  }

  /** Insurer census: every covered member (employee and dependants) of current and upcoming coverage. */
  async census(auth: AuthContext, id: string): Promise<{ fileName: string; content: string }> {
    const p = await this.find(id);
    const today = await organizationToday(p.organizationId);
    const rows = await BenefitEnrollment.findAll({
      where: { planId: p.id, status: 'ACTIVE', [Op.or]: [{ effectiveTo: null }, { effectiveTo: { [Op.gte]: today } }] },
      include: [{ model: Employee }, { model: BenefitEnrollmentDependent }],
      order: [[{ model: Employee, as: 'employee' }, 'employeeCode', 'ASC']],
    });
    const header = ['Employee code', 'Employee', 'Member', 'Relationship', 'Gender', 'Date of birth', 'Age', 'Option', 'Sum insured', 'Covered from', 'Covered until'];
    const lines = [header.map(csvCell).join(',')];
    for (const e of rows) {
      const emp = e.employee!;
      const members = [
        { name: fullName(emp), relationship: 'SELF', gender: emp.gender, dateOfBirth: emp.dateOfBirth },
        ...(e.dependents ?? []).map((d) => ({ name: d.name, relationship: d.relationship, gender: d.gender, dateOfBirth: d.dateOfBirth })),
      ];
      for (const m of members) {
        lines.push(
          [emp.employeeCode, fullName(emp), m.name, m.relationship, m.gender ?? '', m.dateOfBirth ?? '', m.dateOfBirth ? ageOn(m.dateOfBirth, today) : '', e.optionName, e.coverageAmount ?? '', e.effectiveFrom, e.effectiveTo ?? p.coverageEndsOn]
            .map(csvCell)
            .join(','),
        );
      }
    }
    await this.audit.record({ action: 'benefits.census_exported', entityType: 'BenefitPlan', entityId: p.id, summary: `Census of "${p.name}" exported (${rows.length} enrolments)` });
    return { fileName: `${p.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'plan'} census ${today}.csv`, content: lines.join('\r\n') };
  }

  private async find(id: string, transaction?: Transaction) {
    const p = await BenefitPlan.findByPk(id, { transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
    if (!p) throw AppError.notFound('Plan');
    p.options = await BenefitPlanOption.findAll({ where: { planId: p.id }, order: [['sortOrder', 'ASC']], transaction });
    return p;
  }

  private columns(v: PlanValues) {
    const list = <T>(x: T[] | null | undefined) => (x?.length ? x : null);
    return {
      name: v.name,
      type: v.type,
      provider: v.provider ?? null,
      policyNumber: v.policyNumber ?? null,
      description: v.description ?? null,
      coverageStartsOn: v.coverageStartsOn,
      coverageEndsOn: v.coverageEndsOn,
      enrollmentOpensOn: v.enrollmentOpensOn ?? null,
      enrollmentClosesOn: v.enrollmentClosesOn ?? null,
      mandatory: !!v.mandatory,
      requiresApproval: !!v.requiresApproval,
      employmentTypes: list(v.employmentTypes),
      departmentIds: list(v.departmentIds),
      locationIds: list(v.locationIds),
      gradeIds: list(v.gradeIds),
      waitingDays: v.waitingDays ?? 0,
      maxChildAge: v.maxChildAge ?? null,
    };
  }

  private validate(v: PlanValues, options: PlanOptionDto[]) {
    const problems: { field: string; message: string }[] = [];
    if (v.coverageEndsOn <= v.coverageStartsOn) problems.push({ field: 'coverageEndsOn', message: 'The policy must end after it starts' });
    if (!!v.enrollmentOpensOn !== !!v.enrollmentClosesOn) problems.push({ field: 'enrollmentClosesOn', message: 'Give both the opening and closing dates of the enrolment window' });
    else if (v.enrollmentOpensOn && v.enrollmentClosesOn) {
      if (v.enrollmentClosesOn < v.enrollmentOpensOn) problems.push({ field: 'enrollmentClosesOn', message: 'The window must close after it opens' });
      if (v.enrollmentClosesOn > v.coverageEndsOn) problems.push({ field: 'enrollmentClosesOn', message: 'The window must close before the policy ends' });
    }
    const names = new Set<string>();
    for (const [i, o] of options.entries()) {
      const key = o.name.trim().toLowerCase();
      if (names.has(key)) problems.push({ field: `options.${i}.name`, message: `Two options are called "${o.name}"` });
      names.add(key);
      if (o.maxDependents > 0 && !o.allowedRelations.length) problems.push({ field: `options.${i}.allowedRelations`, message: `Choose who "${o.name}" can cover` });
      if (o.maxDependents === 0 && o.allowedRelations.length) problems.push({ field: `options.${i}.maxDependents`, message: `Set how many dependants "${o.name}" covers` });
    }
    const defaults = options.filter((o) => o.isDefault).length;
    if (defaults > 1) problems.push({ field: 'options', message: 'Only one option can be the default' });
    if (v.mandatory && defaults === 0) problems.push({ field: 'options', message: 'A mandatory plan needs a default option (everyone is enrolled in it)' });
    if (problems.length) throw AppError.validation(problems);
  }

  private async syncOptions(p: BenefitPlan, options: PlanOptionDto[], transaction: Transaction) {
    const existing = await BenefitPlanOption.findAll({ where: { planId: p.id }, transaction });
    const ids = new Set(existing.map((o) => o.id));
    if (options.some((o) => o.id && !ids.has(o.id))) throw AppError.validation([{ field: 'options', message: 'An option does not belong to this plan' }]);
    const keep = new Set(options.map((o) => o.id).filter(Boolean));
    const removed = existing.filter((o) => !keep.has(o.id));
    if (removed.length) {
      const used = await BenefitEnrollment.findOne({ where: { optionId: removed.map((o) => o.id) }, attributes: ['optionName'], transaction });
      if (used) throw AppError.conflict(`"${used.optionName}" has enrolments and can't be removed`);
      await BenefitPlanOption.destroy({ where: { id: removed.map((o) => o.id) }, transaction });
    }
    await BenefitPlanOption.update({ isDefault: false }, { where: { planId: p.id }, transaction });
    for (const [i, o] of options.entries()) {
      const values = {
        name: o.name,
        coverageAmount: o.coverageAmount === null || o.coverageAmount === undefined ? null : String(o.coverageAmount),
        employeeMonthly: String(o.employeeMonthly),
        employerMonthly: String(o.employerMonthly),
        allowedRelations: o.allowedRelations,
        maxDependents: o.maxDependents,
        isDefault: !!o.isDefault,
        sortOrder: i,
      };
      if (o.id) await BenefitPlanOption.update(values, { where: { id: o.id }, transaction });
      else await BenefitPlanOption.create({ organizationId: p.organizationId, planId: p.id, ...values }, { transaction });
    }
  }

  private async stats(planIds: string[]) {
    const out = new Map<string, typeof EMPTY_STATS>();
    if (!planIds.length) return out;
    const rows = (await BenefitEnrollment.findAll({
      where: { planId: planIds, status: ['ACTIVE', 'PENDING', 'WAIVED'] },
      attributes: ['planId', 'status', [fn('COUNT', col('id')), 'count'], [fn('SUM', col('employee_monthly')), 'employee'], [fn('SUM', col('employer_monthly')), 'employer']],
      group: ['planId', 'status'],
      raw: true,
    })) as unknown as { planId: string; status: string; count: string; employee: string | null; employer: string | null }[];
    for (const r of rows) {
      const s = out.get(r.planId) ?? { ...EMPTY_STATS };
      if (r.status === 'ACTIVE') Object.assign(s, { enrolled: Number(r.count), employeeMonthly: Number(r.employee ?? 0), employerMonthly: Number(r.employer ?? 0) });
      if (r.status === 'PENDING') s.pending = Number(r.count);
      if (r.status === 'WAIVED') s.waived = Number(r.count);
      out.set(r.planId, s);
    }
    return out;
  }
}

const EMPTY_STATS = { enrolled: 0, pending: 0, waived: 0, employeeMonthly: 0, employerMonthly: 0 };
