import { Injectable } from '@nestjs/common';
import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import { financialYearOf } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { monthRange, zonedParts } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { Department, Designation, Employee, EmployeeSalary, Organization, OrganizationMembership, PayrollRun, SalaryStructure, TaxDeclarationRecord, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { SalaryDto, SalaryListQueryDto, SalaryPreviewDto, TaxDeclarationDto } from './dto/payroll.dto';
import { PayrollConfigService } from './payroll-config.service';
import { salaryBreakdown, StructureError, type SalaryBreakdown, type SalaryComponent, type TaxDeclaration } from './payroll-engine';

const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();
const n = (v: string | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

export function presentSalary(s: EmployeeSalary, createdBy?: string | null) {
  const employerPf = Number(s.employerPf);
  const employerEsi = Number(s.employerEsi);
  const monthlyGross = Number(s.monthlyGross);
  return {
    id: s.id,
    employeeId: s.employeeId,
    structure: s.structure ? { id: s.structure.id, name: s.structure.name } : { id: s.structureId, name: null },
    annualCtc: Number(s.annualCtc),
    effectiveFrom: s.effectiveFrom,
    pfApplicable: s.pfApplicable,
    monthlyGross,
    employerPf,
    employerEsi,
    monthlyCtc: monthlyGross + employerPf + employerEsi,
    components: s.components as SalaryComponent[],
    reason: s.reason,
    createdAt: s.createdAt,
    createdBy: createdBy ?? null,
  };
}

/** Employee salaries (CTC, structure and breakdown history) and income-tax declarations. */
@Injectable()
export class SalariesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly config: PayrollConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  async today(organizationId: string): Promise<string> {
    const org = await Organization.findByPk(organizationId, { attributes: ['timezone'] });
    return zonedParts(new Date(), org?.timezone ?? 'UTC').date;
  }

  async preview(auth: AuthContext, dto: SalaryPreviewDto): Promise<SalaryBreakdown> {
    const { lines } = await this.config.linesFor(dto.structureId);
    const settings = await this.config.settings(auth.organizationId!);
    try {
      return salaryBreakdown(dto.annualCtc, lines, {
        pfEnabled: settings.pfEnabled,
        pfApplicable: dto.pfApplicable ?? true,
        pfRestrictToCeiling: settings.pfRestrictToCeiling,
        esiEnabled: settings.esiEnabled,
      });
    } catch (e) {
      if (e instanceof StructureError) throw AppError.validation([{ field: 'annualCtc', message: e.message }]);
      throw e;
    }
  }

  /** Last day of the latest month whose payroll is submitted, approved or paid (salaries up to it are locked). */
  async lockedThrough(): Promise<string | null> {
    const run = await PayrollRun.findOne({ where: { status: ['SUBMITTED', 'APPROVED', 'PAID'] }, order: [['year', 'DESC'], ['month', 'DESC']] });
    return run ? monthRange(run.year, run.month).to : null;
  }

  async list(auth: AuthContext, query: SalaryListQueryDto) {
    const scoped = await this.scope.where(auth, 'employee.salary.view');
    if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
    const conditions: WhereOptions[] = [scoped, { status: ['ACTIVE', 'ON_NOTICE'] }];
    if (query.departmentId) conditions.push({ departmentId: query.departmentId });
    if (query.search) {
      const like = containsPattern(query.search);
      conditions.push({ [Op.or]: [{ firstName: { [Op.iLike]: like } }, { lastName: { [Op.iLike]: like } }, { employeeCode: { [Op.iLike]: like } }] });
    }
    if (query.missing) {
      const withSalary = (await EmployeeSalary.findAll({ attributes: ['employeeId'], group: ['employeeId'], raw: true })).map((r) => r.employeeId);
      if (withSalary.length) conditions.push({ id: { [Op.notIn]: withSalary } });
    }
    const { rows, count } = await Employee.findAndCountAll({
      where: { [Op.and]: conditions },
      include: [
        { model: Department, attributes: ['id', 'name'] },
        { model: Designation, attributes: ['id', 'name'] },
      ],
      order: [['firstName', 'ASC'], ['lastName', 'ASC']],
      ...paginationArgs(query),
    });
    const today = await this.today(auth.organizationId!);
    const salaries = rows.length
      ? await EmployeeSalary.findAll({ where: { employeeId: rows.map((r) => r.id) }, include: [{ model: SalaryStructure, attributes: ['id', 'name'] }], order: [['effectiveFrom', 'ASC']] })
      : [];
    const byEmployee = new Map<string, EmployeeSalary[]>();
    for (const s of salaries) byEmployee.set(s.employeeId, [...(byEmployee.get(s.employeeId) ?? []), s]);
    return new PaginatedResult(
      rows.map((e) => {
        const list = byEmployee.get(e.id) ?? [];
        const current = [...list].reverse().find((s) => s.effectiveFrom <= today) ?? null;
        const upcoming = list.find((s) => s.effectiveFrom > today) ?? null;
        return {
          employee: { id: e.id, name: fullName(e), employeeCode: e.employeeCode, department: e.department?.name ?? null, designation: e.designation?.name ?? null, dateOfJoining: e.dateOfJoining },
          current: current ? presentSalary(current) : null,
          upcoming: upcoming ? { effectiveFrom: upcoming.effectiveFrom, annualCtc: Number(upcoming.annualCtc) } : null,
        };
      }),
      paginationMeta(query, count),
    );
  }

  /** Salary history: the employee themself, or `employee.salary.view` covering them. */
  async history(auth: AuthContext, employeeId: string) {
    const employee = await this.accessible(auth, employeeId);
    const rows = await EmployeeSalary.findAll({ where: { employeeId }, include: [{ model: SalaryStructure, attributes: ['id', 'name'] }], order: [['effectiveFrom', 'DESC']] });
    const users = new Map(
      (await User.findAll({ where: { id: rows.map((r) => r.createdById).filter((x): x is string => !!x) }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]),
    );
    const lockedThrough = await this.lockedThrough();
    return {
      employee: { id: employee.id, name: fullName(employee), employeeCode: employee.employeeCode, dateOfJoining: employee.dateOfJoining, status: employee.status },
      lockedThrough,
      salaries: rows.map((s) => ({ ...presentSalary(s, s.createdById ? users.get(s.createdById) : null), locked: !!lockedThrough && s.effectiveFrom <= lockedThrough })),
    };
  }

  async mine(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return { employee: null, lockedThrough: null, salaries: [] };
    return this.history(auth, self.id);
  }

  async create(auth: AuthContext, employeeId: string, dto: SalaryDto) {
    const employee = await Employee.findByPk(employeeId);
    if (!employee) throw AppError.notFound('Employee');
    const self = await this.scope.self(auth);
    if (self?.id === employee.id) throw AppError.forbidden('You cannot set your own salary');
    if (employee.status === 'EXITED') throw AppError.conflict(`${fullName(employee)} has exited`);
    if (dto.effectiveFrom < employee.dateOfJoining) throw AppError.validation([{ field: 'effectiveFrom', message: `The salary can't start before the joining date (${employee.dateOfJoining})` }]);
    if (employee.exitDate && dto.effectiveFrom > employee.exitDate) throw AppError.validation([{ field: 'effectiveFrom', message: `The salary can't start after the exit date (${employee.exitDate})` }]);
    const locked = await this.lockedThrough();
    if (locked && dto.effectiveFrom <= locked) {
      throw AppError.validation([{ field: 'effectiveFrom', message: `Payroll is already processed up to ${locked}. Choose a later date and pay any arrears as an adjustment.` }]);
    }
    const breakdown = await this.preview(auth, dto);
    try {
      const salary = await this.db.transaction(async (transaction) => {
        const s = await EmployeeSalary.create(
          {
            organizationId: auth.organizationId!,
            employeeId,
            structureId: dto.structureId,
            annualCtc: String(dto.annualCtc),
            effectiveFrom: dto.effectiveFrom,
            pfApplicable: dto.pfApplicable ?? true,
            monthlyGross: String(breakdown.monthlyGross),
            employerPf: String(breakdown.employerPf),
            employerEsi: String(breakdown.employerEsi),
            components: breakdown.components,
            reason: dto.reason ?? null,
            createdById: auth.userId,
          },
          { transaction },
        );
        // Amounts stay out of the audit trail (salary data is restricted to employee.salary.view).
        await this.audit.record(
          { action: 'payroll.salary_set', entityType: 'EmployeeSalary', entityId: s.id, summary: `Salary set for ${employee.employeeCode} – ${fullName(employee)} effective ${dto.effectiveFrom}`, metadata: { employeeId, reason: dto.reason ?? null } },
          transaction,
        );
        const userId = await this.userIdOf(employee);
        if (userId) {
          await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'payroll.salary', title: `Your salary has been updated (effective ${dto.effectiveFrom})`, link: '/me/salary' }, transaction);
        }
        return s;
      });
      await salary.reload({ include: [{ model: SalaryStructure, attributes: ['id', 'name'] }] });
      return presentSalary(salary);
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict(`${fullName(employee)} already has a salary starting on ${dto.effectiveFrom}`);
      throw e;
    }
  }

  async remove(auth: AuthContext, salaryId: string) {
    const s = await EmployeeSalary.findByPk(salaryId, { include: [{ model: Employee, attributes: ['id', 'employeeCode', 'firstName', 'lastName'] }] });
    if (!s) throw AppError.notFound('Salary');
    const locked = await this.lockedThrough();
    if (locked && s.effectiveFrom <= locked) throw AppError.conflict('This salary was used in processed payroll and can no longer be deleted');
    await this.db.transaction(async (transaction) => {
      await s.destroy({ transaction });
      await this.audit.record(
        { action: 'payroll.salary_deleted', entityType: 'EmployeeSalary', entityId: salaryId, summary: `Salary effective ${s.effectiveFrom} deleted for ${s.employee!.employeeCode} – ${fullName(s.employee!)}`, metadata: { employeeId: s.employeeId } },
        transaction,
      );
    });
  }

  // ---- Tax declarations ------------------------------------------------------------------------

  async currentFinancialYear(organizationId: string): Promise<number> {
    const [y, m] = (await this.today(organizationId)).split('-').map(Number) as [number, number];
    return financialYearOf(y, m);
  }

  async declaration(employeeId: string, fy: number): Promise<TaxDeclaration & { financialYear: number; updatedAt: Date | null }> {
    const d = await TaxDeclarationRecord.findOne({ where: { employeeId, financialYear: fy } });
    return {
      financialYear: fy,
      regime: d?.regime ?? 'NEW',
      rentPaidAnnual: n(d?.rentPaidAnnual),
      metroCity: d?.metroCity ?? false,
      section80c: n(d?.section80c),
      section80ccd1b: n(d?.section80ccd1b),
      section80d: n(d?.section80d),
      homeLoanInterest: n(d?.homeLoanInterest),
      previousEmployerIncome: n(d?.previousEmployerIncome),
      previousEmployerTds: n(d?.previousEmployerTds),
      updatedAt: d?.updatedAt ?? null,
    };
  }

  /** Own declaration, or anyone's with `payroll.process`. */
  async getDeclaration(auth: AuthContext, employeeId: string | null, fy?: number) {
    const employee = await this.declarationOwner(auth, employeeId);
    const year = fy ?? (await this.currentFinancialYear(auth.organizationId!));
    return { employee: { id: employee.id, name: fullName(employee), employeeCode: employee.employeeCode }, ...(await this.declaration(employee.id, year)) };
  }

  async saveDeclaration(auth: AuthContext, employeeId: string | null, fy: number | undefined, dto: TaxDeclarationDto) {
    const employee = await this.declarationOwner(auth, employeeId);
    const year = fy ?? (await this.currentFinancialYear(auth.organizationId!));
    const current = await this.currentFinancialYear(auth.organizationId!);
    if (year < current - 1 || year > current + 1) throw AppError.validation([{ field: 'fy', message: 'Declarations can be changed for the current financial year only (or the next / previous one)' }]);
    const values = {
      regime: dto.regime,
      rentPaidAnnual: String(dto.rentPaidAnnual ?? 0),
      metroCity: dto.metroCity ?? false,
      section80c: String(dto.section80c ?? 0),
      section80ccd1b: String(dto.section80ccd1b ?? 0),
      section80d: String(dto.section80d ?? 0),
      homeLoanInterest: String(dto.homeLoanInterest ?? 0),
      previousEmployerIncome: String(dto.previousEmployerIncome ?? 0),
      previousEmployerTds: String(dto.previousEmployerTds ?? 0),
      updatedById: auth.userId,
    };
    await this.db.transaction(async (transaction) => {
      const existing = await TaxDeclarationRecord.findOne({ where: { employeeId: employee.id, financialYear: year }, transaction });
      if (existing) await existing.update(values, { transaction });
      else await TaxDeclarationRecord.create({ organizationId: auth.organizationId!, employeeId: employee.id, financialYear: year, ...values }, { transaction });
      await this.audit.record(
        { action: 'payroll.tax_declaration_saved', entityType: 'TaxDeclaration', entityId: employee.id, summary: `Tax declaration for FY ${year}-${(year + 1) % 100} saved for ${employee.employeeCode} (${dto.regime} regime)`, metadata: { employeeId: employee.id, financialYear: year, regime: dto.regime } },
        transaction,
      );
    });
    return this.getDeclaration(auth, employee.id, year);
  }

  private async declarationOwner(auth: AuthContext, employeeId: string | null): Promise<Employee> {
    const self = await this.scope.self(auth);
    if (!employeeId || employeeId === self?.id) {
      if (!self) throw AppError.notFound('Your employee record');
      return self;
    }
    if (!auth.permissions.has('payroll.process')) throw AppError.forbidden();
    const employee = await Employee.findByPk(employeeId);
    if (!employee) throw AppError.notFound('Employee');
    return employee;
  }

  private async accessible(auth: AuthContext, employeeId: string): Promise<Employee> {
    const employee = await Employee.findByPk(employeeId);
    if (!employee) throw AppError.notFound('Employee');
    const self = await this.scope.self(auth);
    if (self?.id === employee.id) return employee;
    if (!(await this.scope.covers(auth, 'employee.salary.view', employee))) throw AppError.notFound('Employee');
    return employee;
  }

  private async userIdOf(employee: Employee): Promise<string | null> {
    if (!employee.membershipId) return null;
    const m = await OrganizationMembership.findByPk(employee.membershipId, { attributes: ['userId', 'status'] });
    return m && m.status === 'ACTIVE' ? m.userId : null;
  }
}
