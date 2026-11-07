import { Injectable } from '@nestjs/common';
import { Op, type Transaction } from 'sequelize';
import { SETTLEMENT_DUE_WORKING_DAYS } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { Department, Designation, Employee, EmployeeLoan, EmployeeLoanRepayment, EmployeeSalary, ExitCase, ExitClearanceItem, ExitSettlement, LeaveLedgerEntry, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { fullName, organizationToday, userIdsOf } from '../employees/employee-people';
import { LeaveBalanceService } from '../leave/leave-balance.service';
import { NotificationsService } from '../notifications/notifications.service';
import { closeRepaidLoans, loanBalances } from '../payroll/loan-balances';
import type { SalaryComponent } from '../payroll/payroll-engine';
import type { CalculateSettlementDto, PaySettlementDto, ReturnSettlementDto } from './dto/exit.dto';
import { addWorkingDays, gratuityEligibility, gratuityYears, noticeShortfall, serviceLength, settlementLines } from './exit-rules';
import { ExitsService } from './exits.service';

interface LeaveInput {
  leaveTypeId: string;
  code: string;
  name: string;
  days: number;
  leaveYear: number;
}

/**
 * Full & final settlement (`payroll.settlement.manage`, never for one's own exit): leave encashment from the
 * encashable balances, gratuity, notice pay, clearance recoveries and manual adjustments (e.g. a bonus or the TDS
 * worked out by payroll). The final month's salary is paid by the regular payroll run, prorated to the last working
 * day. Someone other than whoever calculated or submitted it approves it; approval posts the encashed leave to the
 * ledger and shows the statement to the employee. Due within two working days of the last working day.
 */
@Injectable()
export class SettlementsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly exits: ExitsService,
    private readonly leave: LeaveBalanceService,
    private readonly notifications: NotificationsService,
  ) {}

  async get(auth: AuthContext, caseId: string) {
    const c = await this.exits.find(caseId);
    const access = await this.exits.access(auth, c);
    const s = await ExitSettlement.findOne({ where: { caseId } });
    if (access.settle) return s ? this.present(s, c, true) : null;
    if (access.self && s && (s.status === 'APPROVED' || s.status === 'PAID')) return this.present(s, c, false);
    if (access.self) return null;
    throw AppError.forbidden();
  }

  async calculate(auth: AuthContext, caseId: string, dto: CalculateSettlementDto) {
    const c = await this.exits.find(caseId);
    const access = await this.exits.access(auth, c);
    if (!access.settle) throw AppError.forbidden();
    if (c.status !== 'APPROVED' && c.status !== 'COMPLETED') throw AppError.conflict('The exit has to be confirmed first');
    const existing = await ExitSettlement.findOne({ where: { caseId } });
    if (existing && existing.status !== 'DRAFT') throw AppError.conflict('The settlement has been submitted; send it back to change it');

    const employee = (await Employee.findByPk(c.employeeId))!;
    const lastDay = c.lastWorkingDay!;
    const salary = await EmployeeSalary.findOne({ where: { employeeId: employee.id, effectiveFrom: { [Op.lte]: lastDay } }, order: [['effectiveFrom', 'DESC']] });
    if (!salary) throw AppError.conflict(`${fullName(employee)} has no salary on record`);
    const components = salary.components as SalaryComponent[];
    const monthlyBasic = components.filter((x) => x.role === 'BASIC').reduce((sum, x) => sum + x.monthly, 0);
    const monthlyGross = Number(salary.monthlyGross);
    if (!monthlyBasic) throw AppError.conflict('The salary has no Basic component');

    const ctx = await this.leave.yearContext(c.organizationId);
    const balances = (await this.leave.summaries(c.organizationId, [employee], ctx.currentYear)).get(employee.id) ?? [];
    const leave: LeaveInput[] = balances
      .filter((b) => b.leaveType.encashable && !b.leaveType.unlimited && (b.available ?? 0) > 0)
      .map((b) => ({ leaveTypeId: b.leaveType.id, code: b.leaveType.code, name: b.leaveType.name, days: b.available!, leaveYear: ctx.currentYear }));

    const service = serviceLength(employee.dateOfJoining, lastDay);
    const eligibility = gratuityEligibility(c.type, employee.employmentType, service);
    const includeGratuity = dto.includeGratuity ?? existing?.includeGratuity ?? eligibility.eligible;
    const gratuityNote = dto.gratuityNote !== undefined ? dto.gratuityNote : (existing?.gratuityNote ?? null);
    if (includeGratuity !== eligibility.eligible && !gratuityNote) {
      throw AppError.validation([{ field: 'gratuityNote', message: `Explain why gratuity is ${includeGratuity ? 'paid' : 'not paid'} (${eligibility.basis.toLowerCase()})` }]);
    }
    const encashmentBasis = dto.encashmentBasis ?? existing?.encashmentBasis ?? 'BASIC_26';
    const noticeBasis = dto.noticeBasis ?? existing?.noticeBasis ?? 'GROSS_30';
    const adjustments = dto.adjustments ?? existing?.adjustments ?? [];
    const shortfallDays = noticeShortfall(c.noticeEndsOn, lastDay, c.noticeWaived);
    const recoveries = (await ExitClearanceItem.findAll({ where: { caseId, recoveryAmount: { [Op.gt]: 0 } }, order: [['sortOrder', 'ASC']] })).map((i) => ({ id: i.id, title: i.title, amount: Number(i.recoveryAmount) }));
    const activeLoans = await EmployeeLoan.findAll({ where: { employeeId: employee.id, status: 'ACTIVE' }, order: [['createdAt', 'ASC']] });
    const owed = await loanBalances(activeLoans);
    const loans = activeLoans.map((l) => ({ loanId: l.id, reference: l.reference, type: l.type, amount: owed.get(l.id)!.outstanding })).filter((l) => l.amount > 0);
    const years = gratuityYears(service);
    const result = settlementLines({
      type: c.type,
      monthlyBasic,
      monthlyGross,
      encashment: leave.map((l) => ({ code: l.code, name: l.name, days: l.days })),
      encashmentBasis,
      gratuity: { include: includeGratuity, years },
      shortfallDays,
      noticeBasis,
      recoveries,
      loans,
      adjustments,
    });
    const today = await organizationToday(c.organizationId);
    const values = {
      encashmentBasis,
      noticeBasis,
      includeGratuity,
      gratuityNote,
      adjustments,
      lines: result.lines,
      inputs: { asOf: today, lastWorkingDay: lastDay, monthlyBasic, monthlyGross, salaryEffectiveFrom: salary.effectiveFrom, service, gratuityYears: years, gratuity: eligibility, leave, loans, noticeEndsOn: c.noticeEndsOn, shortfallDays, noticeWaived: c.noticeWaived },
      totalEarnings: String(result.totalEarnings),
      totalDeductions: String(result.totalDeductions),
      netPayable: String(result.net),
      dueOn: addWorkingDays(lastDay, SETTLEMENT_DUE_WORKING_DAYS),
      calculatedById: auth.userId,
      calculatedAt: new Date(),
    };
    await this.db.transaction(async (transaction) => {
      if (existing) await existing.update(values, { transaction });
      else await ExitSettlement.create({ organizationId: c.organizationId, caseId, ...values }, { transaction });
      await this.audit.record({ action: 'exit.settlement_calculated', entityType: 'ExitCase', entityId: caseId, summary: `Full & final settlement of ${employee.employeeCode} worked out` }, transaction);
    });
    return this.get(auth, caseId);
  }

  async submit(auth: AuthContext, caseId: string) {
    await this.mutate(auth, caseId, async (s, c, transaction) => {
      if (s.status !== 'DRAFT') throw AppError.conflict('Only a draft settlement can be submitted');
      await s.update({ status: 'SUBMITTED', submittedById: auth.userId, submittedAt: new Date(), returnedNote: null }, { transaction });
      await this.audit.record({ action: 'exit.settlement_submitted', entityType: 'ExitCase', entityId: c.id, summary: 'Full & final settlement submitted for approval' }, transaction);
    });
    return this.get(auth, caseId);
  }

  async returnToDraft(auth: AuthContext, caseId: string, dto: ReturnSettlementDto) {
    await this.mutate(auth, caseId, async (s, c, transaction) => {
      if (s.status !== 'SUBMITTED') throw AppError.conflict('Only a submitted settlement can be sent back');
      await s.update({ status: 'DRAFT', returnedNote: dto.note }, { transaction });
      await this.audit.record({ action: 'exit.settlement_returned', entityType: 'ExitCase', entityId: c.id, summary: 'Full & final settlement sent back' }, transaction);
    });
    return this.get(auth, caseId);
  }

  async approve(auth: AuthContext, caseId: string) {
    await this.mutate(auth, caseId, async (s, c, transaction) => {
      if (s.status !== 'SUBMITTED') throw AppError.conflict('Only a submitted settlement can be approved');
      if (s.submittedById === auth.userId || s.calculatedById === auth.userId) throw AppError.forbidden('Someone other than whoever worked it out or submitted it approves the settlement');
      await s.update({ status: 'APPROVED', approvedById: auth.userId, approvedAt: new Date() }, { transaction });
      // The encashed leave leaves the balance.
      const today = await organizationToday(c.organizationId);
      const leave = ((s.inputs as { leave?: LeaveInput[] }).leave ?? []).filter((l) => s.lines!.some((x) => x.code === `LEAVE_${l.code}`));
      for (const l of leave) {
        await LeaveLedgerEntry.findOrCreate({
          where: { idempotencyKey: `exit:${c.id}:${l.leaveTypeId}` },
          defaults: { organizationId: c.organizationId, employeeId: c.employeeId, leaveTypeId: l.leaveTypeId, leaveYear: l.leaveYear, kind: 'ENCASHMENT', days: String(-l.days), effectiveDate: today, note: 'Encashed in the full & final settlement', idempotencyKey: `exit:${c.id}:${l.leaveTypeId}`, createdById: auth.userId },
          transaction,
        });
      }
      // Loans still owed are recovered by the settlement (never more than is owed by now).
      const loans = ((s.inputs as { loans?: { loanId: string; reference: string }[] }).loans ?? []).filter((l) => s.lines!.some((x) => x.code === `LOAN_${l.reference}`));
      if (loans.length) {
        const open = await EmployeeLoan.findAll({ where: { id: loans.map((l) => l.loanId), status: 'ACTIVE' }, transaction });
        const balances = await loanBalances(open, transaction);
        for (const l of open) {
          const line = s.lines!.find((x) => x.code === `LOAN_${l.reference}`)!;
          const recovered = Math.min(line.amount, balances.get(l.id)!.outstanding);
          if (recovered > 0) await EmployeeLoanRepayment.create({ organizationId: c.organizationId, loanId: l.id, source: 'SETTLEMENT', settlementId: s.id, paidOn: today, principal: String(recovered), note: 'Recovered in the full & final settlement', createdById: auth.userId }, { transaction });
        }
        await closeRepaidLoans(open.map((l) => l.id), transaction);
      }
      await this.audit.record({ action: 'exit.settlement_approved', entityType: 'ExitCase', entityId: c.id, summary: `Full & final settlement approved (net ₹${Number(s.netPayable).toLocaleString('en-IN')})` }, transaction);
      const userId = (await userIdsOf([c.employeeId], transaction)).get(c.employeeId);
      if (userId) await this.notifications.notify(userId, { organizationId: c.organizationId, type: 'exit.settlement', title: 'Your full & final settlement is ready', body: `Due by ${s.dueOn}.`, link: '/me/exit' }, transaction);
    });
    return this.get(auth, caseId);
  }

  async pay(auth: AuthContext, caseId: string, dto: PaySettlementDto) {
    await this.mutate(auth, caseId, async (s, c, transaction) => {
      if (s.status !== 'APPROVED') throw AppError.conflict('Only an approved settlement can be marked paid');
      if (dto.paidOn > (await organizationToday(c.organizationId))) throw AppError.validation([{ field: 'paidOn', message: "The payment date can't be in the future" }]);
      await s.update({ status: 'PAID', paidOn: dto.paidOn, paymentReference: dto.reference }, { transaction });
      await this.audit.record({ action: 'exit.settlement_paid', entityType: 'ExitCase', entityId: c.id, summary: `Full & final settlement paid on ${dto.paidOn}${dto.paidOn > s.dueOn ? ' (late)' : ''}` }, transaction);
      const userId = (await userIdsOf([c.employeeId], transaction)).get(c.employeeId);
      if (userId) await this.notifications.notify(userId, { organizationId: c.organizationId, type: 'exit.settlement', title: 'Your full & final settlement has been paid', body: `Reference ${dto.reference}.`, link: '/me/exit' }, transaction);
    });
    return this.get(auth, caseId);
  }

  private async mutate(auth: AuthContext, caseId: string, fn: (s: ExitSettlement, c: ExitCase, transaction: Transaction) => Promise<void>) {
    const c = await this.exits.find(caseId);
    if (!(await this.exits.access(auth, c)).settle) throw AppError.forbidden();
    await this.db.transaction(async (transaction) => {
      const s = await ExitSettlement.findOne({ where: { caseId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!s) throw AppError.notFound('Settlement');
      await fn(s, c, transaction);
    });
  }

  private async present(s: ExitSettlement, c: ExitCase, full: boolean) {
    const today = await organizationToday(c.organizationId);
    const employee = (await Employee.findByPk(c.employeeId, { include: [{ model: Department, attributes: ['name'] }, { model: Designation, attributes: ['name'] }] }))!;
    const ids = [s.calculatedById, s.submittedById, s.approvedById].filter((x): x is string => !!x);
    const names = new Map((ids.length ? await User.findAll({ where: { id: ids }, attributes: ['id', 'firstName', 'lastName'] }) : []).map((u) => [u.id, fullName(u)]));
    const name = (id: string | null) => (id ? (names.get(id) ?? 'Former user') : null);
    return {
      id: s.id,
      status: s.status,
      employee: { name: fullName(employee), employeeCode: employee.employeeCode, department: employee.department?.name ?? null, designation: employee.designation?.name ?? null, dateOfJoining: employee.dateOfJoining },
      lastWorkingDay: c.lastWorkingDay,
      exitType: c.type,
      lines: s.lines,
      totalEarnings: Number(s.totalEarnings),
      totalDeductions: Number(s.totalDeductions),
      netPayable: Number(s.netPayable),
      dueOn: s.dueOn,
      overdue: s.status !== 'PAID' && today > s.dueOn,
      paidOn: s.paidOn,
      paymentReference: s.paymentReference,
      approvedAt: s.approvedAt,
      ...(full
        ? {
            encashmentBasis: s.encashmentBasis,
            noticeBasis: s.noticeBasis,
            includeGratuity: s.includeGratuity,
            gratuityNote: s.gratuityNote,
            adjustments: s.adjustments,
            inputs: s.inputs,
            returnedNote: s.returnedNote,
            calculatedBy: name(s.calculatedById),
            calculatedAt: s.calculatedAt,
            submittedBy: name(s.submittedById),
            approvedBy: name(s.approvedById),
            permissions: {
              calculate: s.status === 'DRAFT',
              submit: s.status === 'DRAFT',
              approve: s.status === 'SUBMITTED',
              returnToDraft: s.status === 'SUBMITTED',
              pay: s.status === 'APPROVED',
            },
          }
        : {}),
    };
  }
}
