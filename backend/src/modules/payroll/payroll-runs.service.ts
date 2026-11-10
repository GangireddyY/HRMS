import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Op, UniqueConstraintError, type Transaction, type WhereOptions } from 'sequelize';
import {
  ADJUSTMENT_CATEGORY_LABELS,
  ARREARS_MAX_MONTHS,
  BANK_FILE_FORMAT_LABELS,
  type BankFileFormat,
  OVERTIME_HOURLY_DIVISOR,
  STATUTORY_BONUS,
  TIMESHEET_HOLD_REASON,
  financialYearOf,
  labourWelfareState,
  professionalTaxState,
  weekStartOf,
  type ProfessionalTaxState,
  type TaxProofSection,
  type TimesheetStatus,
} from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { csvCell } from '../../common/utils/csv';
import { containsPattern } from '../../common/utils/like';
import { monthRange } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import {
  AttendanceOvertime,
  AttendancePeriod,
  BankDetailChange,
  AttendanceRecord,
  BenefitEnrollment,
  BenefitPlan,
  Department,
  Designation,
  Employee,
  EmployeeLoanRepayment,
  EmployeeSalary,
  LeaveEncashment,
  LeaveType,
  Location,
  MembershipRole,
  PayGroup,
  Organization,
  OrganizationMembership,
  PayrollAdjustment,
  PayrollRun,
  Payslip,
  Permission,
  ReimbursementClaim,
  RolePermission,
  TaxDeclarationProof,
  TaxDeclarationRecord,
  Timesheet,
  User,
  type PayslipLine,
} from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { ctx as fields } from '../../infrastructure/crypto/encrypted-fields';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import { JobQueueService } from '../../infrastructure/jobs/job-queue.service';
import { MailService } from '../../infrastructure/mail/mail.service';
import { payslipEmail } from '../../infrastructure/mail/templates';
import { inSequence } from '../../common/utils/in-sequence';
import { AttendanceRulesService, type DayLeave, type EmployeeContext, type HolidayCalendar } from '../attendance/attendance-rules.service';
import { timesheetGaps, weeksPhrase, type TimesheetGaps, type TimesheetRules } from '../attendance/timesheet-rules';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { dailyRate } from '../exit/exit-rules';
import { NotificationsService } from '../notifications/notifications.service';
import type { AdjustmentDto, BonusPayoutDto, CreateRunDto, PayRunDto, RejectRunDto, ReviewRunDto, RunPayslipQueryDto, RunQueryDto, UpdatePayslipDto } from './dto/payroll.dto';
import { arrearsFor, monthKey, type ArrearAmounts, type ArrearMonth } from './arrears';
import { closeRepaidLoans, dueInstalments, type DueInstalment } from './loan-balances';
import { PayrollConfigService, type EffectiveSettings } from './payroll-config.service';
import {
  ageOn,
  earnedComponents,
  esiContribution,
  esiCovered,
  labourWelfareFund,
  monthlyTds,
  pfContribution,
  professionalTax,
  type PayDay,
  type SalaryComponent,
  type TaxFigures,
} from './payroll-engine';
import { bankCsv, type BankPayment } from './bank-layouts';
import { payslipPdf, type PayslipPdfInput } from './payslip-pdf';
import { SalariesService } from './salaries.service';
import { fullName } from '../../common/utils/names';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const periodLabel = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mask = (v: string | null, keep = 4) => (v ? `${'•'.repeat(Math.max(0, v.length - keep))}${v.slice(-keep)}` : null);


/** Months of the ESI contribution period (April–September / October–March) before this one. */
/** Accepted proofs per section (Form 12BB). */
export type VerifiedDeductions = Record<TaxProofSection, number>;

/** Position of a calendar month in the financial year (April = 1 … March = 12). */
export const fyMonthIndex = (month: number) => (month >= 4 ? month - 3 : month + 9);

/** Whether tax for a run month uses accepted proofs only (from the cut-off month to March). */
export function proofsApply(proofsFromMonth: number | null | undefined, month: number): boolean {
  return !!proofsFromMonth && fyMonthIndex(month) >= fyMonthIndex(proofsFromMonth);
}

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

/**
 * One contribution per benefit plan and month: when coverage changed during the month, the latest enrolment's. A
 * renewed plan counts as the same plan as the one it renews (no double charge in the month the policy rolls over).
 */
