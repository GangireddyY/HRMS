import { Injectable } from '@nestjs/common';
import { Op, UniqueConstraintError, type Transaction, type WhereOptions } from 'sequelize';
import { financialYearOf, professionalTaxState, type ProfessionalTaxState } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { csvCell } from '../../common/utils/csv';
import { containsPattern } from '../../common/utils/like';
import { monthRange } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import {
  AttendancePeriod,
  AttendanceRecord,
  BenefitEnrollment,
  BenefitPlan,
  Department,
  Designation,
  Employee,
  EmployeeSalary,
  Holiday,
  Location,
  MembershipRole,
  Organization,
  OrganizationMembership,
  PayrollAdjustment,
  PayrollRun,
  Payslip,
  Permission,
  ReimbursementClaim,
  RolePermission,
  TaxDeclarationRecord,
  User,
  type PayslipLine,
} from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import { AttendanceRulesService, type DayLeave, type EmployeeContext } from '../attendance/attendance-rules.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AdjustmentDto, CreateRunDto, PayRunDto, RejectRunDto, ReviewRunDto, RunPayslipQueryDto, RunQueryDto, UpdatePayslipDto } from './dto/payroll.dto';
import { PayrollConfigService, type EffectiveSettings } from './payroll-config.service';
import {
  ageOn,
  earnedComponents,
  esiContribution,
  esiCovered,
  monthlyTds,
  pfContribution,
  professionalTax,
  type PayDay,
  type SalaryComponent,
  type TaxFigures,
} from './payroll-engine';
import { SalariesService } from './salaries.service';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const periodLabel = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;
const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mask = (v: string | null, keep = 4) => (v ? `${'•'.repeat(Math.max(0, v.length - keep))}${v.slice(-keep)}` : null);

/** Months of the ESI contribution period (April–September / October–March) before this one. */
function earlierInContributionPeriod(year: number, month: number): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let y = year;
  let m = month;
  while (m !== 4 && m !== 10) {
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
    out.push({ year: y, month: m });
  }
  return out;
}

/** Months of the financial year before this one. */
function earlierInFinancialYear(year: number, month: number): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let y = year;
  let m = month;
  while (m !== 4) {
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
    out.push({ year: y, month: m });
  }
  return out;
}

const periodWhere = (periods: { year: number; month: number }[]): WhereOptions => (periods.length ? { [Op.or]: periods.map((p) => ({ year: p.year, month: p.month })) } : { id: null });

/** One contribution per benefit plan and month: when coverage changed during the month, the latest enrolment's. */
function latestPerPlan(enrollments: BenefitEnrollment[]): BenefitEnrollment[] {
  const by = new Map<string, BenefitEnrollment>();
  for (const e of enrollments) {
    const prior = by.get(e.planId);
    if (!prior || (e.effectiveFrom ?? '') >= (prior.effectiveFrom ?? '')) by.set(e.planId, e);
  }
  return [...by.values()];
}

interface CalcContext {
  run: PayrollRun;
  settings: EffectiveSettings;
  orgState: string | null;
  from: string;
  to: string;
  days: string[];
  today: string;
  attendanceLop: boolean;
}

