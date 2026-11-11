import { Injectable } from '@nestjs/common';
import { Op, type Transaction } from 'sequelize';
import type { CompensationPoolView } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { CompensationBudget, Department, Employee, EmployeeSalary, HikeRecommendation, PerformanceCycle } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { organizationToday } from '../employees/employee-people';

const PLANNED = ['DRAFT', 'SUBMITTED'];
const COMMITTED = ['APPROVED', 'APPLIED'];
const round2 = (n: number) => Math.round(n * 100) / 100;
const increase = (r: Pick<HikeRecommendation, 'currentCtc' | 'newCtc'>) => (r.currentCtc !== null && r.newCtc !== null ? Math.max(0, Number(r.newCtc) - Number(r.currentCtc)) : 0);

/**
 * Compensation budgets: HR (`performance.configure`) splits a cycle's increase money into a pool per department —
 * suggested from the department's payroll and the cycle's budget % — and sees what is planned (recommended, not yet
 * decided) and committed (approved or applied) against each. Approving an increase that would overspend its pool needs
 * an explicit override. Amounts need organization-wide salary access.
 */
@Injectable()
export class CompensationBudgetsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async pools(auth: AuthContext, cycleId: string): Promise<{ cycle: { id: string; name: string; budgetPercent: number | null; effectiveFrom: string | null }; pools: CompensationPoolView[]; totals: { amount: number; planned: number; committed: number; currentPayroll: number } }> {
    this.requireMoney(auth);
    const cycle = await this.cycle(cycleId);
    const asOf = cycle.hikeEffectiveFrom ?? (await organizationToday(cycle.organizationId));
    const [departments, budgets, employees, recs] = await Promise.all([
      Department.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] }),
      CompensationBudget.findAll({ where: { cycleId } }),
      Employee.findAll({ where: { status: ['ACTIVE', 'ON_NOTICE'], dateOfJoining: { [Op.lte]: asOf } }, attributes: ['id', 'departmentId'] }),
      HikeRecommendation.findAll({ where: { cycleId }, attributes: ['employeeId', 'status', 'currentCtc', 'newCtc'] }),
    ]);
    const salaries = await this.currentSalaries(employees.map((e) => e.id), asOf);
    const deptOf = new Map(employees.map((e) => [e.id, e.departmentId ?? null]));
    const recDept = recs.length ? new Map((await Employee.findAll({ where: { id: [...new Set(recs.map((r) => r.employeeId))] }, attributes: ['id', 'departmentId'] })).map((e) => [e.id, e.departmentId ?? null])) : new Map<string, string | null>();
    const pct = cycle.hikeBudgetPercent === null ? null : Number(cycle.hikeBudgetPercent);
    const rows: CompensationPoolView[] = [];
    const keys: (string | null)[] = [...departments.map((d) => d.id), null];
    for (const key of keys) {
      const people = employees.filter((e) => (deptOf.get(e.id) ?? null) === key);
      const budget = budgets.find((b) => (b.departmentId ?? null) === key);
      const mine = recs.filter((r) => (recDept.get(r.employeeId) ?? null) === key);
      if (key === null && !people.length && !budget && !mine.length) continue;
      const currentPayroll = round2(people.reduce((n, e) => n + (salaries.get(e.id) ?? 0), 0));
      const planned = round2(mine.filter((r) => PLANNED.includes(r.status)).reduce((n, r) => n + increase(r), 0));
      const committed = round2(mine.filter((r) => COMMITTED.includes(r.status)).reduce((n, r) => n + increase(r), 0));
      const amount = budget ? Number(budget.amount) : null;
      rows.push({
        departmentId: key,
        department: key ? (departments.find((d) => d.id === key)?.name ?? 'Department') : 'No department',
        currentPayroll,
        headcount: people.length,
        suggested: pct === null ? null : round2((currentPayroll * pct) / 100),
        amount,
        planned,
        committed,
        remaining: amount === null ? null : round2(amount - committed - planned),
      });
    }
    const sum = (f: (p: CompensationPoolView) => number) => round2(rows.reduce((n, p) => n + f(p), 0));
    return {
      cycle: { id: cycle.id, name: cycle.name, budgetPercent: pct, effectiveFrom: cycle.hikeEffectiveFrom },
      pools: rows,
      totals: { amount: sum((p) => p.amount ?? 0), planned: sum((p) => p.planned), committed: sum((p) => p.committed), currentPayroll: sum((p) => p.currentPayroll) },
    };
  }

  /** Replaces the cycle's pools (departments left out have none). */
  async setPools(auth: AuthContext, cycleId: string, pools: { departmentId: string | null; amount: number; note?: string | null }[]) {
    if (!auth.permissions.has('performance.configure')) throw AppError.forbidden();
    this.requireMoney(auth);
    const cycle = await this.cycle(cycleId);
    const ids = pools.map((p) => p.departmentId ?? 'none');
    if (new Set(ids).size !== ids.length) throw AppError.validation([{ field: 'pools', message: 'Each department can have one pool' }]);
    const known = new Set((await Department.findAll({ where: { id: pools.map((p) => p.departmentId).filter((x): x is string => !!x) }, attributes: ['id'] })).map((d) => d.id));
    const unknown = pools.filter((p) => p.departmentId && !known.has(p.departmentId));
    if (unknown.length) throw AppError.validation([{ field: 'pools', message: 'Unknown department' }]);
    await this.db.transaction(async (transaction) => {
      await CompensationBudget.destroy({ where: { cycleId }, transaction });
      if (pools.length) await CompensationBudget.bulkCreate(pools.map((p) => ({ organizationId: cycle.organizationId, cycleId, departmentId: p.departmentId, amount: String(p.amount), note: p.note ?? null, updatedById: auth.userId })), { transaction });
      await this.audit.record({ action: 'performance.compensation_budgets_set', entityType: 'PerformanceCycle', entityId: cycleId, summary: `Increase pools for "${cycle.name}" set for ${pools.length} department${pools.length === 1 ? '' : 's'}`, metadata: { total: round2(pools.reduce((n, p) => n + p.amount, 0)) } }, transaction);
    });
    return this.pools(auth, cycleId);
  }

  /**
   * Why approving this recommendation would overspend its department's pool (null = within the pool, or no pool).
   * Counts what's already committed; the recommendation itself at `newCtc`.
   */
  async overspend(rec: HikeRecommendation, newCtc: number | null, transaction?: Transaction): Promise<string | null> {
    if (rec.currentCtc === null || newCtc === null) return null;
    const employee = await Employee.findByPk(rec.employeeId, { attributes: ['departmentId'], transaction });
    const departmentId = employee?.departmentId ?? null;
    const budget = await CompensationBudget.findOne({ where: { cycleId: rec.cycleId, departmentId }, transaction });
    if (!budget) return null;
    const peers = await Employee.findAll({ where: { departmentId }, attributes: ['id'], transaction });
    const others = await HikeRecommendation.findAll({ where: { cycleId: rec.cycleId, status: COMMITTED, employeeId: peers.map((p) => p.id), id: { [Op.ne]: rec.id } }, attributes: ['currentCtc', 'newCtc'], transaction });
    const committed = others.reduce((n, r) => n + increase(r), 0);
    const total = committed + Math.max(0, newCtc - Number(rec.currentCtc));
    const amount = Number(budget.amount);
    return total > amount + 0.005 ? `This would take the department's increases to ${round2(total)} against a pool of ${round2(amount)}` : null;
  }

  private requireMoney(auth: AuthContext) {
    if (!auth.permissions.has('performance.configure') && !auth.permissions.has('employee.salary.revise')) throw AppError.forbidden();
    if (auth.permissions.get('employee.salary.view') !== 'ORGANIZATION') throw AppError.forbidden('Compensation budgets need organization-wide salary access');
  }

  private async cycle(id: string) {
    const c = await PerformanceCycle.findByPk(id);
    if (!c) throw AppError.notFound('Cycle');
    return c;
  }

  private async currentSalaries(employeeIds: string[], asOf: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!employeeIds.length) return out;
    const rows = await EmployeeSalary.findAll({ where: { employeeId: employeeIds, effectiveFrom: { [Op.lte]: asOf } }, attributes: ['employeeId', 'annualCtc', 'effectiveFrom'], order: [['effectiveFrom', 'ASC']] });
    for (const r of rows) out.set(r.employeeId, Number(r.annualCtc));
    return out;
  }
}
