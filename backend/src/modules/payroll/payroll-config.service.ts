import { Injectable } from '@nestjs/common';
import { ForeignKeyConstraintError, UniqueConstraintError, type Transaction } from 'sequelize';
import { labourWelfareState, professionalTaxState, weekStartOf, type DailyRateBasis, type PayslipPdfPassword, type TimesheetMissedAction } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { zonedParts } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { EmployeeSalary, Organization, PayrollSettings, SalaryComponentDef, SalaryStructure, SalaryStructureLine } from '../../database/models';
import { AuditService, diff } from '../../infrastructure/audit/audit.service';
import type { ComponentDto, PayrollSettingsDto, StructureDto, StructureLineDto, UpdateComponentDto, UpdateStructureDto } from './dto/payroll.dto';
import type { StructureLine } from './payroll-engine';

export type EffectiveSettings = {
  pfEnabled: boolean;
  pfRestrictToCeiling: boolean;
  esiEnabled: boolean;
  ptEnabled: boolean;
  ptState: string | null;
  lopFromAttendance: boolean;
  pfEstablishmentCode: string | null;
  esiEmployerCode: string | null;
  tan: string | null;
  overtimeMultiplier: number;
  overtimeBasis: 'BASIC' | 'GROSS';
  timesheetsRequired: boolean;
  timesheetsFrom: string | null;
  timesheetDueWeekday: number;
  timesheetMissedAction: TimesheetMissedAction;
  timesheetAutoRemind: boolean;
  salaryApprovalThresholdPct: number | null;
  lwfEnabled: boolean;
  proofsFromMonth: number | null;
  leaveEncashmentBasis: DailyRateBasis;
  payslipEmailEnabled: boolean;
  payslipPdfPassword: PayslipPdfPassword;
};

const DEFAULTS: EffectiveSettings = {
  pfEnabled: true,
  pfRestrictToCeiling: true,
  esiEnabled: true,
  ptEnabled: true,
  ptState: null,
  lopFromAttendance: false,
  pfEstablishmentCode: null,
  esiEmployerCode: null,
  tan: null,
  overtimeMultiplier: 2,
  overtimeBasis: 'GROSS',
  timesheetsRequired: false,
  timesheetsFrom: null,
  timesheetDueWeekday: 1,
  timesheetMissedAction: 'FLAG',
  timesheetAutoRemind: true,
  salaryApprovalThresholdPct: null,
  lwfEnabled: false,
  proofsFromMonth: null,
  leaveEncashmentBasis: 'BASIC_26',
  payslipEmailEnabled: false,
  payslipPdfPassword: 'DOB',
};

/** Recommended starting point (created only on request): Basic at half the CTC, HRA at half of Basic, the rest as a special allowance. */
const STANDARD_COMPONENTS = [
  { code: 'BASIC', name: 'Basic salary', role: 'BASIC' as const, taxable: true, pfWage: true, esiWage: true, description: 'Basis for PF, gratuity and HRA.' },
  { code: 'HRA', name: 'House rent allowance', role: 'HRA' as const, taxable: true, pfWage: false, esiWage: true, description: 'Partly exempt under the old tax regime when rent is paid.' },
  { code: 'SPECIAL', name: 'Special allowance', role: null, taxable: true, pfWage: false, esiWage: true, description: 'Balancing allowance: whatever remains of the gross.' },
];

export function presentComponent(c: SalaryComponentDef) {
  return { id: c.id, code: c.code, name: c.name, description: c.description, role: c.role, taxable: c.taxable, pfWage: c.pfWage, esiWage: c.esiWage, isActive: c.isActive };
}

