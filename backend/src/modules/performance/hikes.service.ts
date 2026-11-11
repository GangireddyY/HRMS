import { Injectable } from '@nestjs/common';
import { Op, type Transaction } from 'sequelize';
import { DEFAULT_MERIT_MATRIX, type HikeStatus } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { Department, Designation, Employee, EmployeeSalary, HikeRecommendation, PerformanceCycle, PerformanceReview, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { fullName, organizationToday, usersWithPermission } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SalariesService } from '../payroll/salaries.service';
import { CompensationBudgetsService } from './compensation-budgets.service';
import type { CompensationDto, DecideHikeDto, HikeDto, HikeQueryDto } from './dto/performance.dto';
import { budgetUse, guidelineFor, increasedCtc, matrixProblems, outsideGuideline } from './hike-rules';

const RATED = ['COMPLETED', 'ACKNOWLEDGED'] as const;
const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
const finalRating = (r: Pick<PerformanceReview, 'calibratedRating' | 'finalRating'>) => r.calibratedRating ?? r.finalRating;

/**
 * Salary-hike recommendations after a review cycle. `performance.configure` sets the cycle's merit guidelines
 * (increase % per final rating), budget and effective date. The reviewer of a completed review (or HR) recommends an
 * increase — outside the guideline only with a justification — and submits it; someone with `employee.salary.revise`
 * — never the employee or whoever recommended it — approves or rejects it, and applies approved hikes as salary
 * revisions from the effective date. Salary amounts are shown only with `employee.salary.view` in scope.
 */
