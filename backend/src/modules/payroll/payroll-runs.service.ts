import { Injectable } from '@nestjs/common';
import { Op,UniqueConstraintError,type Transaction,type WhereOptions } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs,paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { fullName } from '../../common/utils/names';
import { monthRange } from '../../common/utils/zoned-time';
import {
ADJUSTMENT_CATEGORY_LABELS,
STATUTORY_BONUS
} from '../../contracts';
import { DatabaseService } from '../../database/database.service';
import {
AttendanceOvertime,
AttendancePeriod,
Employee,
EmployeeLoanRepayment,
EmployeeSalary,
LeaveEncashment,
PayGroup,
PayrollAdjustment,
PayrollRun,
Payslip,
ReimbursementClaim,
User,
type PayslipLine
} from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { JobQueueService } from '../../infrastructure/jobs/job-queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AdjustmentDto,BonusPayoutDto,CreateRunDto,PayRunDto,RejectRunDto,ReviewRunDto,RunPayslipQueryDto,RunQueryDto,UpdatePayslipDto } from './dto/payroll.dto';
import { closeRepaidLoans } from './loan-balances';
import { PayrollCalculationService } from './payroll-calculation.service';
import { PayrollConfigService } from './payroll-config.service';
import {
type SalaryComponent
} from './payroll-engine';
import { periodLabel,sum } from './payroll-period';
import { userIdsOfEmployees,usersWithPermission } from './payroll-recipients';
import { PAYSLIP_EMAIL_JOB,PayslipsService } from './payslips.service';
import { SalariesService } from './salaries.service';

export { periodLabel,proofsApply,type VerifiedDeductions } from './payroll-period';

/** Payroll runs: create, calculate (PayrollCalculationService), review workflow (process → approve → pay) and payslip edits. */
@Injectable()
export class PayrollRunsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly config: PayrollConfigService,
    private readonly salaries: SalariesService,
    private readonly notifications: NotificationsService,
    private readonly jobs: JobQueueService,
    private readonly calculator: PayrollCalculationService,
    private readonly payslipService: PayslipsService,
  ) {}

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
      const ctx = await this.calculator.context(auth, run);
      await this.calculator.calculateEmployees(auth, ctx, transaction, employeeIds);
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
      for (const userId of await usersWithPermission('payroll.approve', transaction)) {
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
      const users = await userIdsOfEmployees(
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
      rows.map((p) => this.payslipService.present(p, null, false)),
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
    return this.payslipService.payslip(auth, p.id);
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
    return this.payslipService.payslip(auth, p.id);
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
    return p ? this.payslipService.payslip(auth, p.id) : null;
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


  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }
}