/** Statutory settings, salary components and salary structures (`payroll.configure`). */
@Injectable()
export class PayrollConfigService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ---- Settings --------------------------------------------------------------------------------

  async settings(organizationId: string): Promise<EffectiveSettings> {
    const s = await PayrollSettings.findByPk(organizationId);
    if (!s) return { ...DEFAULTS };
    return {
      pfEnabled: s.pfEnabled,
      pfRestrictToCeiling: s.pfRestrictToCeiling,
      esiEnabled: s.esiEnabled,
      ptEnabled: s.ptEnabled,
      ptState: s.ptState,
      lopFromAttendance: s.lopFromAttendance,
      pfEstablishmentCode: s.pfEstablishmentCode,
      esiEmployerCode: s.esiEmployerCode,
      tan: s.tan,
      overtimeMultiplier: Number(s.overtimeMultiplier),
      overtimeBasis: s.overtimeBasis,
      timesheetsRequired: s.timesheetsRequired,
      timesheetsFrom: s.timesheetsFrom,
      timesheetDueWeekday: s.timesheetDueWeekday,
      timesheetMissedAction: s.timesheetMissedAction,
      timesheetAutoRemind: s.timesheetAutoRemind,
      salaryApprovalThresholdPct: s.salaryApprovalThresholdPct === null ? null : Number(s.salaryApprovalThresholdPct),
      lwfEnabled: s.lwfEnabled,
      proofsFromMonth: s.proofsFromMonth,
      leaveEncashmentBasis: s.leaveEncashmentBasis,
      payslipEmailEnabled: s.payslipEmailEnabled,
      payslipPdfPassword: s.payslipPdfPassword,
    };
  }

  private async organizationTimeZone(organizationId: string): Promise<string> {
    return (await Organization.findByPk(organizationId, { attributes: ['timezone'] }))?.timezone ?? 'UTC';
  }

  /** Settings with the organization's own state as the professional-tax fallback (for display). */
  async settingsView(auth: AuthContext) {
    const [settings, org] = await Promise.all([this.settings(auth.organizationId!), Organization.findByPk(auth.organizationId!, { attributes: ['state'] })]);
    return {
      ...settings,
      organizationState: org?.state ?? null,
      organizationPtState: professionalTaxState(org?.state)?.code ?? null,
      organizationLwfState: labourWelfareState(org?.state)?.name ?? null,
    };
  }

  async updateSettings(auth: AuthContext, dto: PayrollSettingsDto) {
    const before = await this.settings(auth.organizationId!);
    const next = { ...before, ...Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) } as EffectiveSettings;
    if (next.timesheetsFrom) next.timesheetsFrom = weekStartOf(next.timesheetsFrom);
    // Loosening the salary approval step is itself a checker decision, or a reviser could switch it off and proceed.
    const loosened = before.salaryApprovalThresholdPct !== null && (next.salaryApprovalThresholdPct === null || next.salaryApprovalThresholdPct > before.salaryApprovalThresholdPct);
    if (loosened && !auth.permissions.has('employee.salary.approve')) {
      throw AppError.forbidden('Raising or removing the salary approval threshold needs the "Approve salary revisions" permission');
    }
    // Switching timesheets on starts from the current week, so earlier weeks never count as missed.
    if (next.timesheetsRequired && (!before.timesheetsRequired || !next.timesheetsFrom) && !dto.timesheetsFrom) {
      next.timesheetsFrom = weekStartOf(zonedParts(new Date(), await this.organizationTimeZone(auth.organizationId!)).date);
    }
    await this.db.transaction(async (transaction) => {
      const values = {
        ...next,
        overtimeMultiplier: String(next.overtimeMultiplier),
        salaryApprovalThresholdPct: next.salaryApprovalThresholdPct === null ? null : String(next.salaryApprovalThresholdPct),
        updatedById: auth.userId,
      };
      const row = await PayrollSettings.findByPk(auth.organizationId!, { transaction, lock: transaction.LOCK.UPDATE });
      if (row) await row.update(values, { transaction });
      else await PayrollSettings.create({ organizationId: auth.organizationId!, ...values }, { transaction });
      await this.audit.record({ action: 'payroll.settings_updated', entityType: 'PayrollSettings', summary: 'Payroll settings updated', changes: diff(before, next) }, transaction);
    });
    return this.settingsView(auth);
  }

  // ---- Components ------------------------------------------------------------------------------

  async components() {
    const rows = await SalaryComponentDef.findAll({
      order: [
        ['isActive', 'DESC'],
        ['role', 'ASC NULLS LAST'],
        ['name', 'ASC'],
      ],
    });
    return rows.map(presentComponent);
  }

  async createComponent(auth: AuthContext, dto: ComponentDto) {
    try {
      const c = await this.db.transaction(async (transaction) => {
        const created = await SalaryComponentDef.create({ organizationId: auth.organizationId!, ...dto, createdById: auth.userId, updatedById: auth.userId }, { transaction });
        await this.audit.record({ action: 'payroll.component_created', entityType: 'SalaryComponent', entityId: created.id, summary: `Salary component ${created.code} created` }, transaction);
        return created;
      });
      return presentComponent(c);
    } catch (e) {
      throw this.componentConflict(e);
    }
  }

  async updateComponent(auth: AuthContext, id: string, dto: UpdateComponentDto) {
    const c = await SalaryComponentDef.findByPk(id);
    if (!c) throw AppError.notFound('Salary component');
    const before = presentComponent(c);
    try {
      await this.db.transaction(async (transaction) => {
        await c.update({ ...dto, updatedById: auth.userId }, { transaction });
        await this.audit.record(
          { action: 'payroll.component_updated', entityType: 'SalaryComponent', entityId: id, summary: `Salary component ${c.code} updated`, changes: diff(before, presentComponent(c)) },
          transaction,
        );
      });
    } catch (e) {
      throw this.componentConflict(e);
    }
    return presentComponent(c);
  }

  async removeComponent(auth: AuthContext, id: string) {
    const c = await SalaryComponentDef.findByPk(id);
    if (!c) throw AppError.notFound('Salary component');
    try {
      await this.db.transaction(async (transaction) => {
        await c.destroy({ transaction });
        await this.audit.record({ action: 'payroll.component_deleted', entityType: 'SalaryComponent', entityId: id, summary: `Salary component ${c.code} deleted` }, transaction);
      });
    } catch (e) {
      if (e instanceof ForeignKeyConstraintError) throw AppError.conflict('This component is used in a salary structure. Remove it from the structures or deactivate it instead.');
      throw e;
    }
  }

  private componentConflict(e: unknown): unknown {
    if (e instanceof UniqueConstraintError) {
      const fields = Object.keys(e.fields ?? {});
      return fields.includes('role')
        ? AppError.conflict('Another component already has this role (one Basic and one HRA per organization)')
        : AppError.conflict('A component with this code already exists');
    }
    return e;
  }

  // ---- Structures ------------------------------------------------------------------------------

  async structures() {
    const [rows, used] = await Promise.all([
      SalaryStructure.findAll({
        include: [{ model: SalaryStructureLine, include: [{ model: SalaryComponentDef }] }],
        order: [
          ['isActive', 'DESC'],
          ['name', 'ASC'],
        ],
      }),
      EmployeeSalary.findAll({ attributes: ['structureId'], group: ['structureId'], raw: true }),
    ]);
    const usedIds = new Set(used.map((u) => u.structureId));
    return rows.map((s) => this.presentStructure(s, usedIds.has(s.id)));
  }

  async structure(id: string) {
    const s = await SalaryStructure.findByPk(id, { include: [{ model: SalaryStructureLine, include: [{ model: SalaryComponentDef }] }] });
    if (!s) throw AppError.notFound('Salary structure');
    return s;
  }

  presentStructure(s: SalaryStructure, inUse = false) {
    const lines = [...(s.lines ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      isActive: s.isActive,
      inUse,
      lines: lines.map((l) => ({
        id: l.id,
        componentId: l.componentId,
        component: l.component ? presentComponent(l.component) : null,
        calculation: l.calculation,
        value: l.value === null ? null : Number(l.value),
      })),
    };
  }

  /** Lines in calculation form; throws when the structure is missing or inactive. */
  async linesFor(structureId: string, requireActive = true): Promise<{ structure: SalaryStructure; lines: StructureLine[] }> {
    const s = await this.structure(structureId);
    if (requireActive && !s.isActive) throw AppError.validation([{ field: 'structureId', message: 'This salary structure is inactive' }]);
    const lines = [...(s.lines ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => ({
        componentId: l.componentId,
        code: l.component!.code,
        name: l.component!.name,
        role: l.component!.role ?? null,
        calculation: l.calculation,
        value: l.value === null ? null : Number(l.value),
        taxable: l.component!.taxable,
        pfWage: l.component!.pfWage,
        esiWage: l.component!.esiWage,
      }));
    return { structure: s, lines };
  }

  async createStructure(auth: AuthContext, dto: StructureDto) {
    await this.validateLines(dto.lines);
    try {
      const id = await this.db.transaction(async (transaction) => {
        const s = await SalaryStructure.create(
          { organizationId: auth.organizationId!, name: dto.name, description: dto.description ?? null, isActive: dto.isActive ?? true, createdById: auth.userId, updatedById: auth.userId },
          { transaction },
        );
        await this.writeLines(auth, s.id, dto.lines, transaction);
        await this.audit.record({ action: 'payroll.structure_created', entityType: 'SalaryStructure', entityId: s.id, summary: `Salary structure "${s.name}" created` }, transaction);
        return s.id;
      });
      return this.presentStructure(await this.structure(id));
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict('A structure with this name already exists');
      throw e;
    }
  }

  /** Existing salaries keep their breakdown snapshot; changes apply to salaries set from now on. */
  async updateStructure(auth: AuthContext, id: string, dto: UpdateStructureDto) {
    const s = await this.structure(id);
    if (dto.lines) await this.validateLines(dto.lines);
    try {
      await this.db.transaction(async (transaction) => {
        await s.update(
          {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.description !== undefined ? { description: dto.description } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            updatedById: auth.userId,
          },
          { transaction },
        );
        if (dto.lines) {
          await SalaryStructureLine.destroy({ where: { structureId: id }, transaction });
          await this.writeLines(auth, id, dto.lines, transaction);
        }
        await this.audit.record({ action: 'payroll.structure_updated', entityType: 'SalaryStructure', entityId: id, summary: `Salary structure "${s.name}" updated` }, transaction);
      });
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict('A structure with this name already exists');
      throw e;
    }
    return this.presentStructure(await this.structure(id), (await EmployeeSalary.count({ where: { structureId: id } })) > 0);
  }

  async removeStructure(auth: AuthContext, id: string) {
    const s = await this.structure(id);
    if (await EmployeeSalary.count({ where: { structureId: id } })) throw AppError.conflict('Employees have salaries on this structure. Deactivate it instead.');
    await this.db.transaction(async (transaction) => {
      await s.destroy({ transaction });
      await this.audit.record({ action: 'payroll.structure_deleted', entityType: 'SalaryStructure', entityId: id, summary: `Salary structure "${s.name}" deleted` }, transaction);
    });
  }

  /** Creates the standard components and structure (skips what already exists). */
  async recommended(auth: AuthContext) {
    await this.db.transaction(async (transaction) => {
      const existing = await SalaryComponentDef.findAll({ transaction });
      const byCode = new Map(existing.map((c) => [c.code, c]));
      const byRole = new Map(existing.filter((c) => c.role).map((c) => [c.role!, c]));
      const ids: Record<string, string> = {};
      for (const c of STANDARD_COMPONENTS) {
        const found = byCode.get(c.code) ?? (c.role ? byRole.get(c.role) : undefined);
        ids[c.code] = found ? found.id : (await SalaryComponentDef.create({ organizationId: auth.organizationId!, ...c, createdById: auth.userId, updatedById: auth.userId }, { transaction })).id;
      }
      if (!(await SalaryStructure.count({ where: { name: 'Standard' }, transaction }))) {
        const s = await SalaryStructure.create(
          {
            organizationId: auth.organizationId!,
            name: 'Standard',
            description: 'Basic 50% of CTC, HRA 50% of Basic, special allowance as the balance.',
            createdById: auth.userId,
            updatedById: auth.userId,
          },
          { transaction },
        );
        await this.writeLines(
          auth,
          s.id,
          [
            { componentId: ids.BASIC!, calculation: 'PERCENT_OF_CTC', value: 50 },
            { componentId: ids.HRA!, calculation: 'PERCENT_OF_BASIC', value: 50 },
            { componentId: ids.SPECIAL!, calculation: 'BALANCE', value: null },
          ],
          transaction,
        );
      }
      await this.audit.record({ action: 'payroll.recommended_setup', entityType: 'SalaryStructure', summary: 'Standard salary components and structure added' }, transaction);
    });
    return { components: await this.components(), structures: await this.structures() };
  }

  private async writeLines(auth: AuthContext, structureId: string, lines: StructureLineDto[], transaction: Transaction) {
    await SalaryStructureLine.bulkCreate(
      lines.map((l, i) => ({
        organizationId: auth.organizationId!,
        structureId,
        componentId: l.componentId,
        calculation: l.calculation,
        value: l.calculation === 'BALANCE' ? null : String(l.value),
        sortOrder: i,
      })),
      { transaction },
    );
  }

  private async validateLines(lines: StructureLineDto[]) {
    const issues: { field: string; message: string }[] = [];
    const ids = lines.map((l) => l.componentId);
    if (new Set(ids).size !== ids.length) issues.push({ field: 'lines', message: 'Each component can appear only once' });
    const components = new Map((await SalaryComponentDef.findAll({ where: { id: ids } })).map((c) => [c.id, c]));
    lines.forEach((l, i) => {
      const c = components.get(l.componentId);
      if (!c) return issues.push({ field: `lines.${i}.componentId`, message: 'Unknown component' });
      if (!c.isActive) issues.push({ field: `lines.${i}.componentId`, message: `${c.name} is inactive` });
      if (l.calculation !== 'BALANCE' && (l.value === null || l.value === undefined)) issues.push({ field: `lines.${i}.value`, message: `Enter a value for ${c.name}` });
      if ((l.calculation === 'PERCENT_OF_CTC' || l.calculation === 'PERCENT_OF_BASIC') && l.value !== null && l.value !== undefined && (l.value <= 0 || l.value > 100)) {
        issues.push({ field: `lines.${i}.value`, message: `${c.name}: a percentage must be between 0 and 100` });
      }
      if (l.calculation === 'BALANCE' && c.pfWage) issues.push({ field: `lines.${i}.componentId`, message: `${c.name} counts towards PF wages, so it can't be the balancing component` });
      if (c.role === 'BASIC' && (l.calculation === 'PERCENT_OF_BASIC' || l.calculation === 'BALANCE'))
        issues.push({ field: `lines.${i}.calculation`, message: 'Basic must be a percentage of CTC or a fixed amount' });
    });
    if (lines.filter((l) => l.calculation === 'BALANCE').length !== 1) issues.push({ field: 'lines', message: 'Exactly one component must be the balance' });
    if (!lines.some((l) => components.get(l.componentId)?.role === 'BASIC')) issues.push({ field: 'lines', message: 'Include the Basic component' });
    if (issues.length) throw AppError.validation(issues);
  }
}