function latestPerPlan(enrollments: BenefitEnrollment[]): BenefitEnrollment[] {
  const by = new Map<string, BenefitEnrollment>();
  for (const e of enrollments) {
    const key = e.plan?.renewedFromId ?? e.planId;
    const prior = by.get(key);
    if (!prior || (e.effectiveFrom ?? '') >= (prior.effectiveFrom ?? '')) by.set(key, e);
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
  /** Timesheet rules when the organization requires timesheets (and uses attendance). */
  timesheets: TimesheetRules | null;
}

const PAYSLIP_EMAIL_JOB = 'payroll.payslip_email';

/** Payroll runs: calculation, review workflow (process → approve → pay), payslips and statutory exports. */
@Injectable()
export class PayrollRunsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly config: PayrollConfigService,
    private readonly salaries: SalariesService,
    private readonly rules: AttendanceRulesService,
    private readonly notifications: NotificationsService,
    private readonly crypto: EncryptionService,
    private readonly jobs: JobQueueService,
    private readonly mail: MailService,
  ) {}

  onModuleInit(): void {
    this.jobs.register<{ payslipId: string }>(PAYSLIP_EMAIL_JOB, (payload) => this.emailPayslip(payload));
  }

  // ---- Runs ------------------------------------------------------------------------------------

  async list(query: RunQueryDto) {
    const where: WhereOptions = { ...(query.year ? { year: query.year } : {}), ...(query.status ? { status: query.status } : {}) };
    const { rows, count } = await PayrollRun.findAndCountAll({
      where,
      order: [
        ['year', 'DESC'],
        ['month', 'DESC'],
        ['createdAt', 'DESC'],
      ],
      ...paginationArgs(query),
    });
    const names = await this.userNames(rows.flatMap((r) => [r.calculatedById, r.submittedById, r.reviewedById, r.paidById]));
    const groups = await this.groupNames(rows);
    return new PaginatedResult(
      rows.map((r) => this.presentRun(r, names, groups)),
      paginationMeta(query, count),
    );
  }

  async create(auth: AuthContext, dto: CreateRunDto) {
    const today = await this.salaries.today(auth.organizationId!);
    const { from } = monthRange(dto.year, dto.month);
    if (from > today) throw AppError.validation([{ field: 'month', message: 'Payroll can be run for the current month or earlier' }]);
    const payGroupId = dto.payGroupId ?? null;
    const group = payGroupId ? await PayGroup.findByPk(payGroupId) : null;
    if (payGroupId && (!group || !group.isActive)) throw AppError.validation([{ field: 'payGroupId', message: 'Choose an active pay group' }]);
    const of = group ? ` (${group.name})` : '';
    const open = await PayrollRun.findOne({ where: { status: ['DRAFT', 'SUBMITTED'], payGroupId } });
    if (open) throw AppError.conflict(`Payroll for ${periodLabel(open.year, open.month)}${of} is still in progress. Finish or cancel it first.`);
    const latest = await PayrollRun.findOne({
      where: { status: ['APPROVED', 'PAID'], payGroupId },
      order: [
        ['year', 'DESC'],
        ['month', 'DESC'],
      ],
    });
    if (latest && dto.year * 12 + dto.month <= latest.year * 12 + latest.month) {
      throw AppError.validation([{ field: 'month', message: `Payroll${of} is already processed up to ${periodLabel(latest.year, latest.month)}` }]);
    }
    let run: PayrollRun;
    try {
      run = await PayrollRun.create({ organizationId: auth.organizationId!, year: dto.year, month: dto.month, payGroupId, notes: dto.notes ?? null, createdById: auth.userId });
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict(`A payroll run for ${periodLabel(dto.year, dto.month)}${of} already exists`);
      throw e;
    }
    await this.audit.record({ action: 'payroll.run_created', entityType: 'PayrollRun', entityId: run.id, summary: `Payroll run for ${periodLabel(run.year, run.month)}${of} created` });
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
      ...this.presentRun(run, names, await this.groupNames([run])),
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
        await this.audit.record(
          { action: 'payroll.run_calculated', entityType: 'PayrollRun', entityId: id, summary: `Payroll for ${periodLabel(run.year, run.month)} calculated (${run.employeeCount} employees)` },
          transaction,
        );
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
      await this.audit.record(
        { action: 'payroll.run_submitted', entityType: 'PayrollRun', entityId: id, summary: `Payroll for ${periodLabel(run.year, run.month)} submitted for approval` },
        transaction,
      );
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
      await this.audit.record(
        {
          action: 'payroll.run_approved',
          entityType: 'PayrollRun',
          entityId: id,
          summary: `Payroll for ${periodLabel(run.year, run.month)} approved`,
          metadata: { totalNet: Number(run.totalNet), employees: run.employeeCount },
        },
        transaction,
      );
      const payslips = await Payslip.findAll({ where: { runId: id, excluded: false }, attributes: ['id', 'employeeId', 'statutory'], transaction });
      // Loan instalments deducted by this run are now repaid.
      const { to } = monthRange(run.year, run.month);
      const instalments = payslips.flatMap((p) => (p.statutory as { loans?: { loanId: string; principal: number; interest: number }[] }).loans ?? []);
      if (instalments.length) {
        await EmployeeLoanRepayment.bulkCreate(
          instalments.map((i) => ({
            organizationId: run.organizationId,
            loanId: i.loanId,
            source: 'PAYROLL' as const,
            payrollRunId: run.id,
            paidOn: to,
            principal: String(i.principal),
            interest: String(i.interest),
            createdById: auth.userId,
          })),
          { transaction },
        );
        const closed = await closeRepaidLoans([...new Set(instalments.map((i) => i.loanId))], transaction);
        if (closed.length)
          await this.audit.record(
            { action: 'payroll.loans_closed', entityType: 'PayrollRun', entityId: id, summary: `Fully repaid with ${periodLabel(run.year, run.month)} payroll: ${closed.join(', ')}` },
            transaction,
          );
      }
      // Overtime paid by this run.
      const overtimeIds = payslips.flatMap((p) => (p.statutory as { overtime?: string[] }).overtime ?? []);
      if (overtimeIds.length) await AttendanceOvertime.update({ payrollRunId: run.id }, { where: { id: overtimeIds, status: 'APPROVED', payrollRunId: null }, transaction });
      // Leave encashments paid by this run.
      const paidAt = new Date();
      for (const x of payslips.flatMap((p) => (p.statutory as { encashments?: { id: string; amount: number }[] }).encashments ?? [])) {
        await LeaveEncashment.update({ status: 'PAID', amount: String(x.amount), paidAt, payrollRunId: run.id }, { where: { id: x.id, status: 'APPROVED' }, transaction });
      }
      const users = await this.userIdsOfEmployees(
        payslips.map((p) => p.employeeId),
        transaction,
      );
      for (const p of payslips) {
        const userId = users.get(p.employeeId);
        if (userId)
          await this.notifications.notify(
            userId,
            { organizationId: auth.organizationId, type: 'payroll.payslip', title: `Your payslip for ${periodLabel(run.year, run.month)} is ready`, link: `/me/payslips/${p.id}` },
            transaction,
          );
      }
      if (run.submittedById) {
        await this.notifications.notify(
          run.submittedById,
          { organizationId: auth.organizationId, type: 'payroll.run', title: `Payroll for ${periodLabel(run.year, run.month)} was approved`, link: `/hr/payroll/runs/${id}` },
          transaction,
        );
      }
      if ((await this.config.settings(run.organizationId)).payslipEmailEnabled) {
        for (const p of payslips) await this.jobs.enqueue(PAYSLIP_EMAIL_JOB, { payslipId: p.id }, { transaction, organizationId: run.organizationId, maxAttempts: 4 });
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
      await this.audit.record(
        { action: 'payroll.run_rejected', entityType: 'PayrollRun', entityId: id, summary: `Payroll for ${periodLabel(run.year, run.month)} sent back: ${dto.note}` },
        transaction,
      );
      if (run.submittedById) {
        await this.notifications.notify(
          run.submittedById,
          { organizationId: auth.organizationId, type: 'payroll.run', title: `Payroll for ${periodLabel(run.year, run.month)} was sent back`, body: dto.note, link: `/hr/payroll/runs/${id}` },
          transaction,
        );
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
      await this.audit.record(
        { action: 'payroll.run_paid', entityType: 'PayrollRun', entityId: id, summary: `Payroll for ${periodLabel(run.year, run.month)} marked as paid (${dto.paymentReference})` },
        transaction,
      );
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
      await LeaveEncashment.update({ payrollRunId: null, amount: null }, { where: { payrollRunId: id, status: 'APPROVED' }, transaction });
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
    return new PaginatedResult(
      rows.map((p) => this.presentPayslip(p, null, false)),
      paginationMeta(query, count),
    );
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
      category: dto.kind === 'EARNING' ? (dto.category ?? 'OTHER') : 'OTHER',
      createdById: auth.userId,
    });
    await this.audit.record({
      action: 'payroll.adjustment_added',
      entityType: 'Payslip',
      entityId: p.id,
      summary: `${String(p.employee.employeeCode)}: ${dto.kind === 'EARNING' ? 'earning' : 'deduction'} "${dto.label}" added`,
    });
    await this.calculate(auth, runId, [dto.employeeId]);
    return this.payslip(auth, p.id);
  }

  /**
   * A bonus or incentive for many people at once: a fixed amount, a percentage of the monthly Basic or gross, or the
   * statutory bonus (Payment of Bonus Act: for Basic up to ₹21,000 a month, the rate × min(Basic, ₹7,000) for each month
   * worked in the financial year so far). Each becomes a one-off earning on the payslip.
   */
  async addBonus(auth: AuthContext, runId: string, dto: BonusPayoutDto) {
    const run = await this.find(runId);
    await this.assertDraft(runId);
    if (dto.basis === 'STATUTORY' && (dto.value < STATUTORY_BONUS.minRate || dto.value > STATUTORY_BONUS.maxRate)) {
      throw AppError.validation([{ field: 'value', message: `The statutory bonus rate is between ${STATUTORY_BONUS.minRate}% and ${STATUTORY_BONUS.maxRate}%` }]);
    }
    if (dto.basis !== 'FIXED' && dto.basis !== 'STATUTORY' && dto.value > 1000) throw AppError.validation([{ field: 'value', message: 'Enter a percentage up to 1000' }]);
    const payslips = await Payslip.findAll({ where: { runId, ...(dto.employeeIds?.length ? { employeeId: dto.employeeIds } : {}) }, attributes: ['employeeId', 'excluded'] });
    if (dto.employeeIds?.length && payslips.length !== new Set(dto.employeeIds).size) throw AppError.validation([{ field: 'employeeIds', message: 'Some of these people are not part of this payroll run' }]);
    const { to } = monthRange(run.year, run.month);
    const ids = payslips.map((p) => p.employeeId);
    const [employees, salaries] = await Promise.all([
      Employee.findAll({ where: { id: ids }, attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'dateOfJoining'] }),
      EmployeeSalary.findAll({ where: { employeeId: ids, effectiveFrom: { [Op.lte]: to } }, order: [['effectiveFrom', 'ASC']] }),
    ]);
    const latest = new Map<string, EmployeeSalary>();
    for (const s of salaries) latest.set(s.employeeId, s);
    const fyStartYear = run.month >= 4 ? run.year : run.year - 1;
    const added: { employeeId: string; amount: number }[] = [];
    const skipped: { employee: string; reason: string }[] = [];
    for (const e of employees) {
      const s = latest.get(e.id);
      const basic = s ? sum((s.components as SalaryComponent[]).filter((c) => c.role === 'BASIC').map((c) => c.monthly)) : 0;
      let amount = 0;
      if (dto.basis === 'FIXED') amount = dto.value;
      else if (dto.basis === 'PERCENT_OF_BASIC') amount = (basic * dto.value) / 100;
      else if (dto.basis === 'PERCENT_OF_GROSS') amount = (Number(s?.monthlyGross ?? 0) * dto.value) / 100;
      else {
        if (basic > STATUTORY_BONUS.eligibleUpTo) {
          skipped.push({ employee: fullName(e), reason: `Basic above ₹${STATUTORY_BONUS.eligibleUpTo.toLocaleString('en-IN')} a month` });
          continue;
        }
        const [jy, jm] = e.dateOfJoining.split('-').map(Number) as [number, number];
        const startIndex = Math.max(fyStartYear * 12 + 3, jy * 12 + (jm - 1));
        const months = Math.max(0, run.year * 12 + (run.month - 1) - startIndex + 1);
        amount = ((Math.min(basic, STATUTORY_BONUS.calculationCeiling) * dto.value) / 100) * months;
      }
      amount = Math.round(amount);
      if (amount < 1) {
        skipped.push({ employee: fullName(e), reason: s ? 'Works out to nothing' : 'No salary' });
        continue;
      }
      added.push({ employeeId: e.id, amount });
    }
    if (added.length) {
      await this.db.transaction(async (transaction) => {
        await PayrollAdjustment.bulkCreate(
          added.map((a) => ({ organizationId: auth.organizationId!, runId, employeeId: a.employeeId, kind: 'EARNING' as const, label: dto.label, amount: String(a.amount), taxable: dto.taxable ?? true, category: dto.category, createdById: auth.userId })),
          { transaction },
        );
        await this.audit.record(
          {
            action: 'payroll.bonus_added',
            entityType: 'PayrollRun',
            entityId: runId,
            summary: `${ADJUSTMENT_CATEGORY_LABELS[dto.category]} "${dto.label}" for ${added.length} employee${added.length === 1 ? '' : 's'} (₹${sum(added.map((a) => a.amount)).toLocaleString('en-IN')})`,
            metadata: { basis: dto.basis, value: dto.value, employees: added.length },
          },
          transaction,
        );
      });
      await this.calculate(auth, runId, added.map((a) => a.employeeId));
    }
    return { added: added.length, total: sum(added.map((a) => a.amount)), skipped, held: payslips.filter((p) => p.excluded && added.some((a) => a.employeeId === p.employeeId)).length };
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

  /** The payslip as a PDF (same access as the payslip). */
  async payslipPdfFile(auth: AuthContext, id: string): Promise<{ fileName: string; data: Buffer }> {
    const p = await this.payslip(auth, id);
    const employee = p.employee as { name: string; employeeCode: string };
    return { fileName: `payslip-${p.year}-${String(p.month).padStart(2, '0')}-${employee.employeeCode}.pdf`, data: await payslipPdf(this.pdfInput(p, p.organization)) };
  }

  /** Background job: emails one payslip PDF to the employee (password-protected per payroll setup). */
  private async emailPayslip(payload: { payslipId: string }): Promise<void> {
    const p = await Payslip.findByPk(payload.payslipId, { include: [{ model: PayrollRun }] });
    if (!p || p.excluded || !p.run || !['APPROVED', 'PAID'].includes(p.run.status)) return;
    const employee = await Employee.findByPk(p.employeeId, { attributes: ['id', 'firstName', 'lastName', 'dateOfBirth', 'membershipId', 'employeeCode'] });
    if (!employee) return;
    const userId = (await this.userIdsOfEmployees([employee.id])).get(employee.id);
    const user = userId ? await User.findByPk(userId, { attributes: ['email', 'status'] }) : null;
    if (!user?.email || user.status !== 'ACTIVE') return;
    const [settings, org] = await Promise.all([
      this.config.settings(p.organizationId),
      Organization.findByPk(p.organizationId, { attributes: ['name', 'legalName', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode'] }),
    ]);
    const dob = settings.payslipPdfPassword === 'DOB' && employee.dateOfBirth ? `${employee.dateOfBirth.slice(8, 10)}${employee.dateOfBirth.slice(5, 7)}${employee.dateOfBirth.slice(0, 4)}` : undefined;
    const orgName = org ? org.legalName || org.name : '';
    const presented = { ...this.presentPayslip(p, p.run, true), organization: org ? { name: orgName, address: [org.addressLine1, org.addressLine2, org.city, org.state, org.postalCode].filter(Boolean).join(', ') || null } : null };
    const pdf = await payslipPdf(this.pdfInput(presented, presented.organization), { password: dob });
    const period = periodLabel(p.run.year, p.run.month);
    await this.mail.send(
      payslipEmail(user.email, employee.firstName, orgName, period, `₹${Number(p.netPay).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, dob ? 'your date of birth (DDMMYYYY)' : null, {
        filename: `payslip-${p.run.year}-${String(p.run.month).padStart(2, '0')}.pdf`,
        content: pdf.toString('base64'),
      }),
    );
  }

  private pdfInput(p: ReturnType<PayrollRunsService['presentPayslip']>, organization: { name: string; address: string | null } | null): PayslipPdfInput {
    const e = p.employee as PayslipPdfInput['employee'];
    return {
      organization,
      period: p.period ?? '',
      employee: e,
      daysInMonth: p.daysInMonth,
      payableDays: p.payableDays,
      lopDays: p.lopOverride ?? p.lopDays,
      earnings: (p.earnings ?? []).filter((l) => l.amount),
      deductions: (p.deductions ?? []).filter((l) => l.amount),
      employerContributions: (p.employerContributions ?? []).filter((l) => l.amount),
      gross: p.gross,
      totalDeductions: p.totalDeductions,
      netPay: p.netPay,
    };
  }

  async myPayslips(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return [];
    const rows = await Payslip.findAll({
      where: { employeeId: self.id, excluded: false },
      include: [{ model: PayrollRun, where: { status: ['APPROVED', 'PAID'] }, attributes: ['id', 'year', 'month', 'status', 'paidAt'] }],
      order: [
        ['run', 'year', 'DESC'],
        ['run', 'month', 'DESC'],
      ],
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
    const header = [
      'Employee code',
      'Name',
      'Department',
      'Designation',
      'Days in month',
      'Loss of pay days',
      'Payable days',
      ...earnings.map(([, n]) => n),
      'Gross',
      ...deductions.map(([, n]) => n),
      'Total deductions',
      'Net pay',
      ...employer.map(([, n]) => `Employer ${n}`),
    ];
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

  /**
   * Salary transfer file for the bank (approved runs), in a generic layout or a bank's bulk-upload layout. Account
   * numbers are decrypted, so every export is audited. Banks revise their templates: check the current one with the
   * bank before the first upload.
   */
  async bankFileCsv(id: string, format: BankFileFormat = 'GENERIC'): Promise<{ fileName: string; content: string; skipped: number }> {
    const run = await this.find(id);
    if (run.status !== 'APPROVED' && run.status !== 'PAID') throw AppError.conflict('The bank file is available once the payroll is approved');
    const payslips = await Payslip.findAll({ where: { runId: id, excluded: false } });
    const employees = new Map(
      (await Employee.findAll({ where: { id: payslips.map((p) => p.employeeId) }, attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'bankAccountEncrypted', 'bankIfsc', 'bankName'] })).map(
        (e) => [e.id, e],
      ),
    );
    const narration = `SALARY ${MONTHS[run.month - 1]!.slice(0, 3).toUpperCase()} ${run.year}`;
    const payDate = run.paidAt ? run.paidAt.toISOString().slice(0, 10) : await this.salaries.today(run.organizationId);
    let skipped = 0;
    const payments: BankPayment[] = [];
    for (const p of payslips) {
      const e = employees.get(p.employeeId);
      if (!e?.bankAccountEncrypted || !e.bankIfsc || Number(p.netPay) <= 0) {
        skipped++;
        continue;
      }
      payments.push({
        name: fullName(e),
        code: e.employeeCode,
        account: this.crypto.decrypt(e.bankAccountEncrypted, fields.employee('bank_account', e.id)),
        ifsc: e.bankIfsc.toUpperCase(),
        bank: e.bankName ?? '',
        amount: Number(p.netPay).toFixed(2),
      });
    }
    await this.audit.record({
      action: 'payroll.bank_file_exported',
      entityType: 'PayrollRun',
      entityId: id,
      summary: `Bank transfer file (${BANK_FILE_FORMAT_LABELS[format]}) for ${periodLabel(run.year, run.month)} exported (${payments.length} payments)`,
      metadata: { payments: payments.length, skipped, format },
    });
    const suffix = format === 'GENERIC' ? '' : `-${format.toLowerCase()}`;
    return { fileName: `bank-transfer-${run.year}-${String(run.month).padStart(2, '0')}${suffix}.csv`, content: bankCsv(payments, format, narration, payDate), skipped };
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
          this.crypto.decrypt(e.uanEncrypted, fields.employee('uan', e.id)),
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
    await this.audit.record({
      action: 'payroll.pf_ecr_exported',
      entityType: 'PayrollRun',
      entityId: id,
      summary: `PF ECR for ${periodLabel(run.year, run.month)} exported (${lines.length} members)`,
      metadata: { members: lines.length, skipped },
    });
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
    const timesheets: TimesheetRules | null =
      settings.timesheetsRequired && auth.features.has('attendance')
        ? { required: true, from: settings.timesheetsFrom, dueWeekday: settings.timesheetDueWeekday, missedAction: settings.timesheetMissedAction }
        : null;
    return { run, settings, orgState: org?.state ?? null, from, to, days, today, attendanceLop, timesheets };
  }

  /** Days a timesheet must cover: employed, not a holiday or weekly off, and not a full day of leave. */
  private timesheetDay(date: string, ctx: CalcContext, e: Employee, context: EmployeeContext, holidays: HolidayCalendar, leave: Map<string, DayLeave> | undefined): boolean {
    const dayLeave = leave?.get(date);
    const status = this.rules.dayStatus(date, ctx.today, e, context, holidays.on(date, context.locationId), undefined, dayLeave);
    if (status === 'NOT_EMPLOYED' || status === 'HOLIDAY' || status === 'WEEKLY_OFF') return false;
    return !(status === 'ON_LEAVE' && dayLeave?.session === 'FULL');
  }

  private async calculateEmployees(auth: AuthContext, ctx: CalcContext, transaction: Transaction, only?: string[]) {
    const { run, from, to, days } = ctx;
    // Never pay someone twice for a month: people already in another (non-cancelled) run of this month are left out.
    const elsewhere = (
      await Payslip.findAll({ where: { runId: { [Op.ne]: run.id } }, include: [{ model: PayrollRun, where: { year: run.year, month: run.month, status: { [Op.ne]: 'CANCELLED' } }, attributes: [] }], attributes: ['employeeId'], transaction })
    ).map((p) => p.employeeId);
    const employees = await Employee.findAll({
      where: {
        dateOfJoining: { [Op.lte]: to },
        [Op.or]: [{ exitDate: null }, { exitDate: { [Op.gte]: from } }],
        payGroupId: run.payGroupId ?? null,
        ...(elsewhere.length ? { [Op.and]: [{ id: { [Op.notIn]: elsewhere } }] } : {}),
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
    const [contexts, holidays, leave, records, existing, adjustments, claims, ytdSlips, esiSlips, declarations, benefits, loans, overtime, encashments] = await inSequence(
      () => this.rules.contexts(auth.organizationId!, payable, { from, to }),
      () => this.rules.holidays(from, to),
      () => this.rules.approvedLeave(ids, from, to),
      () =>
        ctx.attendanceLop && ids.length ? AttendanceRecord.findAll({ where: { employeeId: ids, workDate: { [Op.between]: [from, to] } }, transaction }) : Promise.resolve([] as AttendanceRecord[]),
      () => Payslip.findAll({ where: { runId: run.id }, transaction }),
      () => PayrollAdjustment.findAll({ where: { runId: run.id }, order: [['createdAt', 'ASC']], transaction }),
      () =>
        ids.length
          ? ReimbursementClaim.findAll({ where: { employeeId: ids, status: 'APPROVED', expenseDate: { [Op.lte]: to }, [Op.or]: [{ payrollRunId: null }, { payrollRunId: run.id }] }, transaction })
          : Promise.resolve([] as ReimbursementClaim[]),
      () => this.priorPayslips(ids, earlierInFinancialYear(run.year, run.month), transaction),
      () => this.priorPayslips(ids, earlierInContributionPeriod(run.year, run.month), transaction),
      () => TaxDeclarationRecord.findAll({ where: { employeeId: ids, financialYear: fy }, transaction }),
      // Employee contributions to benefit plans, for every month with at least one day of coverage.
      () =>
        auth.features.has('benefits') && ids.length
          ? BenefitEnrollment.findAll({
              where: {
                employeeId: ids,
                status: ['ACTIVE', 'ENDED'],
                employeeMonthly: { [Op.gt]: 0 },
                effectiveFrom: { [Op.lte]: to },
                [Op.or]: [{ effectiveTo: null }, { effectiveTo: { [Op.gte]: from } }],
              },
              include: [{ model: BenefitPlan, attributes: ['id', 'name', 'renewedFromId'] }],
              order: [['effectiveFrom', 'ASC']],
              transaction,
            })
          : Promise.resolve([] as BenefitEnrollment[]),
      () => dueInstalments(ids, run.year, run.month, transaction),
      // Approved overtime not paid yet (including late approvals from earlier months).
      () =>
        auth.features.has('attendance') && ids.length
          ? AttendanceOvertime.findAll({ where: { employeeId: ids, status: 'APPROVED', workDate: { [Op.lte]: to }, [Op.or]: [{ payrollRunId: null }, { payrollRunId: run.id }] }, transaction })
          : Promise.resolve([] as AttendanceOvertime[]),
      // Leave encashed while in service, approved and not paid yet.
      () =>
        auth.features.has('leave') && ids.length
          ? LeaveEncashment.findAll({
              where: { employeeId: ids, status: 'APPROVED', [Op.or]: [{ payrollRunId: null }, { payrollRunId: run.id }] },
              include: [{ model: LeaveType, attributes: ['code', 'name'] }],
              order: [['reviewedAt', 'ASC']],
              transaction,
            })
          : Promise.resolve([] as LeaveEncashment[]),
    );
    const recordsBy = new Map<string, Map<string, AttendanceRecord>>();
    for (const r of records) recordsBy.set(r.employeeId, (recordsBy.get(r.employeeId) ?? new Map()).set(r.workDate, r));
    const sheets =
      ctx.timesheets && ids.length
        ? await Timesheet.findAll({ where: { employeeId: ids, weekStart: { [Op.between]: [weekStartOf(from), to] } }, attributes: ['id', 'employeeId', 'weekStart', 'status'], transaction })
        : [];
    const sheetStatus = new Map<string, Map<string, TimesheetStatus>>();
    for (const s of sheets) sheetStatus.set(s.employeeId, (sheetStatus.get(s.employeeId) ?? new Map()).set(s.weekStart, s.status));
    // Recent or pending bank account changes are shown to reviewers before money moves (fraud check).
    const bankChanges = ids.length
      ? await BankDetailChange.findAll({
          where: { employeeId: ids, [Op.or]: [{ status: 'PENDING' }, { status: 'APPROVED', reviewedAt: { [Op.gte]: new Date(`${from}T00:00:00Z`).getTime() - 30 * 86_400_000 } }] },
          attributes: ['employeeId', 'status', 'reviewedAt', 'accountLast4'],
          order: [['reviewedAt', 'DESC']],
          transaction,
        })
      : [];
    const bankWarning = new Map<string, string>();
    for (const c of bankChanges) {
      if (bankWarning.has(c.employeeId)) continue;
      bankWarning.set(
        c.employeeId,
        c.status === 'PENDING'
          ? 'A bank account change is waiting for approval; the current account will be paid'
          : `Bank account changed to ••••${c.accountLast4 ?? '—'} on ${c.reviewedAt!.toISOString().slice(0, 10)}: confirm with the employee before paying`,
      );
    }
    const arrearsBy = await this.arrears(payable, salariesBy, run, transaction);
    const existingBy = new Map(existing.map((p) => [p.employeeId, p]));
    const declarationBy = new Map(declarations.map((d) => [d.employeeId, d]));
    // From the proof cut-off month, tax uses only what was proven (accepted proofs), whatever was declared.
    const verifiedBy = new Map<string, VerifiedDeductions>();
    if (proofsApply(ctx.settings.proofsFromMonth, run.month) && ids.length) {
      const proofs = await TaxDeclarationProof.findAll({ where: { employeeId: ids, financialYear: fy, status: 'ACCEPTED' }, attributes: ['employeeId', 'section', 'acceptedAmount'], transaction });
      for (const id of ids) verifiedBy.set(id, { '80C': 0, '80CCD1B': 0, '80D': 0, HRA: 0, HOME_LOAN: 0 });
      for (const p of proofs) verifiedBy.get(p.employeeId)![p.section] += Number(p.acceptedAmount);
    }

    const toRemove = only ? existing.filter((p) => only.includes(p.employeeId) && !ids.includes(p.employeeId)) : existing.filter((p) => !ids.includes(p.employeeId));
    if (toRemove.length) await Payslip.destroy({ where: { id: toRemove.map((p) => p.id) }, transaction });

    const claimIdsInRun: string[] = [];
    const encashmentIdsInRun: string[] = [];
    for (const e of payable) {
      const prior = existingBy.get(e.id);
      const gaps = ctx.timesheets
        ? timesheetGaps({
            days,
            today: ctx.today,
            rules: ctx.timesheets,
            isWorkingDay: (date) => this.timesheetDay(date, ctx, e, contexts.get(e.id)!, holidays, leave.get(e.id)),
            statusOf: (week) => sheetStatus.get(e.id)?.get(week),
          })
        : null;
      // Missing timesheets hold the salary (with "hold" as the rule); recalculating releases that hold once they're in.
      const timesheetHold = ctx.timesheets?.missedAction === 'HOLD' && !!gaps?.missed.length;
      const heldForTimesheets = !!prior?.excluded && !!prior.excludeReason?.startsWith(TIMESHEET_HOLD_REASON);
      const excluded = timesheetHold || (heldForTimesheets ? false : (prior?.excluded ?? false));
      const hold = timesheetHold
        ? { excluded: true, excludeReason: `${TIMESHEET_HOLD_REASON} for ${weeksPhrase(gaps!.missed)}`.slice(0, 300) }
        : heldForTimesheets
          ? { excluded: false, excludeReason: null }
          : {};
      const empClaims = excluded ? [] : claims.filter((c) => c.employeeId === e.id);
      claimIdsInRun.push(...empClaims.map((c) => c.id));
      const empEncashments = excluded ? [] : encashments.filter((x) => x.employeeId === e.id);
      encashmentIdsInRun.push(...empEncashments.map((x) => x.id));
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
        verified: verifiedBy.get(e.id) ?? null,
        fy,
        benefits: excluded ? [] : latestPerPlan(benefits.filter((b) => b.employeeId === e.id)),
        loans: excluded ? [] : (loans.get(e.id) ?? []),
        overtime: excluded ? [] : overtime.filter((o) => o.employeeId === e.id),
        encashments: empEncashments,
        arrears: arrearsBy.get(e.id) ?? [],
        timesheetGaps: gaps,
      });
      const bank = bankWarning.get(e.id);
      if (bank) values.warnings.push(bank);
      if (prior) await prior.update({ ...values, ...hold }, { transaction });
      else await Payslip.create({ organizationId: auth.organizationId!, runId: run.id, employeeId: e.id, ...values, ...hold }, { transaction });
    }

    // Approved claims are paid by this run (unless the employee is held); others go back to the queue.
    const scopeIds = only ?? null;
    await ReimbursementClaim.update(
      { payrollRunId: null },
      { where: { payrollRunId: run.id, status: 'APPROVED', ...(claimIdsInRun.length ? { id: { [Op.notIn]: claimIdsInRun } } : {}), ...(scopeIds ? { employeeId: scopeIds } : {}) }, transaction },
    );
    if (claimIdsInRun.length) await ReimbursementClaim.update({ payrollRunId: run.id }, { where: { id: claimIdsInRun }, transaction });
    // Encashments likewise: claimed by this run, or released for the next one.
    await LeaveEncashment.update(
      { payrollRunId: null, amount: null },
      { where: { payrollRunId: run.id, status: 'APPROVED', ...(encashmentIdsInRun.length ? { id: { [Op.notIn]: encashmentIdsInRun } } : {}), ...(scopeIds ? { employeeId: scopeIds } : {}) }, transaction },
    );
    if (encashmentIdsInRun.length) await LeaveEncashment.update({ payrollRunId: run.id }, { where: { id: encashmentIdsInRun }, transaction });
  }

  private computePayslip(
    ctx: CalcContext,
    e: Employee,
    input: {
      salaries: EmployeeSalary[];
      context: EmployeeContext;
      holidays: HolidayCalendar;
      leave: Map<string, DayLeave> | undefined;
      records: Map<string, AttendanceRecord> | undefined;
      lopOverride: number | null;
      adjustments: PayrollAdjustment[];
      claims: ReimbursementClaim[];
      ytd: Payslip[];
      esiEarlier: Payslip[];
      declaration: TaxDeclarationRecord | undefined;
      /** Accepted proofs per section, once proofs are required; null = use the declaration. */
      verified: VerifiedDeductions | null;
      fy: number;
      benefits: BenefitEnrollment[];
      loans: DueInstalment[];
      overtime: AttendanceOvertime[];
      encashments: LeaveEncashment[];
      /** Arrears per month already paid (back-dated salary revisions). */
      arrears: ArrearMonth[];
      timesheetGaps: TimesheetGaps | null;
    },
  ) {
    const { run, settings, days, today } = ctx;
    const warnings: string[] = [];
    let missedPunches = 0;
    let unsalariedDays = 0;
    let timesheetLopDays = 0;
    const timesheetLop = ctx.timesheets?.missedAction === 'LOP' ? input.timesheetGaps?.missedDays : undefined;
    const payDays: PayDay[] = days.map((date) => {
      const employed = date >= e.dateOfJoining && (!e.exitDate || date <= e.exitDate);
      if (!employed) return { date, salary: null, lop: 0 };
      const salary = [...input.salaries].reverse().find((s) => s.effectiveFrom <= date);
      if (!salary) {
        unsalariedDays++;
        return { date, salary: null, lop: 0 };
      }
      const dayLeave = input.leave?.get(date);
      const status = this.rules.dayStatus(date, today, e, input.context, input.holidays.on(date, input.context.locationId), input.records?.get(date), dayLeave);
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
      if (timesheetLop?.has(date)) {
        if (lop < 1) timesheetLopDays += 1 - lop;
        lop = 1;
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
    const gaps = input.timesheetGaps;
    if (gaps && ctx.timesheets) {
      const action = ctx.timesheets.missedAction;
      if (gaps.missed.length) {
        const phrase = weeksPhrase(gaps.missed);
        if (action === 'LOP') warnings.push(`Timesheets missing for ${phrase}: ${timesheetLopDays} working day${timesheetLopDays === 1 ? '' : 's'} counted as loss of pay`);
        else if (action === 'HOLD') warnings.push(`Salary held: timesheets missing for ${phrase}`);
        else warnings.push(`Timesheets missing for ${phrase}`);
      }
      // With pay at stake, a timesheet still waiting for review blocks submitting the run.
      if (gaps.pending.length) warnings.push(`${action === 'FLAG' ? '' : '! '}Timesheet${gaps.pending.length === 1 ? '' : 's'} for ${weeksPhrase(gaps.pending)} waiting for review`);
      if (gaps.notDue.length) warnings.push(`Timesheet for ${weeksPhrase(gaps.notDue)} isn't due yet (not counted)`);
    }

    // Earnings
    const earningAdjustments = input.adjustments.filter((a) => a.kind === 'EARNING');
    const reimbursements = sum(input.claims.map((c) => Number(c.amount)));
    // Overtime: approved hours × (monthly Basic or gross ÷ 26 ÷ 8) × multiplier; taxable, outside PF and ESI wages.
    const overtimeMinutes = sum(input.overtime.map((o) => o.approvedMinutes ?? 0));
    const overtimeRate = settings.overtimeBasis === 'BASIC' ? sum(earned.filter((c) => c.role === 'BASIC').map((c) => c.rate)) : sum(earned.map((c) => c.rate));
    const overtimePay = overtimeMinutes ? Math.round(((overtimeMinutes / 60) * overtimeRate * settings.overtimeMultiplier) / OVERTIME_HOURLY_DIVISOR) : 0;
    const overtimeHours = Math.round((overtimeMinutes / 60) * 100) / 100;
    // Leave encashed in service: days × (monthly Basic or gross ÷ 26 / 30, per payroll setup); taxable, outside PF and ESI wages.
    const latestSalary = input.salaries[input.salaries.length - 1]!;
    const encashRate = dailyRate(
      settings.leaveEncashmentBasis,
      sum(((latestSalary.components as SalaryComponent[]) ?? []).filter((c) => c.role === 'BASIC').map((c) => c.monthly)),
      Number(latestSalary.monthlyGross),
    );
    const encashed = input.encashments.map((x) => ({ id: x.id, days: Number(x.days), name: x.leaveType?.name ?? 'Leave', amount: Math.round(Number(x.days) * encashRate) }));
    const encashmentPay = sum(encashed.map((x) => x.amount));
    // Arrears of back-dated revisions: months owed more are paid now; months that came out lower are only reported.
    const owed = input.arrears.filter((a) => a.amount > 0);
    const over = input.arrears.filter((a) => a.amount < 0);
    const arrears = { amount: Math.round(sum(owed.map((a) => a.amount))), taxable: sum(owed.map((a) => a.taxable)), pfWage: sum(owed.map((a) => a.pfWage)), esiWage: sum(owed.map((a) => a.esiWage)) };
    const arrearMonths = owed.length ? (owed.length === 1 ? periodLabel(owed[0]!.year, owed[0]!.month) : `${MONTHS[owed[0]!.month - 1]!.slice(0, 3)} – ${periodLabel(owed.at(-1)!.year, owed.at(-1)!.month)}`) : '';
    if (owed.length) warnings.push(`Arrears of ₹${arrears.amount.toLocaleString('en-IN')} for ${arrearMonths} (salary revised with effect from an earlier month)`);
    if (over.length) {
      const total = Math.round(-sum(over.map((a) => a.amount)));
      warnings.push(`Salary was revised down for ${over.map((a) => periodLabel(a.year, a.month)).join(', ')}: ₹${total.toLocaleString('en-IN')} more was paid; add a deduction to recover it`);
    }
    const earnings: PayslipLine[] = [
      ...earned.filter((c) => c.amount > 0 || c.rate > 0).map((c) => ({ code: c.code, name: c.name, amount: c.amount, rate: c.rate, taxable: c.taxable })),
      ...(arrears.amount > 0 ? [{ code: 'ARREARS', name: `Salary arrears (${arrearMonths})`, amount: arrears.amount, taxable: arrears.taxable > 0 }] : []),
      ...earningAdjustments.map((a) => ({ code: `ADJ_${a.id.slice(0, 8)}`, name: a.label, amount: Number(a.amount), taxable: a.taxable })),
      ...(overtimePay > 0 ? [{ code: 'OVERTIME', name: `Overtime (${overtimeHours} h × ${settings.overtimeMultiplier})`, amount: overtimePay, taxable: true }] : []),
      ...encashed.filter((x) => x.amount > 0).map((x) => ({ code: `ENCASH_${x.id.slice(0, 8)}`, name: `${x.name} encashment (${x.days} day${x.days === 1 ? '' : 's'})`, amount: x.amount, taxable: true })),
      ...(reimbursements > 0 ? [{ code: 'REIMBURSEMENT', name: `Reimbursements (${input.claims.length})`, amount: reimbursements, taxable: false }] : []),
    ];
    const salaryGross = sum(earned.map((c) => c.amount)) + sum(earningAdjustments.map((a) => Number(a.amount))) + overtimePay + encashmentPay + arrears.amount;

    // PF
    const age = ageOn(e.dateOfBirth, ctx.from);
    const pfWageEarned = sum(earned.filter((c) => c.pfWage).map((c) => c.amount)) + arrears.pfWage;
    const pfOn = settings.pfEnabled && latest.pfApplicable;
    const pf = pfOn ? pfContribution(pfWageEarned, { restrictToCeiling: settings.pfRestrictToCeiling, age }) : null;
    if (pfOn && !e.uanEncrypted) warnings.push('No UAN recorded (needed for the PF return)');

    // ESI
    const grossRate = Number(latest.monthlyGross);
    const coveredEarlier = input.esiEarlier.length ? input.esiEarlier.some((p) => (p.statutory as { esiCovered?: boolean }).esiCovered) : null;
    const covered = esiCovered({ enabled: settings.esiEnabled, grossRate, month: run.month, coveredEarlierInPeriod: coveredEarlier });
    const esiWage = sum(earned.filter((c) => c.esiWage).map((c) => c.amount)) + arrears.esiWage;
    const esi = covered ? esiContribution(esiWage) : { employee: 0, employer: 0 };

    // Professional tax
    const ptState: ProfessionalTaxState | null = settings.ptEnabled ? (professionalTaxState(e.location?.state) ?? professionalTaxState(settings.ptState) ?? professionalTaxState(ctx.orgState)) : null;
    const pt = professionalTax(ptState, salaryGross, e.gender ?? null, run.month);
    const lwfState = settings.lwfEnabled ? (labourWelfareState(e.location?.state) ?? labourWelfareState(settings.ptState) ?? labourWelfareState(ctx.orgState)) : null;
    const lwf = labourWelfareFund(lwfState, salaryGross, run.month);

    // TDS
    const d = input.declaration;
    const v = input.verified;
    const declaration = {
      regime: d?.regime ?? 'NEW',
      rentPaidAnnual: v ? v.HRA : Number(d?.rentPaidAnnual ?? 0),
      metroCity: d?.metroCity ?? false,
      section80c: v ? v['80C'] : Number(d?.section80c ?? 0),
      section80ccd1b: v ? v['80CCD1B'] : Number(d?.section80ccd1b ?? 0),
      section80d: v ? v['80D'] : Number(d?.section80d ?? 0),
      homeLoanInterest: v ? v.HOME_LOAN : Number(d?.homeLoanInterest ?? 0),
      previousEmployerIncome: Number(d?.previousEmployerIncome ?? 0),
      previousEmployerTds: Number(d?.previousEmployerTds ?? 0),
    } as const;
    if (v && d?.regime === 'OLD') {
      const unproven =
        Number(d.section80c) + Number(d.section80ccd1b) + Number(d.section80d) + Number(d.homeLoanInterest) + Number(d.rentPaidAnnual) - (v['80C'] + v['80CCD1B'] + v['80D'] + v.HOME_LOAN + v.HRA);
      if (unproven > 0) warnings.push(`Tax uses accepted proofs only: ${Math.round(unproven).toLocaleString('en-IN')} of declared deductions not proven`);
    }
    const byRole = (role: 'BASIC' | 'HRA', field: 'amount' | 'rate') => sum(earned.filter((c) => c.role === role).map((c) => c[field]));
    const current: TaxFigures = {
      taxable: sum(earned.filter((c) => c.taxable).map((c) => c.amount)) + sum(earningAdjustments.filter((a) => a.taxable).map((a) => Number(a.amount))) + overtimePay + encashmentPay + Math.max(0, arrears.taxable),
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
      ...(lwf.employee ? [{ code: 'LWF', name: `Labour welfare fund (${lwfState!.name})`, amount: lwf.employee }] : []),
      ...(tds ? [{ code: 'TDS', name: 'Income tax (TDS)', amount: tds }] : []),
      ...deductionAdjustments.map((a) => ({ code: `ADJ_${a.id.slice(0, 8)}`, name: a.label, amount: Number(a.amount) })),
      ...input.benefits.map((b) => ({ code: `BEN_${b.planId.slice(0, 8)}`, name: `${b.plan?.name ?? 'Benefit'} (${b.optionName})`, amount: Number(b.employeeMonthly) })),
      ...input.loans.map((l) => ({ code: `LOAN_${l.loanId.slice(0, 8)}`, name: `${l.type === 'ADVANCE' ? 'Salary advance recovery' : 'Loan repayment'} (${l.reference})`, amount: l.amount })),
    ];
    const employerContributions: PayslipLine[] = [
      ...(pf
        ? [
            { code: 'EPF', name: 'Employer PF', amount: pf.employerEpf },
            { code: 'EPS', name: 'Employer pension (EPS)', amount: pf.employerEps },
          ]
        : []),
      ...(esi.employer ? [{ code: 'ESI_ER', name: 'Employer ESI', amount: esi.employer }] : []),
      ...(lwf.employer ? [{ code: 'LWF_ER', name: 'Employer labour welfare fund', amount: lwf.employer }] : []),
    ];
    const gross = sum(earnings.map((l) => l.amount));
    const totalDeductions = sum(deductions.map((l) => l.amount));
    const net = gross - totalDeductions;
    if (net < 0) warnings.push('! Deductions are more than the earnings');
    if (!e.bankAccountEncrypted || !e.bankIfsc) warnings.push('No bank account recorded (not included in the bank file)');

    const pan = e.panEncrypted ? this.crypto.decrypt(e.panEncrypted, fields.employee('pan', e.id)) : null;
    const uan = e.uanEncrypted ? this.crypto.decrypt(e.uanEncrypted, fields.employee('uan', e.id)) : null;
    return {
      employee: {
        name: fullName(e),
        employeeCode: e.employeeCode,
        designation: e.designation?.name ?? null,
        department: e.department?.name ?? null,
        location: e.location?.name ?? null,
        dateOfJoining: e.dateOfJoining,
        exitDate: e.exitDate,
        pan: pan ? `••••••${pan.slice(-4)}` : null,
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
        lwfState: lwfState?.code ?? null,
        reimbursementClaims: input.claims.map((c) => c.id),
        benefitEnrollments: input.benefits.map((b) => b.id),
        loans: input.loans.map((l) => ({ loanId: l.loanId, principal: l.principal, interest: l.interest })),
        overtime: overtimePay > 0 ? input.overtime.map((o) => o.id) : [],
        encashments: encashed.map((x) => ({ id: x.id, amount: x.amount })),
        arrears: owed,
      },
      tax: tax ? { ...tax, figures: current, thisMonth: tds } : null,
      warnings,
    };
  }

  /**
   * Arrears per employee: months of the last ARREARS_MAX_MONTHS already paid (approved runs) that a salary revision
   * recorded since covers (see arrearsFor). Arrears paid by earlier runs are taken off.
   */
  private async arrears(employees: Employee[], salariesBy: Map<string, EmployeeSalary[]>, run: PayrollRun, transaction: Transaction): Promise<Map<string, ArrearMonth[]>> {
    const out = new Map<string, ArrearMonth[]>();
    const periods: { year: number; month: number }[] = [];
    for (let i = 1, y = run.year, m = run.month; i <= ARREARS_MAX_MONTHS; i++) {
      m -= 1;
      if (m === 0) {
        m = 12;
        y -= 1;
      }
      periods.push({ year: y, month: m });
    }
    // Only people whose salary history changed after some month was paid can be owed anything.
    const oldest = monthRange(periods.at(-1)!.year, periods.at(-1)!.month).from;
    const candidates = employees.filter((e) => (salariesBy.get(e.id) ?? []).some((s) => s.createdAt.toISOString().slice(0, 10) >= oldest));
    if (!candidates.length) return out;
    const slips = await Payslip.findAll({
      where: { employeeId: candidates.map((e) => e.id), excluded: false, runId: { [Op.ne]: run.id } },
      include: [{ model: PayrollRun, where: { status: ['APPROVED', 'PAID'], ...periodWhere(periods) }, attributes: ['year', 'month'] }],
      attributes: ['id', 'employeeId', 'earnings', 'lopDays', 'lopOverride', 'statutory', 'updatedAt'],
      transaction,
    });
    for (const e of candidates) {
      const mine = slips.filter((p) => p.employeeId === e.id);
      if (!mine.length) continue;
      const alreadyPaid = new Map<string, ArrearAmounts>();
      for (const p of mine) {
        for (const a of (p.statutory as { arrears?: ArrearMonth[] }).arrears ?? []) {
          const k = monthKey(a.year, a.month);
          const prev = alreadyPaid.get(k) ?? { amount: 0, taxable: 0, pfWage: 0, esiWage: 0 };
          alreadyPaid.set(k, { amount: prev.amount + a.amount, taxable: prev.taxable + a.taxable, pfWage: prev.pfWage + a.pfWage, esiWage: prev.esiWage + a.esiWage });
        }
      }
      const due = arrearsFor(
        e,
        (salariesBy.get(e.id) ?? []).map((s) => ({ effectiveFrom: s.effectiveFrom, components: s.components as SalaryComponent[], createdAt: s.createdAt })),
        mine.map((p) => ({
          year: p.run!.year,
          month: p.run!.month,
          lopDays: Number(p.lopOverride ?? p.lopDays),
          components: p.earnings.filter((l) => l.rate !== undefined).map((l) => ({ code: l.code, amount: l.amount })),
          calculatedAt: p.updatedAt,
        })),
        alreadyPaid,
      );
      if (due.length) out.set(e.id, due);
    }
    return out;
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

  private async groupNames(runs: PayrollRun[]): Promise<Map<string, string>> {
    const ids = [...new Set(runs.map((r) => r.payGroupId).filter((x): x is string => !!x))];
    return new Map(ids.length ? (await PayGroup.findAll({ where: { id: ids }, attributes: ['id', 'name'] })).map((g) => [g.id, g.name]) : []);
  }

  private presentRun(r: PayrollRun, names: Map<string, string>, groups: Map<string, string>) {
    const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
    return {
      id: r.id,
      year: r.year,
      month: r.month,
      period: periodLabel(r.year, r.month),
      payGroup: r.payGroupId ? { id: r.payGroupId, name: groups.get(r.payGroupId) ?? 'Pay group' } : null,
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
      ...(detail ? { earnings: p.earnings, deductions: p.deductions, employerContributions: p.employerContributions, statutory: p.statutory, tax: p.tax } : {}),
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
