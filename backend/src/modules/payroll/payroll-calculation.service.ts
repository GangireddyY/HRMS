import { Injectable } from '@nestjs/common';
import { Op,type Transaction,type WhereOptions } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { inSequence } from '../../common/utils/in-sequence';
import { fullName } from '../../common/utils/names';
import { monthRange } from '../../common/utils/zoned-time';
import {
ARREARS_MAX_MONTHS,
OVERTIME_HOURLY_DIVISOR,
TIMESHEET_HOLD_REASON,
financialYearOf,
labourWelfareState,
professionalTaxState,
weekStartOf,
type ProfessionalTaxState,
type TimesheetStatus
} from '../../contracts';
import {
AttendanceOvertime,
AttendancePeriod,
AttendanceRecord,
BankDetailChange,
BenefitEnrollment,
BenefitPlan,
Department,
Designation,
Employee,
EmployeeSalary,
LeaveEncashment,
LeaveType,
Location,
Organization,
PayrollAdjustment,
PayrollRun,
Payslip,
ReimbursementClaim,
TaxDeclarationProof,
TaxDeclarationRecord,
Timesheet,
type PayslipLine
} from '../../database/models';
import { ctx as fields } from '../../infrastructure/crypto/encrypted-fields';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import { AttendanceRulesService,type DayLeave,type EmployeeContext,type HolidayCalendar } from '../attendance/attendance-rules.service';
import { timesheetGaps,weeksPhrase,type TimesheetGaps,type TimesheetRules } from '../attendance/timesheet-rules';
import { dailyRate } from '../exit/exit-rules';
import { arrearsFor,monthKey,type ArrearAmounts,type ArrearMonth } from './arrears';
import { dueInstalments,type DueInstalment } from './loan-balances';
import { PayrollConfigService,type EffectiveSettings } from './payroll-config.service';
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
import { MONTHS,periodLabel,proofsApply,sum,type VerifiedDeductions } from './payroll-period';
import { SalariesService } from './salaries.service';
import { EntitiesService } from '../entities/entities.service';

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

export interface CalcContext {
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
  /** The paying entity's currency (payslips are in it). */
  currency: string;
  /** Indian statutory deductions (PF, ESI, PT, LWF, TDS) apply: the paying entity is in India. */
  statutory: boolean;
}

/**
 * Payroll calculation: each employee's payslip for a run, from salary, arrears, loss of pay (attendance, leave,
 * timesheets), overtime, loans, claims, benefits and statutory deductions (PF, ESI, PT, LWF, TDS).
 */
@Injectable()
export class PayrollCalculationService {
  constructor(
    private readonly config: PayrollConfigService,
    private readonly salaries: SalariesService,
    private readonly rules: AttendanceRulesService,
    private readonly crypto: EncryptionService,
    private readonly entities: EntitiesService,
  ) {}

  async context(auth: AuthContext, run: PayrollRun): Promise<CalcContext> {
    const { from, to, days } = monthRange(run.year, run.month);
    const [configured, org, today, pay] = await Promise.all([
      this.config.settings(auth.organizationId!),
      Organization.findByPk(auth.organizationId!, { attributes: ['state'] }),
      this.salaries.today(auth.organizationId!),
      this.entities.payContextForGroup(auth.organizationId!, run.payGroupId ?? null),
    ]);
    // Outside India none of the Indian statutory deductions apply.
    const settings = pay.statutory ? configured : { ...configured, pfEnabled: false, esiEnabled: false, ptEnabled: false, lwfEnabled: false };
    const attendanceLop = settings.lopFromAttendance && auth.features.has('attendance');
    if (attendanceLop && !(await AttendancePeriod.count({ where: { year: run.year, month: run.month } }))) {
      throw AppError.conflict(`Close attendance for ${periodLabel(run.year, run.month)} first (loss of pay is taken from attendance)`);
    }
    const timesheets: TimesheetRules | null =
      settings.timesheetsRequired && auth.features.has('attendance')
        ? { required: true, from: settings.timesheetsFrom, dueWeekday: settings.timesheetDueWeekday, missedAction: settings.timesheetMissedAction }
        : null;
    return { run, settings, orgState: org?.state ?? null, from, to, days, today, attendanceLop, timesheets, currency: pay.currency, statutory: pay.statutory };
  }

  /** Days a timesheet must cover: employed, not a holiday or weekly off, and not a full day of leave. */
  private timesheetDay(date: string, ctx: CalcContext, e: Employee, context: EmployeeContext, holidays: HolidayCalendar, leave: Map<string, DayLeave> | undefined): boolean {
    const dayLeave = leave?.get(date);
    const status = this.rules.dayStatus(date, ctx.today, e, context, holidays.on(date, context.locationId), undefined, dayLeave);
    if (status === 'NOT_EMPLOYED' || status === 'HOLIDAY' || status === 'WEEKLY_OFF') return false;
    return !(status === 'ON_LEAVE' && dayLeave?.session === 'FULL');
  }

  async calculateEmployees(auth: AuthContext, ctx: CalcContext, transaction: Transaction, only?: string[]) {
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
      if (prior) await prior.update({ ...values, ...hold, currency: ctx.currency }, { transaction });
      else await Payslip.create({ organizationId: auth.organizationId!, runId: run.id, employeeId: e.id, ...values, ...hold, currency: ctx.currency }, { transaction });
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
    if (ctx.statutory) {
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
}