@Injectable()
export class HikesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
    private readonly salaries: SalariesService,
    private readonly budgets: CompensationBudgetsService,
  ) {}

  async compensation(auth: AuthContext, cycleId: string) {
    if (!auth.permissions.has('performance.configure') && !auth.permissions.has('employee.salary.revise')) throw AppError.forbidden();
    const cycle = await this.cycle(cycleId);
    const recs = await HikeRecommendation.findAll({ where: { cycleId }, attributes: ['status', 'currentCtc', 'newCtc'] });
    const counts = Object.fromEntries((['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'APPLIED'] as HikeStatus[]).map((s) => [s, recs.filter((r) => r.status === s).length]));
    const showMoney = auth.permissions.get('employee.salary.view') === 'ORGANIZATION';
    return {
      cycle: { id: cycle.id, name: cycle.name, status: cycle.status, ratingLabels: cycle.ratingLabels },
      configured: !!cycle.meritMatrix,
      meritMatrix: cycle.meritMatrix ?? DEFAULT_MERIT_MATRIX,
      budgetPercent: num(cycle.hikeBudgetPercent),
      effectiveFrom: cycle.hikeEffectiveFrom,
      counts,
      budget: showMoney ? budgetUse(recs.map((r) => ({ currentCtc: num(r.currentCtc), newCtc: num(r.newCtc), status: r.status })), num(cycle.hikeBudgetPercent)) : null,
      permissions: {
        configure: auth.permissions.has('performance.configure') && !counts.APPLIED,
        decide: auth.permissions.has('employee.salary.revise'),
        apply: auth.permissions.has('employee.salary.revise') && !!cycle.hikeEffectiveFrom && counts.APPROVED! > 0,
      },
    };
  }

  async setCompensation(auth: AuthContext, cycleId: string, dto: CompensationDto) {
    const cycle = await this.cycle(cycleId);
    const problems = matrixProblems(dto.meritMatrix);
    if (problems.length) throw AppError.validation(problems.map((message) => ({ field: 'meritMatrix', message })));
    if (dto.effectiveFrom && dto.effectiveFrom < cycle.periodStart) throw AppError.validation([{ field: 'effectiveFrom', message: "Increments can't take effect before the review period starts" }]);
    if (await HikeRecommendation.count({ where: { cycleId, status: 'APPLIED' } })) throw AppError.conflict('Hikes have already been applied for this cycle');
    await this.db.transaction(async (transaction) => {
      await cycle.update({ meritMatrix: [...dto.meritMatrix].sort((a, b) => a.rating - b.rating), hikeBudgetPercent: dto.budgetPercent === null || dto.budgetPercent === undefined ? null : String(dto.budgetPercent), hikeEffectiveFrom: dto.effectiveFrom ?? null, updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'performance.compensation_set', entityType: 'PerformanceCycle', entityId: cycleId, summary: `Merit guidelines for "${cycle.name}" saved${dto.effectiveFrom ? `, effective ${dto.effectiveFrom}` : ''}` }, transaction);
    });
    return this.compensation(auth, cycleId);
  }

  /** Completed reviews of the cycle — the caller's own reviewees (`mine`) or everyone (`all`, HR) — with their recommendation. */
  async list(auth: AuthContext, cycleId: string, query: HikeQueryDto) {
    const cycle = await this.cycle(cycleId);
    const self = await this.scope.self(auth);
    const hr = auth.permissions.has('performance.configure') || auth.permissions.has('employee.salary.revise');
    const view = query.view ?? (hr ? 'all' : 'mine');
    if (view === 'all' && !hr) throw AppError.forbidden();
    if (view === 'mine' && !self) return { cycle: { id: cycle.id, name: cycle.name }, rows: [] };
    const reviews = await PerformanceReview.findAll({
      where: { cycleId, stage: [...RATED], ...(view === 'mine' ? { reviewerId: self!.id } : {}) },
      include: [{ model: Employee, as: 'employee', attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'managerId', 'departmentId', 'membershipId'], include: [{ model: Department, attributes: ['name'] }, { model: Designation, attributes: ['name'] }] }],
      order: [[{ model: Employee, as: 'employee' }, 'firstName', 'ASC']],
    });
    const recs = reviews.length ? await HikeRecommendation.findAll({ where: { reviewId: reviews.map((r) => r.id) } }) : [];
    const asOf = cycle.hikeEffectiveFrom ?? (await organizationToday(cycle.organizationId));
    const salaries = await this.currentSalaries(reviews.map((r) => r.employeeId), asOf);
    const names = await this.names(recs.flatMap((r) => [r.recommendedById, r.decidedById]));
    const rows = [];
    for (const r of reviews) {
      const rating = finalRating(r)!;
      const g = guidelineFor(cycle.meritMatrix, rating);
      const rec = recs.find((x) => x.reviewId === r.id);
      if (query.status && rec?.status !== query.status) continue;
      const money = await this.canSeeSalary(auth, r.employee!);
      const current = rec?.currentCtc !== undefined && rec?.currentCtc !== null && rec.status !== 'DRAFT' ? Number(rec.currentCtc) : (salaries.get(r.employeeId) ?? null);
      const own = self?.id === r.employeeId;
      rows.push({
        reviewId: r.id,
        employee: { id: r.employee!.id, name: fullName(r.employee!), employeeCode: r.employee!.employeeCode, department: r.employee!.department?.name ?? null, designation: r.employee!.designation?.name ?? null },
        rating,
        ratingLabel: cycle.ratingLabels[rating - 1] ?? null,
        guideline: g,
        currentCtc: money ? current : undefined,
        recommendation: rec
          ? {
              id: rec.id,
              percent: Number(rec.percent),
              newCtc: money ? num(rec.newCtc) : undefined,
              promotion: rec.promotion,
              justification: rec.justification,
              status: rec.status,
              outsideGuideline: outsideGuideline(Number(rec.percent), g),
              recommendedBy: rec.recommendedById ? (names.get(rec.recommendedById) ?? 'Former user') : null,
              submittedAt: rec.submittedAt,
              decidedBy: rec.decidedById ? (names.get(rec.decidedById) ?? 'Former user') : null,
              decidedAt: rec.decidedAt,
              decisionNote: rec.decisionNote,
              appliedAt: rec.appliedAt,
            }
          : null,
        permissions: {
          edit: !own && (!rec || rec.status === 'DRAFT' || rec.status === 'REJECTED') && (r.reviewerId === self?.id || auth.permissions.has('performance.configure')),
          decide: !own && rec?.status === 'SUBMITTED' && auth.permissions.has('employee.salary.revise') && rec.recommendedById !== auth.userId,
        },
      });
    }
    return { cycle: { id: cycle.id, name: cycle.name, status: cycle.status, effectiveFrom: cycle.hikeEffectiveFrom, configured: !!cycle.meritMatrix }, rows };
  }

  async upsert(auth: AuthContext, reviewId: string, dto: HikeDto) {
    const review = await PerformanceReview.findByPk(reviewId);
    if (!review) throw AppError.notFound('Review');
    const self = await this.scope.self(auth);
    if (self?.id === review.employeeId) throw AppError.forbidden("You can't recommend your own increase");
    if (review.reviewerId !== self?.id && !auth.permissions.has('performance.configure')) throw AppError.forbidden('Only the reviewer or HR recommends an increase');
    const rating = finalRating(review);
    if (!(RATED as readonly string[]).includes(review.stage) || !rating) throw AppError.conflict('The review has to be completed first');
    const cycle = await this.cycle(review.cycleId);
    const g = guidelineFor(cycle.meritMatrix, rating);
    if (outsideGuideline(dto.percent, g) && !dto.justification) {
      throw AppError.validation([{ field: 'justification', message: `Explain why the increase is outside the ${g.min}–${g.max}% guideline for this rating` }]);
    }
    const current = (await this.currentSalaries([review.employeeId], cycle.hikeEffectiveFrom ?? (await organizationToday(cycle.organizationId)))).get(review.employeeId) ?? null;
    const id = await this.db.transaction(async (transaction) => {
      const existing = await HikeRecommendation.findOne({ where: { reviewId }, transaction, lock: transaction.LOCK.UPDATE });
      if (existing && existing.status !== 'DRAFT' && existing.status !== 'REJECTED') throw AppError.conflict(`The recommendation is ${existing.status.toLowerCase()} and can't change`);
      const values = {
        rating,
        currentCtc: current === null ? null : String(current),
        percent: String(dto.percent),
        newCtc: current === null ? null : String(increasedCtc(current, dto.percent)),
        promotion: !!dto.promotion,
        justification: dto.justification ?? null,
        status: 'DRAFT' as const,
        recommendedById: auth.userId,
        decidedById: null,
        decidedAt: null,
        decisionNote: null,
      };
      const rec = existing ? await existing.update(values, { transaction }) : await HikeRecommendation.create({ organizationId: review.organizationId, cycleId: review.cycleId, reviewId, employeeId: review.employeeId, ...values }, { transaction });
      return rec.id;
    });
    return this.one(auth, id);
  }

  async submit(auth: AuthContext, id: string) {
    await this.mutate(id, async (rec, transaction) => {
      if (rec.recommendedById !== auth.userId && !auth.permissions.has('performance.configure')) throw AppError.forbidden();
      if (rec.status !== 'DRAFT' && rec.status !== 'REJECTED') throw AppError.conflict(`The recommendation is already ${rec.status.toLowerCase()}`);
      await rec.update({ status: 'SUBMITTED', submittedAt: new Date() }, { transaction });
      const employee = (await Employee.findByPk(rec.employeeId, { attributes: ['employeeCode', 'firstName', 'lastName'], transaction }))!;
      await this.audit.record({ action: 'performance.hike_submitted', entityType: 'HikeRecommendation', entityId: rec.id, summary: `Increase for ${employee.employeeCode} submitted for approval` }, transaction);
      for (const userId of await usersWithPermission('employee.salary.revise', transaction)) {
        if (userId === auth.userId) continue;
        await this.notifications.notify(userId, { organizationId: rec.organizationId, type: 'performance.hike', title: `Increase recommended for ${fullName(employee)}`, link: `/hr/performance/cycles/${rec.cycleId}/hikes` }, transaction);
      }
    });
    return this.one(auth, id);
  }

  async decide(auth: AuthContext, id: string, approve: boolean, dto: DecideHikeDto) {
    if (!auth.permissions.has('employee.salary.revise')) throw AppError.forbidden();
    if (!approve && (!dto.note || dto.note.trim().length < 3)) throw AppError.validation([{ field: 'note', message: 'Give a reason' }]);
    const self = await this.scope.self(auth);
    await this.mutate(id, async (rec, transaction) => {
      if (rec.employeeId === self?.id) throw AppError.forbidden("You can't decide on your own increase");
      if (rec.recommendedById === auth.userId) throw AppError.forbidden('Someone other than whoever recommended it decides');
      if (rec.status !== 'SUBMITTED') throw AppError.conflict(`The recommendation is ${rec.status.toLowerCase()}`);
      const percent = approve && dto.percent !== undefined ? dto.percent : Number(rec.percent);
      const current = num(rec.currentCtc);
      const over = approve ? await this.budgets.overspend(rec, current === null ? null : increasedCtc(current, percent), transaction) : null;
      if (over && !dto.overBudget) throw AppError.conflict(`${over}. Approve over budget to go ahead.`);
      if (over) await this.audit.record({ action: 'performance.hike_over_budget', entityType: 'HikeRecommendation', entityId: rec.id, summary: `Increase approved over the department's pool: ${over}` }, transaction);
      await rec.update(
        { status: approve ? 'APPROVED' : 'REJECTED', percent: String(percent), newCtc: current === null ? null : String(increasedCtc(current, percent)), decidedById: auth.userId, decidedAt: new Date(), decisionNote: dto.note ?? null },
        { transaction },
      );
      await this.audit.record({ action: approve ? 'performance.hike_approved' : 'performance.hike_rejected', entityType: 'HikeRecommendation', entityId: rec.id, summary: `Increase recommendation ${approve ? 'approved' : 'rejected'}`, metadata: { employeeId: rec.employeeId } }, transaction);
      if (rec.recommendedById && rec.recommendedById !== auth.userId) {
        const employee = (await Employee.findByPk(rec.employeeId, { attributes: ['firstName', 'lastName'], transaction }))!;
        await this.notifications.notify(rec.recommendedById, { organizationId: rec.organizationId, type: 'performance.hike', title: `Increase for ${fullName(employee)} ${approve ? 'approved' : 'not approved'}`, body: dto.note ?? undefined, link: `/hr/performance/cycles/${rec.cycleId}/hikes` }, transaction);
      }
    });
    return this.one(auth, id);
  }

  /** Approved hikes become salary revisions from the effective date (same structure, the increased CTC). */
  async apply(auth: AuthContext, cycleId: string) {
    if (!auth.permissions.has('employee.salary.revise')) throw AppError.forbidden();
    const cycle = await this.cycle(cycleId);
    if (!cycle.hikeEffectiveFrom) throw AppError.conflict('Set the date the increments take effect first');
    const recs = await HikeRecommendation.findAll({ where: { cycleId, status: 'APPROVED' }, include: [{ model: Employee, attributes: ['id', 'employeeCode', 'firstName', 'lastName'] }] });
    const self = await this.scope.self(auth);
    const failed: { employee: string; reason: string }[] = [];
    let applied = 0;
    for (const rec of recs) {
      const name = `${fullName(rec.employee!)} (${rec.employee!.employeeCode})`;
      if (rec.employeeId === self?.id) {
        failed.push({ employee: name, reason: "You can't apply your own increase" });
        continue;
      }
      const latest = await EmployeeSalary.findOne({ where: { employeeId: rec.employeeId, effectiveFrom: { [Op.lte]: cycle.hikeEffectiveFrom } }, order: [['effectiveFrom', 'DESC']] });
      if (!latest) {
        failed.push({ employee: name, reason: 'No salary on record' });
        continue;
      }
      try {
        const salary = await this.salaries.createApproved(auth, rec.employeeId, {
          structureId: latest.structureId,
          annualCtc: increasedCtc(Number(latest.annualCtc), Number(rec.percent)),
          effectiveFrom: cycle.hikeEffectiveFrom,
          pfApplicable: latest.pfApplicable,
          reason: `${rec.promotion ? 'Promotion and increment' : 'Increment'} – ${cycle.name}`.slice(0, 300),
        });
        await rec.update({ status: 'APPLIED', salaryId: salary.id, appliedAt: new Date(), currentCtc: latest.annualCtc, newCtc: String(salary.annualCtc) });
        applied++;
      } catch (e) {
        failed.push({ employee: name, reason: e instanceof AppError ? (e.details?.[0]?.message ?? e.message) : 'Unexpected error' });
      }
    }
    await this.audit.record({ action: 'performance.hikes_applied', entityType: 'PerformanceCycle', entityId: cycleId, summary: `${applied} increment${applied === 1 ? '' : 's'} from "${cycle.name}" applied${failed.length ? `, ${failed.length} not applied` : ''}` });
    return { applied, failed };
  }

  // ---- Internals --------------------------------------------------------------------------------

  private async one(auth: AuthContext, id: string) {
    const rec = (await HikeRecommendation.findByPk(id))!;
    const list = await this.list(auth, rec.cycleId, { view: auth.permissions.has('performance.configure') || auth.permissions.has('employee.salary.revise') ? 'all' : 'mine' });
    return list.rows.find((r) => r.reviewId === rec.reviewId) ?? null;
  }

  private async mutate(id: string, fn: (rec: HikeRecommendation, transaction: Transaction) => Promise<void>) {
    await this.db.transaction(async (transaction) => {
      const rec = await HikeRecommendation.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!rec) throw AppError.notFound('Recommendation');
      await fn(rec, transaction);
    });
  }

  private async cycle(id: string) {
    const c = await PerformanceCycle.findByPk(id);
    if (!c) throw AppError.notFound('Cycle');
    return c;
  }

  /** The annual CTC in force on a date per employee. */
  private async currentSalaries(employeeIds: string[], asOf: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!employeeIds.length) return out;
    const rows = await EmployeeSalary.findAll({ where: { employeeId: employeeIds, effectiveFrom: { [Op.lte]: asOf } }, attributes: ['employeeId', 'annualCtc', 'effectiveFrom'], order: [['effectiveFrom', 'ASC']] });
    for (const r of rows) out.set(r.employeeId, Number(r.annualCtc));
    return out;
  }

  private async canSeeSalary(auth: AuthContext, e: Pick<Employee, 'id' | 'managerId' | 'departmentId'>) {
    return this.scope.covers(auth, 'employee.salary.view', e);
  }

  private async names(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }
}