/** Payroll runs: calculation, review workflow (process → approve → pay), payslips and statutory exports. */
@Injectable()
export class PayrollRunsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly config: PayrollConfigService,
    private readonly salaries: SalariesService,
    private readonly rules: AttendanceRulesService,
    private readonly notifications: NotificationsService,
    private readonly crypto: EncryptionService,
  ) {}

  // ---- Runs ------------------------------------------------------------------------------------

  async list(query: RunQueryDto) {
    const where: WhereOptions = { ...(query.year ? { year: query.year } : {}), ...(query.status ? { status: query.status } : {}) };
    const { rows, count } = await PayrollRun.findAndCountAll({ where, order: [['year', 'DESC'], ['month', 'DESC'], ['createdAt', 'DESC']], ...paginationArgs(query) });
    const names = await this.userNames(rows.flatMap((r) => [r.calculatedById, r.submittedById, r.reviewedById, r.paidById]));
    return new PaginatedResult(rows.map((r) => this.presentRun(r, names)), paginationMeta(query, count));
  }

  async create(auth: AuthContext, dto: CreateRunDto) {
    const today = await this.salaries.today(auth.organizationId!);
    const { from } = monthRange(dto.year, dto.month);
    if (from > today) throw AppError.validation([{ field: 'month', message: 'Payroll can be run for the current month or earlier' }]);
    const open = await PayrollRun.findOne({ where: { status: ['DRAFT', 'SUBMITTED'] } });
    if (open) throw AppError.conflict(`Payroll for ${periodLabel(open.year, open.month)} is still in progress. Finish or cancel it first.`);
    const latest = await PayrollRun.findOne({ where: { status: ['APPROVED', 'PAID'] }, order: [['year', 'DESC'], ['month', 'DESC']] });
    if (latest && dto.year * 12 + dto.month <= latest.year * 12 + latest.month) {
      throw AppError.validation([{ field: 'month', message: `Payroll is already processed up to ${periodLabel(latest.year, latest.month)}` }]);
    }
    let run: PayrollRun;
    try {
      run = await PayrollRun.create({ organizationId: auth.organizationId!, year: dto.year, month: dto.month, notes: dto.notes ?? null, createdById: auth.userId });
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict(`A payroll run for ${periodLabel(dto.year, dto.month)} already exists`);
      throw e;
    }
    await this.audit.record({ action: 'payroll.run_created', entityType: 'PayrollRun', entityId: run.id, summary: `Payroll run for ${periodLabel(run.year, run.month)} created` });
    try {
      await this.calculate(auth, run.id);
    } catch (e) {
      // The run stays as a draft; the caller sees why it couldn't be calculated (e.g. attendance not closed).
      if (!(e instanceof AppError)) throw e;
    }
    return this.get(auth, run.id);
  }

  async get(auth: AuthContext, id: string) {
    const run = await this.find(id);
    const { from, to } = monthRange(run.year, run.month);
    const [payslips, names, settings, closed, missing] = await Promise.all([
      Payslip.findAll({ where: { runId: id }, attributes: ['earnings', 'deductions', 'employerContributions', 'excluded', 'warnings'] }),
      this.userNames([run.calculatedById, run.submittedById, run.reviewedById, run.paidById, run.createdById]),
      this.config.settings(auth.organizationId!),
      AttendancePeriod.count({ where: { year: run.year, month: run.month } }),
      this.missingSalary(from, to),
    ]);
    const included = payslips.filter((p) => !p.excluded);
    const totals = (pick: (p: Payslip) => PayslipLine[]) => {
      const m = new Map<string, { code: string; name: string; amount: number }>();
      for (const p of included) for (const l of pick(p)) m.set(l.code, { code: l.code, name: l.name, amount: (m.get(l.code)?.amount ?? 0) + l.amount });
      return [...m.values()];
    };
    const self = auth.userId;
    return {
      ...this.presentRun(run, names),
      notes: run.notes,
      summary: {
        earnings: totals((p) => p.earnings),
        deductions: totals((p) => p.deductions),
        employerContributions: totals((p) => p.employerContributions),
        held: payslips.length - included.length,
        blocking: included.filter((p) => p.warnings.some((w) => w.startsWith('!'))).length,
      },
      missingSalary: missing,
      attendance: { lopFromAttendance: settings.lopFromAttendance && auth.features.has('attendance'), monthClosed: closed > 0 },
      permissions: {
        process: auth.permissions.has('payroll.process') && run.status === 'DRAFT',
        approve: auth.permissions.has('payroll.approve') && run.status === 'SUBMITTED' && run.submittedById !== self && run.calculatedById !== self,
        pay: auth.permissions.has('payroll.disburse') && run.status === 'APPROVED',
        cancel: auth.permissions.has('payroll.process') && (run.status === 'DRAFT' || run.status === 'SUBMITTED'),
      },
    };
  }

  /** Recalculates every payslip of a draft run (holds, loss-of-pay overrides and adjustments are kept). */
  async calculate(auth: AuthContext, id: string, employeeIds?: string[]) {
    await this.db.transaction(async (transaction) => {
      const run = await PayrollRun.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!run) throw AppError.notFound('Payroll run');
      if (run.status !== 'DRAFT') throw AppError.conflict('Only a draft payroll run can be recalculated');
      const ctx = await this.context(auth, run);
      await this.calculateEmployees(auth, ctx, transaction, employeeIds);
      await this.refreshTotals(run, transaction);
      await run.update({ calculatedAt: new Date(), calculatedById: auth.userId }, { transaction });
      if (!employeeIds) {
        await this.audit.record({ action: 'payroll.run_calculated', entityType: 'PayrollRun', entityId: id, summary: `Payroll for ${periodLabel(run.year, run.month)} calculated (${run.employeeCount} employees)` }, transaction);
      }
    });
    return this.get(auth, id);
  }

  async submit(auth: AuthContext, id: string) {
    await this.calculate(auth, id);
    await this.db.transaction(async (transaction) => {
      const run = await PayrollRun.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!run || run.status !== 'DRAFT') throw AppError.conflict('Only a draft payroll run can be submitted');
      if (!run.employeeCount) throw AppError.conflict('There is nobody to pay in this run');
      const blocking = (await Payslip.findAll({ where: { runId: id, excluded: false }, attributes: ['warnings'], transaction })).filter((p) => p.warnings.some((w) => w.startsWith('!')));
      if (blocking.length) throw AppError.conflict(`${blocking.length} payslip${blocking.length === 1 ? ' has' : 's have'} problems that must be fixed (or the employee held) first`);
      await run.update({ status: 'SUBMITTED', submittedAt: new Date(), submittedById: auth.userId, reviewNote: null }, { transaction });
      await this.audit.record({ action: 'payroll.run_submitted', entityType: 'PayrollRun', entityId: id, summary: `Payroll for ${periodLabel(run.year, run.month)} submitted for approval` }, transaction);
      for (const userId of await this.usersWithPermission('payroll.approve', transaction)) {
        if (userId === auth.userId || userId === run.calculatedById) continue;
        await this.notifications.notify(
          userId,
          { organizationId: auth.organizationId, type: 'payroll.run', title: `Payroll for ${periodLabel(run.year, run.month)} is waiting for your approval`, link: `/hr/payroll/runs/${id}` },
          transaction,
        );
      }
    });
    return this.get(auth, id);
  }

  /** Someone other than the person who calculated or submitted the run approves it; payslips are then published. */
  async approve(auth: AuthContext, id: string, dto: ReviewRunDto) {
    await this.db.transaction(async (transaction) => {
      const run = await PayrollRun.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!run) throw AppError.notFound('Payroll run');
      if (run.status !== 'SUBMITTED') throw AppError.conflict('Only a submitted payroll run can be approved');
      if (run.submittedById === auth.userId || run.calculatedById === auth.userId) throw AppError.forbidden('Someone other than the person who processed this payroll must approve it');
      await run.update({ status: 'APPROVED', reviewedAt: new Date(), reviewedById: auth.userId, reviewNote: dto.note ?? null }, { transaction });
      await this.audit.record({ action: 'payroll.run_approved', entityType: 'PayrollRun', entityId: id, summary: `Payroll for ${periodLabel(run.year, run.month)} approved`, metadata: { totalNet: Number(run.totalNet), employees: run.employeeCount } }, transaction);
      const payslips = await Payslip.findAll({ where: { runId: id, excluded: false }, attributes: ['id', 'employeeId'], transaction });
      const users = await this.userIdsOfEmployees(payslips.map((p) => p.employeeId), transaction);
      for (const p of payslips) {
        const userId = users.get(p.employeeId);
        if (userId) await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'payroll.payslip', title: `Your payslip for ${periodLabel(run.year, run.month)} is ready`, link: `/me/payslips/${p.id}` }, transaction);
      }
      if (run.submittedById) {
        await this.notifications.notify(run.submittedById, { organizationId: auth.organizationId, type: 'payroll.run', title: `Payroll for ${periodLabel(run.year, run.month)} was approved`, link: `/hr/payroll/runs/${id}` }, transaction);
      }
    });
    return this.get(auth, id);
  }

  async reject(auth: AuthContext, id: string, dto: RejectRunDto) {
    await this.db.transaction(async (transaction) => {
      const run = await PayrollRun.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!run) throw AppError.notFound('Payroll run');
      if (run.status !== 'SUBMITTED') throw AppError.conflict('Only a submitted payroll run can be sent back');
      if (run.submittedById === auth.userId) throw AppError.forbidden('Someone other than the submitter must review this payroll');
      await run.update({ status: 'DRAFT', reviewedAt: new Date(), reviewedById: auth.userId, reviewNote: dto.note }, { transaction });
      await this.audit.record({ action: 'payroll.run_rejected', entityType: 'PayrollRun', entityId: id, summary: `Payroll for ${periodLabel(run.year, run.month)} sent back: ${dto.note}` }, transaction);
      if (run.submittedById) {
        await this.notifications.notify(run.submittedById, { organizationId: auth.organizationId, type: 'payroll.run', title: `Payroll for ${periodLabel(run.year, run.month)} was sent back`, body: dto.note, link: `/hr/payroll/runs/${id}` }, transaction);
      }
    });
    return this.get(auth, id);
  }

  async markPaid(auth: AuthContext, id: string, dto: PayRunDto) {
    await this.db.transaction(async (transaction) => {
      const run = await PayrollRun.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!run) throw AppError.notFound('Payroll run');
      if (run.status !== 'APPROVED') throw AppError.conflict('Only an approved payroll run can be marked as paid');
      await run.update({ status: 'PAID', paidAt: new Date(), paidById: auth.userId, paymentReference: dto.paymentReference }, { transaction });
      const excludedEmployees = (await Payslip.findAll({ where: { runId: id, excluded: true }, attributes: ['employeeId'], transaction })).map((p) => p.employeeId);
      await ReimbursementClaim.update(
        { status: 'PAID' },
        { where: { payrollRunId: id, status: 'APPROVED', ...(excludedEmployees.length ? { employeeId: { [Op.notIn]: excludedEmployees } } : {}) }, transaction },
      );
      await this.audit.record({ action: 'payroll.run_paid', entityType: 'PayrollRun', entityId: id, summary: `Payroll for ${periodLabel(run.year, run.month)} marked as paid (${dto.paymentReference})` }, transaction);
    });
    return this.get(auth, id);
  }

  async cancel(auth: AuthContext, id: string) {
    await this.db.transaction(async (transaction) => {
      const run = await PayrollRun.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!run) throw AppError.notFound('Payroll run');
      if (run.status !== 'DRAFT' && run.status !== 'SUBMITTED') throw AppError.conflict('Approved or paid payroll cannot be cancelled');
      await run.update({ status: 'CANCELLED' }, { transaction });
      await ReimbursementClaim.update({ payrollRunId: null }, { where: { payrollRunId: id, status: 'APPROVED' }, transaction });
      await this.audit.record({ action: 'payroll.run_cancelled', entityType: 'PayrollRun', entityId: id, summary: `Payroll run for ${periodLabel(run.year, run.month)} cancelled` }, transaction);
    });
    return this.get(auth, id);
  }

  // ---- Payslips within a run -------------------------------------------------------------------

  async payslips(id: string, query: RunPayslipQueryDto) {
    await this.find(id);
    const conditions: WhereOptions[] = [{ runId: id }];
    if (query.filter === 'held') conditions.push({ excluded: true });
    if (query.filter === 'warnings') conditions.push(this.db.sequelize.literal(`jsonb_array_length("Payslip"."warnings") > 0`) as unknown as WhereOptions);
    if (query.search) {
      const like = containsPattern(query.search);
      conditions.push({ [Op.or]: [{ employee: { name: { [Op.iLike]: like } } }, { employee: { employeeCode: { [Op.iLike]: like } } }] } as WhereOptions);
    }
    const { rows, count } = await Payslip.findAndCountAll({ where: { [Op.and]: conditions }, order: [[this.db.sequelize.literal(`"Payslip"."employee"->>'name'`), 'ASC']], ...paginationArgs(query) });
    return new PaginatedResult(rows.map((p) => this.presentPayslip(p, null, false)), paginationMeta(query, count));
  }

  async updatePayslip(auth: AuthContext, runId: string, payslipId: string, dto: UpdatePayslipDto) {
    const p = await Payslip.findOne({ where: { id: payslipId, runId } });
    if (!p) throw AppError.notFound('Payslip');
    await this.assertDraft(runId);
    if (dto.lopOverride !== undefined && dto.lopOverride !== null) {
      if (Math.round(dto.lopOverride * 2) !== dto.lopOverride * 2) throw AppError.validation([{ field: 'lopOverride', message: 'Use whole or half days' }]);
      if (dto.lopOverride > Number(p.employedDays)) throw AppError.validation([{ field: 'lopOverride', message: `Can't exceed the ${Number(p.employedDays)} days employed this month` }]);
    }
    if (dto.excluded && !dto.excludeReason && !p.excludeReason) throw AppError.validation([{ field: 'excludeReason', message: 'Give a reason for holding the salary' }]);
    await p.update({
      ...(dto.lopOverride !== undefined ? { lopOverride: dto.lopOverride === null ? null : String(dto.lopOverride) } : {}),
      ...(dto.excluded !== undefined ? { excluded: dto.excluded, excludeReason: dto.excluded ? (dto.excludeReason ?? p.excludeReason) : null } : {}),
    });
    await this.audit.record({
      action: 'payroll.payslip_updated',
      entityType: 'Payslip',
      entityId: p.id,
      summary: `${String(p.employee.employeeCode)}: ${dto.excluded === true ? `salary held (${dto.excludeReason ?? p.excludeReason})` : dto.excluded === false ? 'hold released' : `loss of pay set to ${dto.lopOverride ?? 'attendance'}`}`,
    });
    await this.calculate(auth, runId, [p.employeeId]);
    return this.payslip(auth, p.id);
  }

  async addAdjustment(auth: AuthContext, runId: string, dto: AdjustmentDto) {
    await this.assertDraft(runId);
    const p = await Payslip.findOne({ where: { runId, employeeId: dto.employeeId } });
    if (!p) throw AppError.validation([{ field: 'employeeId', message: 'This employee is not part of this payroll run' }]);
    await PayrollAdjustment.create({
      organizationId: auth.organizationId!,
      runId,
      employeeId: dto.employeeId,
      kind: dto.kind,
      label: dto.label,
      amount: String(dto.amount),
      taxable: dto.kind === 'EARNING' ? (dto.taxable ?? true) : false,
      createdById: auth.userId,
    });
    await this.audit.record({ action: 'payroll.adjustment_added', entityType: 'Payslip', entityId: p.id, summary: `${String(p.employee.employeeCode)}: ${dto.kind === 'EARNING' ? 'earning' : 'deduction'} "${dto.label}" added` });
    await this.calculate(auth, runId, [dto.employeeId]);
    return this.payslip(auth, p.id);
  }

  async removeAdjustment(auth: AuthContext, runId: string, adjustmentId: string) {
    await this.assertDraft(runId);
    const a = await PayrollAdjustment.findOne({ where: { id: adjustmentId, runId } });
    if (!a) throw AppError.notFound('Adjustment');
    await a.destroy();
    const p = await Payslip.findOne({ where: { runId, employeeId: a.employeeId } });
    await this.audit.record({ action: 'payroll.adjustment_removed', entityType: 'Payslip', entityId: p?.id ?? null, summary: `Adjustment "${a.label}" removed` });
    await this.calculate(auth, runId, [a.employeeId]);
    return p ? this.payslip(auth, p.id) : null;
  }

  /**
   * One payslip. Published payslips (approved / paid runs, not held) are visible to the employee and within
   * `payroll.payslip.view` scope; `payroll.view` sees every payslip, including drafts.
   */
  async payslip(auth: AuthContext, id: string) {
    const p = await Payslip.findByPk(id, { include: [{ model: PayrollRun }] });
    if (!p) throw AppError.notFound('Payslip');
    const published = (p.run!.status === 'APPROVED' || p.run!.status === 'PAID') && !p.excluded;
    const isHr = auth.permissions.has('payroll.view');
    if (!isHr) {
      const employee = await Employee.findByPk(p.employeeId, { attributes: ['id', 'managerId', 'departmentId'] });
      if (!published || !employee || !(await this.scope.covers(auth, 'payroll.payslip.view', employee))) throw AppError.notFound('Payslip');
    }
    const adjustments = isHr ? await PayrollAdjustment.findAll({ where: { runId: p.runId, employeeId: p.employeeId }, order: [['createdAt', 'ASC']] }) : [];
    const org = await Organization.findByPk(auth.organizationId!, { attributes: ['name', 'legalName', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'logoUrl'] });
    return {
      ...this.presentPayslip(p, p.run!, true),
      organization: org
        ? { name: org.legalName || org.name, address: [org.addressLine1, org.addressLine2, org.city, org.state, org.postalCode].filter(Boolean).join(', ') || null, logoUrl: org.logoUrl }
        : null,
      adjustments: adjustments.map((a) => ({ id: a.id, kind: a.kind, label: a.label, amount: Number(a.amount), taxable: a.taxable })),
    };
  }

  async myPayslips(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return [];
    const rows = await Payslip.findAll({
      where: { employeeId: self.id, excluded: false },
      include: [{ model: PayrollRun, where: { status: ['APPROVED', 'PAID'] }, attributes: ['id', 'year', 'month', 'status', 'paidAt'] }],
      order: [['run', 'year', 'DESC'], ['run', 'month', 'DESC']],
    });
    return rows.map((p) => ({
      id: p.id,
      year: p.run!.year,
      month: p.run!.month,
      period: periodLabel(p.run!.year, p.run!.month),
      status: p.run!.status,
      paidAt: p.run!.paidAt,
      gross: Number(p.gross),
      totalDeductions: Number(p.totalDeductions),
      netPay: Number(p.netPay),
    }));
  }

  // ---- Exports ---------------------------------------------------------------------------------

  /** Payroll register: one row per paid employee with every earning, deduction and employer contribution. */
  async registerCsv(id: string): Promise<{ fileName: string; content: string }> {
    const run = await this.find(id);
    const rows = await Payslip.findAll({ where: { runId: id, excluded: false }, order: [[this.db.sequelize.literal(`"Payslip"."employee"->>'name'`), 'ASC']] });
    const cols = (pick: (p: Payslip) => PayslipLine[]) => {
      const m = new Map<string, string>();
      for (const p of rows) for (const l of pick(p)) m.set(l.code, l.name);
      return [...m.entries()];
    };
    const earnings = cols((p) => p.earnings);
    const deductions = cols((p) => p.deductions);
    const employer = cols((p) => p.employerContributions);
    const amount = (lines: PayslipLine[], code: string) => lines.find((l) => l.code === code)?.amount ?? 0;
    const header = ['Employee code', 'Name', 'Department', 'Designation', 'Days in month', 'Loss of pay days', 'Payable days', ...earnings.map(([, n]) => n), 'Gross', ...deductions.map(([, n]) => n), 'Total deductions', 'Net pay', ...employer.map(([, n]) => `Employer ${n}`)];
    const lines = rows.map((p) =>
      [
        p.employee.employeeCode,
        p.employee.name,
        p.employee.department,
        p.employee.designation,
        p.daysInMonth,
        Number(p.lopOverride ?? p.lopDays),
        Number(p.payableDays),
        ...earnings.map(([c]) => amount(p.earnings, c)),
        Number(p.gross),
        ...deductions.map(([c]) => amount(p.deductions, c)),
        Number(p.totalDeductions),
        Number(p.netPay),
        ...employer.map(([c]) => amount(p.employerContributions, c)),
      ]
        .map(csvCell)
        .join(','),
    );
    return { fileName: `payroll-register-${run.year}-${String(run.month).padStart(2, '0')}.csv`, content: [header.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n' };
  }

  /** Salary transfer file for the bank (approved runs): account numbers are decrypted, so every export is audited. */
  async bankFileCsv(id: string): Promise<{ fileName: string; content: string; skipped: number }> {
    const run = await this.find(id);
    if (run.status !== 'APPROVED' && run.status !== 'PAID') throw AppError.conflict('The bank file is available once the payroll is approved');
    const payslips = await Payslip.findAll({ where: { runId: id, excluded: false } });
    const employees = new Map(
      (await Employee.findAll({ where: { id: payslips.map((p) => p.employeeId) }, attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'bankAccountEncrypted', 'bankIfsc', 'bankName'] })).map((e) => [e.id, e]),
    );
    const reference = `SALARY ${MONTHS[run.month - 1]!.slice(0, 3).toUpperCase()} ${run.year}`;
    let skipped = 0;
    const lines: string[] = [];
    for (const p of payslips) {
      const e = employees.get(p.employeeId);
      if (!e?.bankAccountEncrypted || !e.bankIfsc || Number(p.netPay) <= 0) {
        skipped++;
        continue;
      }
      lines.push([fullName(e), e.employeeCode, this.crypto.decrypt(e.bankAccountEncrypted), e.bankIfsc, e.bankName ?? '', Number(p.netPay).toFixed(2), reference].map(csvCell).join(','));
    }
    await this.audit.record({ action: 'payroll.bank_file_exported', entityType: 'PayrollRun', entityId: id, summary: `Bank transfer file for ${periodLabel(run.year, run.month)} exported (${lines.length} payments)`, metadata: { payments: lines.length, skipped } });
    const header = ['Beneficiary name', 'Employee code', 'Account number', 'IFSC', 'Bank', 'Amount', 'Narration'].map(csvCell).join(',');
    return { fileName: `bank-transfer-${run.year}-${String(run.month).padStart(2, '0')}.csv`, content: [header, ...lines].join('\r\n') + '\r\n', skipped };
  }

  /** EPFO electronic challan-cum-return (ECR) text file, one member per line, fields separated by #~#. */
  async pfEcr(id: string): Promise<{ fileName: string; content: string; skipped: number }> {
    const run = await this.find(id);
    if (run.status !== 'APPROVED' && run.status !== 'PAID') throw AppError.conflict('The PF return is available once the payroll is approved');
    const payslips = (await Payslip.findAll({ where: { runId: id, excluded: false } })).filter((p) => p.deductions.some((d) => d.code === 'PF'));
    const employees = new Map((await Employee.findAll({ where: { id: payslips.map((p) => p.employeeId) }, attributes: ['id', 'firstName', 'lastName', 'uanEncrypted'] })).map((e) => [e.id, e]));
    let skipped = 0;
    const lines: string[] = [];
    for (const p of payslips) {
      const e = employees.get(p.employeeId);
      if (!e?.uanEncrypted) {
        skipped++;
        continue;
      }
      const s = p.statutory as { pfWage: number; epsWage: number; edliWage: number; salaryGross: number };
      const amount = (code: string, lines: PayslipLine[]) => lines.find((l) => l.code === code)?.amount ?? 0;
      lines.push(
        [
          this.crypto.decrypt(e.uanEncrypted),
          fullName(e).toUpperCase().replace(/#~#/g, ' '),
          Math.round(s.salaryGross),
          Math.round(s.pfWage),
          Math.round(s.epsWage),
          Math.round(s.edliWage),
          amount('PF', p.deductions),
          amount('EPS', p.employerContributions),
          amount('EPF', p.employerContributions),
          Math.round(Number(p.lopOverride ?? p.lopDays)),
          0,
        ].join('#~#'),
      );
    }
    await this.audit.record({ action: 'payroll.pf_ecr_exported', entityType: 'PayrollRun', entityId: id, summary: `PF ECR for ${periodLabel(run.year, run.month)} exported (${lines.length} members)`, metadata: { members: lines.length, skipped } });
    return { fileName: `pf-ecr-${run.year}-${String(run.month).padStart(2, '0')}.txt`, content: lines.join('\n') + (lines.length ? '\n' : ''), skipped };
  }

  // ---- Calculation -----------------------------------------------------------------------------

  private async context(auth: AuthContext, run: PayrollRun): Promise<CalcContext> {
    const { from, to, days } = monthRange(run.year, run.month);
    const [settings, org, today] = await Promise.all([
      this.config.settings(auth.organizationId!),
      Organization.findByPk(auth.organizationId!, { attributes: ['state'] }),
      this.salaries.today(auth.organizationId!),
    ]);
    const attendanceLop = settings.lopFromAttendance && auth.features.has('attendance');
    if (attendanceLop && !(await AttendancePeriod.count({ where: { year: run.year, month: run.month } }))) {
      throw AppError.conflict(`Close attendance for ${periodLabel(run.year, run.month)} first (loss of pay is taken from attendance)`);
    }
    return { run, settings, orgState: org?.state ?? null, from, to, days, today, attendanceLop };
  }

  private async calculateEmployees(auth: AuthContext, ctx: CalcContext, transaction: Transaction, only?: string[]) {
    const { run, from, to, days } = ctx;
    const employees = await Employee.findAll({
      where: {
        dateOfJoining: { [Op.lte]: to },
        [Op.or]: [{ exitDate: null }, { exitDate: { [Op.gte]: from } }],
        ...(only ? { id: only } : {}),
      },
      include: [
        { model: Department, attributes: ['id', 'name'] },
        { model: Designation, attributes: ['id', 'name'] },
        { model: Location, attributes: ['id', 'name', 'state'] },
      ],
      transaction,
    });
    const allSalaries = employees.length
      ? await EmployeeSalary.findAll({ where: { employeeId: employees.map((e) => e.id), effectiveFrom: { [Op.lte]: to } }, order: [['effectiveFrom', 'ASC']], transaction })
      : [];
    const salariesBy = new Map<string, EmployeeSalary[]>();
    for (const s of allSalaries) salariesBy.set(s.employeeId, [...(salariesBy.get(s.employeeId) ?? []), s]);
    const payable = employees.filter((e) => salariesBy.has(e.id));
    const ids = payable.map((e) => e.id);

    const fy = financialYearOf(run.year, run.month);
    const [contexts, holidays, leave, records, existing, adjustments, claims, ytdSlips, esiSlips, declarations, benefits] = await Promise.all([
      this.rules.contexts(auth.organizationId!, payable),
      this.rules.holidays(from, to),
      this.rules.approvedLeave(ids, from, to),
      ctx.attendanceLop && ids.length ? AttendanceRecord.findAll({ where: { employeeId: ids, workDate: { [Op.between]: [from, to] } }, transaction }) : Promise.resolve([] as AttendanceRecord[]),
      Payslip.findAll({ where: { runId: run.id }, transaction }),
      PayrollAdjustment.findAll({ where: { runId: run.id }, order: [['createdAt', 'ASC']], transaction }),
      ids.length
        ? ReimbursementClaim.findAll({ where: { employeeId: ids, status: 'APPROVED', expenseDate: { [Op.lte]: to }, [Op.or]: [{ payrollRunId: null }, { payrollRunId: run.id }] }, transaction })
        : Promise.resolve([] as ReimbursementClaim[]),
      this.priorPayslips(ids, earlierInFinancialYear(run.year, run.month), transaction),
      this.priorPayslips(ids, earlierInContributionPeriod(run.year, run.month), transaction),
      TaxDeclarationRecord.findAll({ where: { employeeId: ids, financialYear: fy }, transaction }),
      // Employee contributions to benefit plans, for every month with at least one day of coverage.
      auth.features.has('benefits') && ids.length
        ? BenefitEnrollment.findAll({
            where: { employeeId: ids, status: ['ACTIVE', 'ENDED'], employeeMonthly: { [Op.gt]: 0 }, effectiveFrom: { [Op.lte]: to }, [Op.or]: [{ effectiveTo: null }, { effectiveTo: { [Op.gte]: from } }] },
            include: [{ model: BenefitPlan, attributes: ['id', 'name'] }],
            order: [['effectiveFrom', 'ASC']],
            transaction,
          })
        : Promise.resolve([] as BenefitEnrollment[]),
    ]);
    const recordsBy = new Map<string, Map<string, AttendanceRecord>>();
    for (const r of records) recordsBy.set(r.employeeId, (recordsBy.get(r.employeeId) ?? new Map()).set(r.workDate, r));
    const existingBy = new Map(existing.map((p) => [p.employeeId, p]));
    const declarationBy = new Map(declarations.map((d) => [d.employeeId, d]));

    const toRemove = only ? existing.filter((p) => only.includes(p.employeeId) && !ids.includes(p.employeeId)) : existing.filter((p) => !ids.includes(p.employeeId));
    if (toRemove.length) await Payslip.destroy({ where: { id: toRemove.map((p) => p.id) }, transaction });

    const claimIdsInRun: string[] = [];
    for (const e of payable) {
      const prior = existingBy.get(e.id);
      const excluded = prior?.excluded ?? false;
      const empClaims = excluded ? [] : claims.filter((c) => c.employeeId === e.id);
      claimIdsInRun.push(...empClaims.map((c) => c.id));
      const values = this.computePayslip(ctx, e, {
        salaries: salariesBy.get(e.id)!,
        context: contexts.get(e.id)!,
        holidays,
        leave: leave.get(e.id),
        records: recordsBy.get(e.id),
        lopOverride: prior?.lopOverride === null || prior?.lopOverride === undefined ? null : Number(prior.lopOverride),
        adjustments: adjustments.filter((a) => a.employeeId === e.id),
        claims: empClaims,
        ytd: ytdSlips.get(e.id) ?? [],
        esiEarlier: esiSlips.get(e.id) ?? [],
        declaration: declarationBy.get(e.id),
        fy,
        benefits: excluded ? [] : latestPerPlan(benefits.filter((b) => b.employeeId === e.id)),
      });
      if (prior) await prior.update(values, { transaction });
      else await Payslip.create({ organizationId: auth.organizationId!, runId: run.id, employeeId: e.id, ...values }, { transaction });
    }

    // Approved claims are paid by this run (unless the employee is held); others go back to the queue.
    const scopeIds = only ?? null;
    await ReimbursementClaim.update(
      { payrollRunId: null },
      { where: { payrollRunId: run.id, status: 'APPROVED', ...(claimIdsInRun.length ? { id: { [Op.notIn]: claimIdsInRun } } : {}), ...(scopeIds ? { employeeId: scopeIds } : {}) }, transaction },
    );
    if (claimIdsInRun.length) await ReimbursementClaim.update({ payrollRunId: run.id }, { where: { id: claimIdsInRun }, transaction });
  }

  private computePayslip(
    ctx: CalcContext,
    e: Employee,
    input: {
      salaries: EmployeeSalary[];
      context: EmployeeContext;
      holidays: Map<string, Holiday>;
      leave: Map<string, DayLeave> | undefined;
      records: Map<string, AttendanceRecord> | undefined;
      lopOverride: number | null;
      adjustments: PayrollAdjustment[];
      claims: ReimbursementClaim[];
      ytd: Payslip[];
      esiEarlier: Payslip[];
      declaration: TaxDeclarationRecord | undefined;
      fy: number;
      benefits: BenefitEnrollment[];
    },
  ) {
    const { run, settings, days, today } = ctx;
    const warnings: string[] = [];
    let missedPunches = 0;
    let unsalariedDays = 0;
    const payDays: PayDay[] = days.map((date) => {
      const employed = date >= e.dateOfJoining && (!e.exitDate || date <= e.exitDate);
      if (!employed) return { date, salary: null, lop: 0 };
      const salary = [...input.salaries].reverse().find((s) => s.effectiveFrom <= date);
      if (!salary) {
        unsalariedDays++;
        return { date, salary: null, lop: 0 };
      }
      const dayLeave = input.leave?.get(date);
      const status = this.rules.dayStatus(date, today, e, input.context, input.holidays.get(date), input.records?.get(date), dayLeave);
      let lop = 0;
      if (status === 'ON_LEAVE' && dayLeave) {
        const half = dayLeave.session !== 'FULL';
        if (!dayLeave.isPaid) lop += half ? 0.5 : 1;
        // With attendance-based LOP, the other half of a half-day leave without any punch is an absence.
        if (ctx.attendanceLop && half && date < today) lop += 0.5;
      } else if (ctx.attendanceLop) {
        if (status === 'ABSENT') lop = 1;
        else if (status === 'HALF_DAY') lop = dayLeave && dayLeave.session !== 'FULL' && dayLeave.isPaid ? 0 : 0.5;
        else if (status === 'MISSED_PUNCH') missedPunches++;
      }
      return { date, salary: salary.components as SalaryComponent[], lop: Math.min(1, lop) };
    });
    const salariedDays = payDays.filter((d) => d.salary).length;
    const employedDays = salariedDays + unsalariedDays;
    const lopDays = sum(payDays.map((d) => (d.salary ? d.lop : 0)));
    const lopOverride = input.lopOverride === null ? null : Math.min(input.lopOverride, salariedDays);
    const earned = earnedComponents(payDays, days.length, lopOverride);
    const latest = input.salaries[input.salaries.length - 1]!;
    if (unsalariedDays) warnings.push(`No salary for ${unsalariedDays} day${unsalariedDays === 1 ? '' : 's'} of employment this month`);
    if (missedPunches) warnings.push(`${missedPunches} missed punch${missedPunches === 1 ? '' : 'es'} counted as worked`);

    // Earnings
    const earningAdjustments = input.adjustments.filter((a) => a.kind === 'EARNING');
    const reimbursements = sum(input.claims.map((c) => Number(c.amount)));
    const earnings: PayslipLine[] = [
      ...earned.filter((c) => c.amount > 0 || c.rate > 0).map((c) => ({ code: c.code, name: c.name, amount: c.amount, rate: c.rate, taxable: c.taxable })),
      ...earningAdjustments.map((a) => ({ code: `ADJ_${a.id.slice(0, 8)}`, name: a.label, amount: Number(a.amount), taxable: a.taxable })),
      ...(reimbursements > 0 ? [{ code: 'REIMBURSEMENT', name: `Reimbursements (${input.claims.length})`, amount: reimbursements, taxable: false }] : []),
    ];
    const salaryGross = sum(earned.map((c) => c.amount)) + sum(earningAdjustments.map((a) => Number(a.amount)));

    // PF
    const age = ageOn(e.dateOfBirth, ctx.from);
    const pfWageEarned = sum(earned.filter((c) => c.pfWage).map((c) => c.amount));
    const pfOn = settings.pfEnabled && latest.pfApplicable;
    const pf = pfOn ? pfContribution(pfWageEarned, { restrictToCeiling: settings.pfRestrictToCeiling, age }) : null;
    if (pfOn && !e.uanEncrypted) warnings.push('No UAN recorded (needed for the PF return)');

    // ESI
    const grossRate = Number(latest.monthlyGross);
    const coveredEarlier = input.esiEarlier.length ? input.esiEarlier.some((p) => (p.statutory as { esiCovered?: boolean }).esiCovered) : null;
    const covered = esiCovered({ enabled: settings.esiEnabled, grossRate, month: run.month, coveredEarlierInPeriod: coveredEarlier });
    const esiWage = sum(earned.filter((c) => c.esiWage).map((c) => c.amount));
    const esi = covered ? esiContribution(esiWage) : { employee: 0, employer: 0 };

    // Professional tax
    const ptState: ProfessionalTaxState | null = settings.ptEnabled ? (professionalTaxState(e.location?.state) ?? professionalTaxState(settings.ptState) ?? professionalTaxState(ctx.orgState)) : null;
    const pt = professionalTax(ptState, salaryGross, e.gender ?? null, run.month);

    // TDS
    const d = input.declaration;
    const declaration = {
      regime: d?.regime ?? 'NEW',
      rentPaidAnnual: Number(d?.rentPaidAnnual ?? 0),
      metroCity: d?.metroCity ?? false,
      section80c: Number(d?.section80c ?? 0),
      section80ccd1b: Number(d?.section80ccd1b ?? 0),
      section80d: Number(d?.section80d ?? 0),
      homeLoanInterest: Number(d?.homeLoanInterest ?? 0),
      previousEmployerIncome: Number(d?.previousEmployerIncome ?? 0),
      previousEmployerTds: Number(d?.previousEmployerTds ?? 0),
    } as const;
    const byRole = (role: 'BASIC' | 'HRA', field: 'amount' | 'rate') => sum(earned.filter((c) => c.role === role).map((c) => c[field]));
    const current: TaxFigures = {
      taxable: sum(earned.filter((c) => c.taxable).map((c) => c.amount)) + sum(earningAdjustments.filter((a) => a.taxable).map((a) => Number(a.amount))),
      basic: byRole('BASIC', 'amount'),
      hra: byRole('HRA', 'amount'),
      employeePf: pf?.employee ?? 0,
      professionalTax: pt,
    };
    const rateGross = sum(earned.map((c) => c.rate));
    const recurring: TaxFigures = {
      taxable: sum(earned.filter((c) => c.taxable).map((c) => c.rate)),
      basic: byRole('BASIC', 'rate'),
      hra: byRole('HRA', 'rate'),
      employeePf: pfOn ? pfContribution(sum(earned.filter((c) => c.pfWage).map((c) => c.rate)), { restrictToCeiling: settings.pfRestrictToCeiling, age }).employee : 0,
      professionalTax: professionalTax(ptState, rateGross, e.gender ?? null, 1),
    };
    const ytdFigures = input.ytd.reduce(
      (acc, p) => {
        const f = (p.tax as { figures?: TaxFigures; thisMonth?: number } | null) ?? {};
        return {
          taxable: acc.taxable + (f.figures?.taxable ?? 0),
          basic: acc.basic + (f.figures?.basic ?? 0),
          hra: acc.hra + (f.figures?.hra ?? 0),
          employeePf: acc.employeePf + (f.figures?.employeePf ?? 0),
          professionalTax: acc.professionalTax + (f.figures?.professionalTax ?? 0),
          tds: acc.tds + (p.deductions.find((l) => l.code === 'TDS')?.amount ?? 0),
        };
      },
      { taxable: 0, basic: 0, hra: 0, employeePf: 0, professionalTax: 0, tds: 0 },
    );
    const fyMonth = run.month >= 4 ? run.month - 3 : run.month + 9;
    let remainingMonths = 12 - fyMonth;
    if (e.exitDate) {
      const [ey, em] = e.exitDate.split('-').map(Number) as [number, number];
      const exitIndex = financialYearOf(ey, em) === input.fy ? (em >= 4 ? em - 3 : em + 9) : financialYearOf(ey, em) < input.fy ? 0 : 12;
      remainingMonths = Math.max(0, Math.min(remainingMonths, exitIndex - fyMonth));
    }
    let tax: ReturnType<typeof monthlyTds> | null = null;
    let tds = 0;
    try {
      tax = monthlyTds({ fy: input.fy, age: ageOn(e.dateOfBirth, `${input.fy + 1}-03-31`), declaration, ytd: ytdFigures, current, recurring, remainingMonths });
      tds = tax.thisMonth;
      if (!e.panEncrypted && tax.tax.total > 0) {
        tds = Math.max(tds, Math.round(current.taxable * 0.2));
        warnings.push('No PAN recorded: tax deducted at 20% (section 206AA)');
      }
    } catch (err) {
      warnings.push(`! Income tax could not be worked out: ${(err as Error).message}`);
    }

    // Deductions & employer contributions
    const deductionAdjustments = input.adjustments.filter((a) => a.kind === 'DEDUCTION');
    const deductions: PayslipLine[] = [
      ...(pf ? [{ code: 'PF', name: 'Provident fund', amount: pf.employee }] : []),
      ...(esi.employee ? [{ code: 'ESI', name: 'Employee state insurance', amount: esi.employee }] : []),
      ...(pt ? [{ code: 'PT', name: `Professional tax (${ptState!.name})`, amount: pt }] : []),
      ...(tds ? [{ code: 'TDS', name: 'Income tax (TDS)', amount: tds }] : []),
      ...deductionAdjustments.map((a) => ({ code: `ADJ_${a.id.slice(0, 8)}`, name: a.label, amount: Number(a.amount) })),
      ...input.benefits.map((b) => ({ code: `BEN_${b.planId.slice(0, 8)}`, name: `${b.plan?.name ?? 'Benefit'} (${b.optionName})`, amount: Number(b.employeeMonthly) })),
    ];
    const employerContributions: PayslipLine[] = [
      ...(pf ? [{ code: 'EPF', name: 'Employer PF', amount: pf.employerEpf }, { code: 'EPS', name: 'Employer pension (EPS)', amount: pf.employerEps }] : []),
      ...(esi.employer ? [{ code: 'ESI_ER', name: 'Employer ESI', amount: esi.employer }] : []),
    ];
    const gross = sum(earnings.map((l) => l.amount));
    const totalDeductions = sum(deductions.map((l) => l.amount));
    const net = gross - totalDeductions;
    if (net < 0) warnings.push('! Deductions are more than the earnings');
    if (!e.bankAccountEncrypted || !e.bankIfsc) warnings.push('No bank account recorded (not included in the bank file)');

    const pan = e.panEncrypted ? this.crypto.decrypt(e.panEncrypted) : null;
    const uan = e.uanEncrypted ? this.crypto.decrypt(e.uanEncrypted) : null;
    return {
      employee: {
        name: fullName(e),
        employeeCode: e.employeeCode,
        designation: e.designation?.name ?? null,
        department: e.department?.name ?? null,
        location: e.location?.name ?? null,
        dateOfJoining: e.dateOfJoining,
        exitDate: e.exitDate,
        pan: pan ? `${pan.slice(0, 2)}•••${pan.slice(5)}` : null,
        uan: mask(uan),
        bank: e.bankAccountLast4 ? { name: e.bankName, accountLast4: e.bankAccountLast4, ifsc: e.bankIfsc } : null,
      },
      daysInMonth: days.length,
      employedDays: String(employedDays),
      lopDays: String(lopDays),
      payableDays: String(Math.max(0, salariedDays - (lopOverride ?? lopDays))),
      earnings,
      deductions,
      employerContributions,
      gross: String(gross),
      totalDeductions: String(totalDeductions),
      netPay: String(net),
      statutory: {
        salaryGross,
        pfApplicable: pfOn,
        pfWage: pf?.pfWage ?? 0,
        epsWage: pf?.epsWage ?? 0,
        edliWage: pf?.edliWage ?? 0,
        esiCovered: covered,
        esiWage: covered ? esiWage : 0,
        ptState: ptState?.code ?? null,
        reimbursementClaims: input.claims.map((c) => c.id),
        benefitEnrollments: input.benefits.map((b) => b.id),
      },
      tax: tax ? { ...tax, figures: current, thisMonth: tds } : null,
      warnings,
    };
  }

  private async priorPayslips(employeeIds: string[], periods: { year: number; month: number }[], transaction: Transaction): Promise<Map<string, Payslip[]>> {
    const out = new Map<string, Payslip[]>();
    if (!employeeIds.length || !periods.length) return out;
    const rows = await Payslip.findAll({
      where: { employeeId: employeeIds, excluded: false },
      include: [{ model: PayrollRun, where: { status: ['APPROVED', 'PAID'], ...periodWhere(periods) }, attributes: ['id', 'year', 'month'] }],
      transaction,
    });
    for (const p of rows) out.set(p.employeeId, [...(out.get(p.employeeId) ?? []), p]);
    return out;
  }

  private async refreshTotals(run: PayrollRun, transaction: Transaction) {
    const slips = await Payslip.findAll({ where: { runId: run.id, excluded: false }, attributes: ['gross', 'totalDeductions', 'netPay', 'employerContributions', 'warnings'], transaction });
    await run.update(
      {
        employeeCount: slips.length,
        totalGross: String(sum(slips.map((p) => Number(p.gross)))),
        totalDeductions: String(sum(slips.map((p) => Number(p.totalDeductions)))),
        totalNet: String(sum(slips.map((p) => Number(p.netPay)))),
        totalEmployerContributions: String(sum(slips.map((p) => sum(p.employerContributions.map((l) => l.amount))))),
        warningCount: slips.filter((p) => p.warnings.length).length,
      },
      { transaction },
    );
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  private async find(id: string): Promise<PayrollRun> {
    const run = await PayrollRun.findByPk(id);
    if (!run) throw AppError.notFound('Payroll run');
    return run;
  }

  private async assertDraft(runId: string) {
    const run = await this.find(runId);
    if (run.status !== 'DRAFT') throw AppError.conflict('Payslips can only be changed while the payroll run is a draft');
  }

  /** Active employees in the period without any salary (they are left out of the run). */
  private async missingSalary(from: string, to: string) {
    const withSalary = (await EmployeeSalary.findAll({ where: { effectiveFrom: { [Op.lte]: to } }, attributes: ['employeeId'], group: ['employeeId'], raw: true })).map((r) => r.employeeId);
    const rows = await Employee.findAll({
      where: { dateOfJoining: { [Op.lte]: to }, [Op.or]: [{ exitDate: null }, { exitDate: { [Op.gte]: from } }], ...(withSalary.length ? { id: { [Op.notIn]: withSalary } } : {}) },
      attributes: ['id', 'employeeCode', 'firstName', 'lastName'],
      order: [['firstName', 'ASC']],
      limit: 50,
    });
    return rows.map((e) => ({ id: e.id, employeeCode: e.employeeCode, name: fullName(e) }));
  }

  private presentRun(r: PayrollRun, names: Map<string, string>) {
    const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
    return {
      id: r.id,
      year: r.year,
      month: r.month,
      period: periodLabel(r.year, r.month),
      status: r.status,
      employeeCount: r.employeeCount,
      totalGross: Number(r.totalGross),
      totalDeductions: Number(r.totalDeductions),
      totalNet: Number(r.totalNet),
      totalEmployerContributions: Number(r.totalEmployerContributions),
      warningCount: r.warningCount,
      calculatedAt: r.calculatedAt,
      calculatedBy: name(r.calculatedById),
      submittedAt: r.submittedAt,
      submittedBy: name(r.submittedById),
      reviewedAt: r.reviewedAt,
      reviewedBy: name(r.reviewedById),
      reviewNote: r.reviewNote,
      paidAt: r.paidAt,
      paidBy: name(r.paidById),
      paymentReference: r.paymentReference,
      createdAt: r.createdAt,
    };
  }

  private presentPayslip(p: Payslip, run: PayrollRun | null, detail: boolean) {
    return {
      id: p.id,
      runId: p.runId,
      employeeId: p.employeeId,
      employee: p.employee,
      ...(run ? { period: periodLabel(run.year, run.month), year: run.year, month: run.month, runStatus: run.status } : {}),
      daysInMonth: p.daysInMonth,
      employedDays: Number(p.employedDays),
      lopDays: Number(p.lopDays),
      lopOverride: p.lopOverride === null ? null : Number(p.lopOverride),
      payableDays: Number(p.payableDays),
      gross: Number(p.gross),
      totalDeductions: Number(p.totalDeductions),
      netPay: Number(p.netPay),
      excluded: p.excluded,
      excludeReason: p.excludeReason,
      warnings: p.warnings,
      ...(detail
        ? { earnings: p.earnings, deductions: p.deductions, employerContributions: p.employerContributions, statutory: p.statutory, tax: p.tax }
        : {}),
    };
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }

  private async userIdsOfEmployees(employeeIds: string[], transaction?: Transaction): Promise<Map<string, string>> {
    if (!employeeIds.length) return new Map();
    const employees = await Employee.findAll({ where: { id: employeeIds, membershipId: { [Op.ne]: null } }, attributes: ['id', 'membershipId'], transaction });
    const memberships = await OrganizationMembership.findAll({ where: { id: employees.map((e) => e.membershipId!), status: 'ACTIVE' }, attributes: ['id', 'userId'], transaction });
    const userBy = new Map(memberships.map((m) => [m.id, m.userId]));
    return new Map(employees.filter((e) => userBy.has(e.membershipId!)).map((e) => [e.id, userBy.get(e.membershipId!)!]));
  }

  /** Active members whose roles grant the permission. */
  private async usersWithPermission(key: string, transaction?: Transaction): Promise<string[]> {
    const permission = await Permission.findOne({ where: { key }, attributes: ['id'], transaction });
    if (!permission) return [];
    const roleIds = (await RolePermission.findAll({ where: { permissionId: permission.id }, attributes: ['roleId'], transaction })).map((r) => r.roleId);
    if (!roleIds.length) return [];
    const membershipIds = (await MembershipRole.findAll({ where: { roleId: roleIds }, attributes: ['membershipId'], transaction })).map((m) => m.membershipId);
    if (!membershipIds.length) return [];
    const members = await OrganizationMembership.findAll({ where: { id: membershipIds, status: 'ACTIVE' }, attributes: ['userId'], transaction });
    return [...new Set(members.map((m) => m.userId))];
  }
}
