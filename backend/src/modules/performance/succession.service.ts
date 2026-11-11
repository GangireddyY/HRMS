import { Injectable } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { MAX_SUCCESSORS_PER_PLAN, type BenchStrength, type SuccessionLevel, type SuccessionPlanView } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { fullName } from '../../common/utils/names';
import { DatabaseService } from '../../database/database.service';
import { Department, Designation, Employee, PerformanceCycle, PerformanceReview, SuccessionCandidate, SuccessionPlan } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import type { SuccessionPlanDto, SuccessorDto, UpdateSuccessorDto } from './dto/performance.dto';

const PERSON = ['id', 'employeeCode', 'firstName', 'lastName', 'status', 'managerId', 'departmentId', 'designationId', 'membershipId'];
const RATED = ['COMPLETED', 'ACKNOWLEDGED'];

/**
 * Succession planning: critical roles (held by someone, or vacant) with how critical they are and the risk of losing
 * the holder, and a ranked bench of successors with their readiness and where they sit on the 9-box (latest completed
 * review). HR manages plans (`performance.succession.manage`); managers may view the plans in their scope
 * (`performance.succession.view`) — never a plan for their own role.
 */
@Injectable()
export class SuccessionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
  ) {}

  async list(auth: AuthContext): Promise<{ plans: SuccessionPlanView[]; summary: Record<BenchStrength, number> & { total: number; highRisk: number } }> {
    const plans = await SuccessionPlan.findAll({ include: this.includes(), order: [['title', 'ASC']] });
    const visible: SuccessionPlan[] = [];
    for (const p of plans) if (await this.canView(auth, p)) visible.push(p);
    const weight: Record<SuccessionLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    visible.sort((a, b) => weight[a.criticality as SuccessionLevel] - weight[b.criticality as SuccessionLevel]);
    const views = await this.present(auth, visible);
    const count = (b: BenchStrength) => views.filter((v) => v.bench === b).length;
    return { plans: views, summary: { total: views.length, NONE: count('NONE'), AT_RISK: count('AT_RISK'), COVERED: count('COVERED'), highRisk: views.filter((v) => v.criticality === 'HIGH' && v.bench !== 'COVERED').length } };
  }

  async get(auth: AuthContext, id: string): Promise<SuccessionPlanView> {
    const p = await this.find(id);
    if (!(await this.canView(auth, p))) throw AppError.notFound('Succession plan');
    return (await this.present(auth, [p]))[0]!;
  }

  async create(auth: AuthContext, dto: SuccessionPlanDto) {
    this.requireManage(auth);
    const incumbent = dto.incumbentEmployeeId ? await this.employee(dto.incumbentEmployeeId) : null;
    try {
      const p = await SuccessionPlan.create({
        organizationId: auth.organizationId!,
        title: dto.title,
        incumbentEmployeeId: incumbent?.id ?? null,
        departmentId: dto.departmentId ?? incumbent?.departmentId ?? null,
        criticality: dto.criticality,
        riskOfLoss: dto.riskOfLoss,
        notes: dto.notes ?? null,
        reviewBy: dto.reviewBy ?? null,
        createdById: auth.userId,
        updatedById: auth.userId,
      });
      await this.audit.record({ action: 'performance.succession_plan_created', entityType: 'SuccessionPlan', entityId: p.id, summary: `Succession plan for "${dto.title}" created` });
      return this.get(auth, p.id);
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict(`${incumbent ? fullName(incumbent) : 'This person'}'s role already has a succession plan`);
      throw e;
    }
  }

  async update(auth: AuthContext, id: string, dto: SuccessionPlanDto) {
    this.requireManage(auth);
    const p = await this.find(id);
    const incumbent = dto.incumbentEmployeeId ? await this.employee(dto.incumbentEmployeeId) : null;
    if (incumbent && (p.candidates ?? []).some((c) => c.employeeId === incumbent.id)) throw AppError.validation([{ field: 'incumbentEmployeeId', message: 'The holder is on the bench; remove them from the successors first' }]);
    try {
      await p.update({ title: dto.title, incumbentEmployeeId: incumbent?.id ?? null, departmentId: dto.departmentId ?? incumbent?.departmentId ?? null, criticality: dto.criticality, riskOfLoss: dto.riskOfLoss, notes: dto.notes ?? null, reviewBy: dto.reviewBy ?? null, updatedById: auth.userId });
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict("That person's role already has a succession plan");
      throw e;
    }
    await this.audit.record({ action: 'performance.succession_plan_updated', entityType: 'SuccessionPlan', entityId: id, summary: `Succession plan for "${dto.title}" updated` });
    return this.get(auth, id);
  }

  async remove(auth: AuthContext, id: string) {
    this.requireManage(auth);
    const p = await this.find(id);
    await p.destroy();
    await this.audit.record({ action: 'performance.succession_plan_deleted', entityType: 'SuccessionPlan', entityId: id, summary: `Succession plan for "${p.title}" deleted` });
  }

  async addSuccessor(auth: AuthContext, planId: string, dto: SuccessorDto) {
    this.requireManage(auth);
    const p = await this.find(planId);
    const e = await this.employee(dto.employeeId);
    if (e.id === p.incumbentEmployeeId) throw AppError.validation([{ field: 'employeeId', message: "The role's holder can't be their own successor" }]);
    if ((p.candidates ?? []).length >= MAX_SUCCESSORS_PER_PLAN) throw AppError.conflict(`A plan can have up to ${MAX_SUCCESSORS_PER_PLAN} successors`);
    try {
      await this.db.transaction(async (transaction) => {
        await SuccessionCandidate.create({ organizationId: p.organizationId, planId, employeeId: e.id, readiness: dto.readiness, rank: dto.rank ?? (p.candidates ?? []).length + 1, developmentNotes: dto.developmentNotes ?? null }, { transaction });
        await this.audit.record({ action: 'performance.successor_added', entityType: 'SuccessionPlan', entityId: planId, summary: `${e.employeeCode} named as a successor for "${p.title}"` }, transaction);
      });
    } catch (err) {
      if (err instanceof UniqueConstraintError) throw AppError.conflict(`${fullName(e)} is already on this bench`);
      throw err;
    }
    return this.get(auth, planId);
  }

  async updateSuccessor(auth: AuthContext, planId: string, candidateId: string, dto: UpdateSuccessorDto) {
    this.requireManage(auth);
    const c = await SuccessionCandidate.findOne({ where: { id: candidateId, planId } });
    if (!c) throw AppError.notFound('Successor');
    await c.update({ ...(dto.readiness ? { readiness: dto.readiness } : {}), ...(dto.rank ? { rank: dto.rank } : {}), ...(dto.developmentNotes !== undefined ? { developmentNotes: dto.developmentNotes } : {}) });
    await this.audit.record({ action: 'performance.successor_updated', entityType: 'SuccessionPlan', entityId: planId, summary: 'Successor readiness or notes updated' });
    return this.get(auth, planId);
  }

  async removeSuccessor(auth: AuthContext, planId: string, candidateId: string) {
    this.requireManage(auth);
    const deleted = await SuccessionCandidate.destroy({ where: { id: candidateId, planId } });
    if (!deleted) throw AppError.notFound('Successor');
    await this.audit.record({ action: 'performance.successor_removed', entityType: 'SuccessionPlan', entityId: planId, summary: 'Successor removed' });
    return this.get(auth, planId);
  }

  // ---- internals -------------------------------------------------------------------------------

  private requireManage(auth: AuthContext) {
    if (!auth.features.has('performance')) throw AppError.forbidden('Performance is not enabled for your organization');
    if (!auth.permissions.has('performance.succession.manage')) throw AppError.forbidden();
  }

  private async canView(auth: AuthContext, p: SuccessionPlan): Promise<boolean> {
    if (auth.permissions.has('performance.succession.manage')) return true;
    const scope = auth.permissions.get('performance.succession.view');
    if (!scope) return false;
    const self = await this.scope.self(auth);
    // Nobody but HR sees the bench for their own role.
    if (self && p.incumbentEmployeeId === self.id) return false;
    if (scope === 'ORGANIZATION') return true;
    if (p.incumbent) return this.scope.covers(auth, 'performance.succession.view', p.incumbent);
    return scope === 'DEPARTMENT' && !!self?.departmentId && self.departmentId === p.departmentId;
  }

  private includes() {
    return [
      { model: Employee, as: 'incumbent', attributes: PERSON, include: [{ model: Designation, attributes: ['name'] }] },
      { model: SuccessionCandidate, include: [{ model: Employee, attributes: PERSON, include: [{ model: Designation, attributes: ['name'] }, { model: Department, attributes: ['name'] }] }] },
    ];
  }

  private async find(id: string): Promise<SuccessionPlan> {
    const p = await SuccessionPlan.findByPk(id, { include: this.includes() });
    if (!p) throw AppError.notFound('Succession plan');
    return p;
  }

  private async employee(id: string): Promise<Employee> {
    const e = await Employee.findByPk(id, { attributes: PERSON });
    if (!e) throw AppError.notFound('Employee');
    if (!['ACTIVE', 'ON_NOTICE'].includes(e.status)) throw AppError.validation([{ field: 'employeeId', message: `${fullName(e)} is not an active employee` }]);
    return e;
  }

  /** Latest completed review per employee: final (calibrated) rating and potential, for the 9-box. */
  private async nineBox(employeeIds: string[]) {
    const out = new Map<string, { rating: number | null; potential: number | null; cycle: string | null }>();
    if (!employeeIds.length) return out;
    const reviews = await PerformanceReview.findAll({
      where: { employeeId: employeeIds, stage: RATED },
      attributes: ['employeeId', 'finalRating', 'calibratedRating', 'potential'],
      include: [{ model: PerformanceCycle, attributes: ['name', 'periodEnd'] }],
    });
    reviews.sort((a, b) => (a.cycle?.periodEnd ?? '').localeCompare(b.cycle?.periodEnd ?? ''));
    for (const r of reviews) out.set(r.employeeId, { rating: r.calibratedRating ?? r.finalRating, potential: r.potential, cycle: r.cycle?.name ?? null });
    return out;
  }

  private async present(auth: AuthContext, plans: SuccessionPlan[]): Promise<SuccessionPlanView[]> {
    const departments = new Map((await Department.findAll({ where: { id: [...new Set(plans.map((p) => p.departmentId).filter((x): x is string => !!x))] }, attributes: ['id', 'name'] })).map((d) => [d.id, d.name]));
    const boxes = await this.nineBox([...new Set(plans.flatMap((p) => (p.candidates ?? []).map((c) => c.employeeId)))]);
    const manage = auth.permissions.has('performance.succession.manage');
    return plans.map((p) => {
      const successors = [...(p.candidates ?? [])]
        .sort((a, b) => a.rank - b.rank)
        .map((c) => ({
          id: c.id,
          employee: { id: c.employee!.id, name: fullName(c.employee!), employeeCode: c.employee!.employeeCode, designation: c.employee!.designation?.name ?? null, department: c.employee!.department?.name ?? null },
          readiness: c.readiness,
          rank: c.rank,
          developmentNotes: c.developmentNotes,
          nineBox: boxes.get(c.employeeId) ?? { rating: null, potential: null, cycle: null },
        }));
      const bench: BenchStrength = !successors.length ? 'NONE' : successors.some((s) => s.readiness === 'READY_NOW') ? 'COVERED' : 'AT_RISK';
      return {
        id: p.id,
        title: p.title,
        incumbent: p.incumbent ? { id: p.incumbent.id, name: fullName(p.incumbent), employeeCode: p.incumbent.employeeCode, designation: p.incumbent.designation?.name ?? null } : null,
        department: p.departmentId ? { id: p.departmentId, name: departments.get(p.departmentId) ?? 'Department' } : null,
        criticality: p.criticality,
        riskOfLoss: p.riskOfLoss,
        notes: p.notes,
        reviewBy: p.reviewBy,
        bench,
        successors,
        updatedAt: p.updatedAt.toISOString(),
        canManage: manage,
      };
    });
  }
}
