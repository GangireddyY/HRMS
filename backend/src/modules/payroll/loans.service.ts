import { Injectable } from '@nestjs/common';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { ADVANCE_MAX_TENURE_MONTHS, LOAN_PREFIX, OPEN_LOAN_STATUSES, type LoanType } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { DatabaseService } from '../../database/database.service';
import { Department, Employee, EmployeeLoan, EmployeeLoanRepayment, PayrollRun, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { fullName, userIdsOf, usersWithPermission } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { ApproveLoanDto, CreateLoanDto, DeferLoanDto, DisburseLoanDto, LoanQueryDto, LoanRepaymentDto, LoanRequestDto, RejectLoanDto } from './dto/payroll.dto';
import { closeRepaidLoans, loanBalances, type LoanBalance } from './loan-balances';
import { loanEmi, monthIndex, nextInstalment, repaymentSchedule } from './loan-rules';
import { periodLabel } from './payroll-runs.service';
import { SalariesService } from './salaries.service';

const LABEL: Record<LoanType, string> = { LOAN: 'loan', ADVANCE: 'salary advance' };
const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const HR = ['payroll.loan.approve', 'payroll.loan.manage', 'payroll.view'];

/**
 * Loans and salary advances. Employees request them (`payroll.loan.apply`) or payroll raises one on their behalf
 * (`payroll.loan.manage`); someone with `payroll.loan.approve` — never the employee or whoever raised it — approves
 * the amount, tenure, interest (loans only) and the first month of deductions. Once disbursed (`payroll.loan.manage`)
 * payroll deducts the instalment every month (interest on the reducing balance) and records the repayment when the
 * run is approved; the loan closes when nothing is owed. Payroll can also record direct repayments and defer
 * deductions; what is still owed at exit is recovered in the full & final settlement.
 */
@Injectable()
export class LoansService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
    private readonly salaries: SalariesService,
  ) {}

  // ---- Requests ---------------------------------------------------------------------------------

  async request(auth: AuthContext, dto: LoanRequestDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees can request loans and advances');
    if (self.status !== 'ACTIVE') throw AppError.conflict(self.status === 'ON_NOTICE' ? "Loans and advances can't be requested while serving notice" : 'You have exited the organization');
    return this.open(auth, self, dto);
  }

  async raise(auth: AuthContext, dto: CreateLoanDto) {
    const employee = await Employee.findByPk(dto.employeeId);
    if (!employee) throw AppError.notFound('Employee');
    if ((await this.scope.self(auth))?.id === employee.id) throw AppError.forbidden('Request your own loan from My Workspace');
    if (employee.status !== 'ACTIVE') throw AppError.conflict(`${fullName(employee)} is not active`);
    return this.open(auth, employee, dto);
  }

  private async open(auth: AuthContext, employee: Employee, dto: LoanRequestDto) {
    this.checkTerms(dto.type, dto.tenureMonths, 0);
    const id = await this.db.transaction(async (transaction) => {
      if (await EmployeeLoan.count({ where: { employeeId: employee.id, status: 'REQUESTED' }, transaction })) {
        throw AppError.conflict(`${employee.membershipId === auth.membershipId ? 'You already have' : `${fullName(employee)} already has`} a request waiting for approval`);
      }
      const loan = await EmployeeLoan.create(
        {
          organizationId: auth.organizationId!,
          employeeId: employee.id,
          type: dto.type,
          reference: await this.nextReference(dto.type, transaction),
          purpose: dto.purpose,
          principal: String(dto.amount),
          tenureMonths: dto.tenureMonths,
          createdById: auth.userId,
        },
        { transaction },
      );
      await this.audit.record(
        {
          action: 'payroll.loan_requested',
          entityType: 'EmployeeLoan',
          entityId: loan.id,
          summary: `${loan.reference}: ${LABEL[dto.type]} of ${money(dto.amount)} over ${dto.tenureMonths} months for ${employee.employeeCode}`,
        },
        transaction,
      );
      const employeeUser = (await userIdsOf([employee.id], transaction)).get(employee.id);
      for (const userId of await usersWithPermission('payroll.loan.approve', transaction)) {
        if (userId === auth.userId || userId === employeeUser) continue;
        await this.notifications.notify(
          userId,
          {
            organizationId: auth.organizationId,
            type: 'payroll.loan',
            title: `${fullName(employee)} asked for a ${LABEL[dto.type]} of ${money(dto.amount)}`,
            body: dto.purpose,
            link: `/hr/payroll/loans/${loan.id}`,
          },
          transaction,
        );
      }
      return loan.id;
    });
    return this.get(auth, id);
  }

  async approve(auth: AuthContext, id: string, dto: ApproveLoanDto) {
    await this.decide(auth, id, async (loan, transaction) => {
      const principal = dto.amount ?? Number(loan.principal);
      if (principal > Number(loan.principal)) throw AppError.validation([{ field: 'amount', message: `Can't be more than the ${money(Number(loan.principal))} requested` }]);
      const tenure = dto.tenureMonths ?? loan.tenureMonths;
      const rate = dto.interestRate ?? 0;
      this.checkTerms(loan.type, tenure, rate);
      await this.checkStartMonth(auth, dto.startYear, dto.startMonth);
      const emi = loanEmi(principal, rate, tenure);
      await loan.update(
        {
          status: 'APPROVED',
          principal: String(principal),
          tenureMonths: tenure,
          interestRate: String(rate),
          emi: String(emi),
          startYear: dto.startYear,
          startMonth: dto.startMonth,
          decidedById: auth.userId,
          decidedAt: new Date(),
          decisionNote: dto.note ?? null,
        },
        { transaction },
      );
      await this.audit.record(
        {
          action: 'payroll.loan_approved',
          entityType: 'EmployeeLoan',
          entityId: loan.id,
          summary: `${loan.reference} approved: ${money(principal)} over ${tenure} months at ${rate}%, instalment ${money(emi)} from ${periodLabel(dto.startYear, dto.startMonth)}`,
        },
        transaction,
      );
      await this.tell(
        loan,
        `Your ${LABEL[loan.type]} ${loan.reference} was approved`,
        `${money(principal)}, repaid ${money(emi)} a month from ${periodLabel(dto.startYear, dto.startMonth)}.`,
        transaction,
      );
    });
    return this.get(auth, id);
  }

  async reject(auth: AuthContext, id: string, dto: RejectLoanDto) {
    await this.decide(auth, id, async (loan, transaction) => {
      await loan.update({ status: 'REJECTED', decidedById: auth.userId, decidedAt: new Date(), decisionNote: dto.note }, { transaction });
      await this.audit.record({ action: 'payroll.loan_rejected', entityType: 'EmployeeLoan', entityId: loan.id, summary: `${loan.reference} rejected` }, transaction);
      await this.tell(loan, `Your ${LABEL[loan.type]} request ${loan.reference} was not approved`, dto.note, transaction);
    });
    return this.get(auth, id);
  }

  /** The employee withdraws their pending request; payroll can cancel anything not disbursed yet. */
  async cancel(auth: AuthContext, id: string) {
    await this.mutate(auth, id, async (loan, self, transaction) => {
      const own = self?.id === loan.employeeId;
      if (own && loan.status === 'REQUESTED') {
        await loan.update({ status: 'CANCELLED' }, { transaction });
      } else if (auth.permissions.has('payroll.loan.manage') && (loan.status === 'REQUESTED' || loan.status === 'APPROVED')) {
        await loan.update({ status: 'CANCELLED' }, { transaction });
        if (!own) await this.tell(loan, `Your ${LABEL[loan.type]} ${loan.reference} was cancelled`, undefined, transaction);
      } else {
        throw loan.status === 'REQUESTED' || loan.status === 'APPROVED' ? AppError.forbidden() : AppError.conflict(`This ${LABEL[loan.type]} is ${loan.status.toLowerCase()}`);
      }
      await this.audit.record({ action: 'payroll.loan_cancelled', entityType: 'EmployeeLoan', entityId: loan.id, summary: `${loan.reference} cancelled` }, transaction);
    });
    return this.get(auth, id);
  }

  // ---- Payroll ----------------------------------------------------------------------------------

  async disburse(auth: AuthContext, id: string, dto: DisburseLoanDto) {
    await this.manage(auth, id, async (loan, transaction) => {
      if (loan.status !== 'APPROVED') throw AppError.conflict('Only an approved loan can be disbursed');
      await this.checkPaymentDate(auth, dto.disbursedOn, loan.decidedAt!.toISOString().slice(0, 10), 'disbursedOn');
      await loan.update({ status: 'ACTIVE', disbursedOn: dto.disbursedOn, disbursementReference: dto.reference, disbursedById: auth.userId }, { transaction });
      await this.audit.record(
        { action: 'payroll.loan_disbursed', entityType: 'EmployeeLoan', entityId: loan.id, summary: `${loan.reference} disbursed on ${dto.disbursedOn} (${dto.reference})` },
        transaction,
      );
      await this.tell(
        loan,
        `Your ${LABEL[loan.type]} ${loan.reference} has been paid out`,
        `${money(Number(loan.emi))} a month is deducted from your salary from ${periodLabel(loan.startYear!, loan.startMonth!)}.`,
        transaction,
      );
    });
    return this.get(auth, id);
  }

  /** Moves the next deduction to a later month (e.g. a month's break). */
  async defer(auth: AuthContext, id: string, dto: DeferLoanDto) {
    await this.manage(auth, id, async (loan, transaction) => {
      if (loan.status !== 'APPROVED' && loan.status !== 'ACTIVE') throw AppError.conflict('Only an approved or running loan can be deferred');
      await this.checkNoRunAwaitingApproval(transaction);
      await this.checkStartMonth(auth, dto.startYear, dto.startMonth);
      await loan.update({ startYear: dto.startYear, startMonth: dto.startMonth }, { transaction });
      await this.audit.record(
        { action: 'payroll.loan_deferred', entityType: 'EmployeeLoan', entityId: loan.id, summary: `${loan.reference}: deductions from ${periodLabel(dto.startYear, dto.startMonth)} (${dto.note})` },
        transaction,
      );
      await this.tell(loan, `Deductions for ${loan.reference} now start in ${periodLabel(dto.startYear, dto.startMonth)}`, dto.note, transaction);
    });
    return this.get(auth, id);
  }

  /** A repayment made outside payroll (e.g. a bank transfer): reduces the principal; the loan closes when nothing is owed. */
  async repay(auth: AuthContext, id: string, dto: LoanRepaymentDto) {
    await this.manage(auth, id, async (loan, transaction) => {
      if (loan.status !== 'ACTIVE') throw AppError.conflict('Repayments are recorded on a running loan');
      await this.checkNoRunAwaitingApproval(transaction);
      await this.checkPaymentDate(auth, dto.paidOn, loan.disbursedOn!, 'paidOn');
      const { outstanding } = (await loanBalances([loan], transaction)).get(loan.id)!;
      if (dto.amount > outstanding) throw AppError.validation([{ field: 'amount', message: `Only ${money(outstanding)} is still owed` }]);
      await EmployeeLoanRepayment.create(
        { organizationId: loan.organizationId, loanId: loan.id, source: 'MANUAL', paidOn: dto.paidOn, principal: String(dto.amount), note: dto.note, createdById: auth.userId },
        { transaction },
      );
      const closed = (await closeRepaidLoans([loan.id], transaction)).length > 0;
      await this.audit.record(
        { action: 'payroll.loan_repaid', entityType: 'EmployeeLoan', entityId: loan.id, summary: `${loan.reference}: repayment of ${money(dto.amount)} recorded${closed ? ' (closed)' : ''}` },
        transaction,
      );
      await this.tell(loan, closed ? `Your ${LABEL[loan.type]} ${loan.reference} is fully repaid` : `A repayment of ${money(dto.amount)} was recorded on ${loan.reference}`, undefined, transaction);
    });
    return this.get(auth, id);
  }

  // ---- Reading ----------------------------------------------------------------------------------

  async list(auth: AuthContext, query: LoanQueryDto) {
    if (!HR.some((p) => auth.permissions.has(p))) throw AppError.forbidden();
    const self = await this.scope.self(auth);
    const conditions: WhereOptions[] = [];
    if (query.view === 'approve') {
      if (!auth.permissions.has('payroll.loan.approve')) return new PaginatedResult([], paginationMeta(query, 0));
      conditions.push({ status: 'REQUESTED' }, { [Op.or]: [{ createdById: null }, { createdById: { [Op.ne]: auth.userId } }] });
      if (self) conditions.push({ employeeId: { [Op.ne]: self.id } });
    } else if (query.status === 'OPEN') conditions.push({ status: OPEN_LOAN_STATUSES });
    else if (query.status) conditions.push({ status: query.status });
    if (query.type) conditions.push({ type: query.type });
    const like = query.search ? containsPattern(query.search) : null;
    const employeeWhere = like ? { [Op.or]: [{ firstName: { [Op.iLike]: like } }, { lastName: { [Op.iLike]: like } }, { employeeCode: { [Op.iLike]: like } }] } : undefined;
    const where = { [Op.and]: conditions };
    const include = [
      { model: Employee, attributes: ['id', 'employeeCode', 'firstName', 'lastName'], where: employeeWhere, required: !!like, include: [{ model: Department, attributes: ['id', 'name'] }] },
    ];
    const count = await EmployeeLoan.count({ where, include });
    const rows = await EmployeeLoan.findAll({ where, include, order: [['createdAt', 'DESC']], ...paginationArgs(query) });
    const balances = await loanBalances(rows);
    return new PaginatedResult(
      rows.map((l) => this.summary(l, balances.get(l.id)!)),
      paginationMeta(query, count),
    );
  }

  async mine(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return { loans: [], canRequest: false };
    const rows = await EmployeeLoan.findAll({ where: { employeeId: self.id }, order: [['createdAt', 'DESC']] });
    const balances = await loanBalances(rows);
    return {
      loans: rows.map((l) => ({ ...this.summary(l, balances.get(l.id)!), permissions: { cancel: l.status === 'REQUESTED' } })),
      canRequest: self.status === 'ACTIVE' && !rows.some((l) => l.status === 'REQUESTED'),
    };
  }

  async get(auth: AuthContext, id: string) {
    const loan = await EmployeeLoan.findByPk(id, {
      include: [{ model: Employee, attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'status'], include: [{ model: Department, attributes: ['id', 'name'] }] }],
    });
    if (!loan) throw AppError.notFound('Loan');
    const self = await this.scope.self(auth);
    const own = self?.id === loan.employeeId;
    const hr = HR.some((p) => auth.permissions.has(p));
    if (!own && !hr) throw AppError.notFound('Loan');
    const balance = (await loanBalances([loan])).get(loan.id)!;
    const repayments = await EmployeeLoanRepayment.findAll({
      where: { loanId: loan.id },
      include: [{ model: PayrollRun, attributes: ['id', 'year', 'month'] }],
      order: [
        ['paidOn', 'ASC'],
        ['createdAt', 'ASC'],
      ],
    });
    const names = await this.names([loan.createdById, loan.decidedById, loan.disbursedById]);
    const name = (x: string | null) => (x ? (names.get(x) ?? 'Former user') : null);
    const first = await this.firstOpenMonth(auth);
    const from = loan.startYear && monthIndex(loan.startYear, loan.startMonth!) > monthIndex(first.year, first.month) ? { year: loan.startYear, month: loan.startMonth! } : first;
    const principalForSchedule = loan.status === 'ACTIVE' ? balance.outstanding : loan.status === 'APPROVED' ? Number(loan.principal) : 0;
    const decide = hr && auth.permissions.has('payroll.loan.approve') && !own && loan.createdById !== auth.userId && loan.status === 'REQUESTED';
    const manage = auth.permissions.has('payroll.loan.manage') && !own;
    return {
      ...this.summary(loan, balance),
      decisionNote: loan.decisionNote,
      decidedBy: name(loan.decidedById),
      decidedAt: loan.decidedAt,
      raisedBy: loan.createdById && (!own || loan.createdById !== auth.userId) ? name(loan.createdById) : null,
      disbursedBy: name(loan.disbursedById),
      disbursementReference: loan.disbursementReference,
      closedAt: loan.closedAt,
      repayments: repayments.map((r) => ({
        id: r.id,
        source: r.source,
        paidOn: r.paidOn,
        period: r.run ? periodLabel(r.run.year, r.run.month) : null,
        principal: Number(r.principal),
        interest: Number(r.interest),
        note: r.note,
      })),
      schedule: loan.emi && principalForSchedule > 0 ? repaymentSchedule(principalForSchedule, Number(loan.interestRate), Number(loan.emi), from) : [],
      permissions: {
        approve: decide,
        reject: decide,
        cancel: (own && loan.status === 'REQUESTED') || (manage && (loan.status === 'REQUESTED' || loan.status === 'APPROVED')),
        disburse: manage && loan.status === 'APPROVED',
        defer: manage && (loan.status === 'APPROVED' || loan.status === 'ACTIVE'),
        repay: manage && loan.status === 'ACTIVE',
      },
    };
  }

  /** The first month payroll can still deduct from: the month after the last approved run, and never before this month. */
  async firstOpenMonth(auth: AuthContext): Promise<{ year: number; month: number }> {
    const today = await this.salaries.today(auth.organizationId!);
    const [ty, tm] = today.split('-').map(Number) as [number, number];
    const latest = await PayrollRun.findOne({
      where: { status: ['APPROVED', 'PAID'] },
      order: [
        ['year', 'DESC'],
        ['month', 'DESC'],
      ],
      attributes: ['year', 'month'],
    });
    const after = latest ? monthIndex(latest.year, latest.month) + 1 : 0;
    const index = Math.max(after, monthIndex(ty, tm));
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
  }

  // ---- Internals --------------------------------------------------------------------------------

  private checkTerms(type: LoanType, tenure: number, rate: number) {
    if (type === 'ADVANCE' && tenure > ADVANCE_MAX_TENURE_MONTHS)
      throw AppError.validation([{ field: 'tenureMonths', message: `Salary advances are repaid within ${ADVANCE_MAX_TENURE_MONTHS} months` }]);
    if (type === 'ADVANCE' && rate > 0) throw AppError.validation([{ field: 'interestRate', message: 'Salary advances are interest-free' }]);
  }

  private async checkStartMonth(auth: AuthContext, year: number, month: number) {
    const first = await this.firstOpenMonth(auth);
    if (monthIndex(year, month) < monthIndex(first.year, first.month))
      throw AppError.validation([{ field: 'startMonth', message: `Deductions can start from ${periodLabel(first.year, first.month)}` }]);
    if (monthIndex(year, month) > monthIndex(first.year, first.month) + 12) throw AppError.validation([{ field: 'startMonth', message: 'Choose a month within a year' }]);
  }

  private async checkPaymentDate(auth: AuthContext, date: string, earliest: string, field: string) {
    if (date > (await this.salaries.today(auth.organizationId!))) throw AppError.validation([{ field, message: "The date can't be in the future" }]);
    if (date < earliest) throw AppError.validation([{ field, message: `The date can't be before ${earliest}` }]);
  }

  private async checkNoRunAwaitingApproval(transaction: Transaction) {
    const run = await PayrollRun.findOne({ where: { status: 'SUBMITTED' }, attributes: ['year', 'month'], transaction });
    if (run) throw AppError.conflict(`Payroll for ${periodLabel(run.year, run.month)} is waiting for approval; try again once it is approved or sent back`);
  }

  private async decide(auth: AuthContext, id: string, fn: (loan: EmployeeLoan, transaction: Transaction) => Promise<void>) {
    if (!auth.permissions.has('payroll.loan.approve')) throw AppError.forbidden();
    await this.mutate(auth, id, async (loan, self, transaction) => {
      if (self?.id === loan.employeeId) throw AppError.forbidden("You can't decide on your own loan");
      if (loan.createdById === auth.userId) throw AppError.forbidden('Someone other than whoever raised the request decides on it');
      if (loan.status !== 'REQUESTED') throw AppError.conflict(`This request is already ${loan.status.toLowerCase()}`);
      await fn(loan, transaction);
    });
  }

  private async manage(auth: AuthContext, id: string, fn: (loan: EmployeeLoan, transaction: Transaction) => Promise<void>) {
    if (!auth.permissions.has('payroll.loan.manage')) throw AppError.forbidden();
    await this.mutate(auth, id, async (loan, self, transaction) => {
      if (self?.id === loan.employeeId) throw AppError.forbidden("You can't handle your own loan");
      await fn(loan, transaction);
    });
  }

  private async mutate(auth: AuthContext, id: string, fn: (loan: EmployeeLoan, self: Employee | null, transaction: Transaction) => Promise<void>) {
    const self = await this.scope.self(auth);
    await this.db.transaction(async (transaction) => {
      const loan = await EmployeeLoan.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!loan || (loan.employeeId !== self?.id && !HR.some((p) => auth.permissions.has(p)))) throw AppError.notFound('Loan');
      await fn(loan, self, transaction);
    });
  }

  private async tell(loan: EmployeeLoan, title: string, body: string | undefined, transaction: Transaction) {
    const userId = (await userIdsOf([loan.employeeId], transaction)).get(loan.employeeId);
    if (userId) await this.notifications.notify(userId, { organizationId: loan.organizationId, type: 'payroll.loan', title, body, link: '/me/loans' }, transaction);
  }

  private async nextReference(type: LoanType, transaction: Transaction): Promise<string> {
    const prefix = LOAN_PREFIX[type];
    const rows = await EmployeeLoan.findAll({ where: { reference: { [Op.like]: `${prefix}-%` } }, attributes: ['reference'], raw: true, transaction, lock: transaction.LOCK.UPDATE });
    const pattern = new RegExp(`^${prefix}-(\\d+)$`);
    const max = rows.reduce((m, r) => Math.max(m, Number(pattern.exec(r.reference)?.[1] ?? 0)), 0);
    return `${prefix}-${String(max + 1).padStart(4, '0')}`;
  }

  private summary(l: EmployeeLoan, b: LoanBalance) {
    const emi = l.emi === null ? null : Number(l.emi);
    return {
      id: l.id,
      reference: l.reference,
      type: l.type,
      employee: l.employee ? { id: l.employee.id, name: fullName(l.employee), employeeCode: l.employee.employeeCode, department: l.employee.department?.name ?? null } : null,
      purpose: l.purpose,
      principal: Number(l.principal),
      interestRate: Number(l.interestRate),
      tenureMonths: l.tenureMonths,
      emi,
      start: l.startYear ? { year: l.startYear, month: l.startMonth!, label: periodLabel(l.startYear, l.startMonth!) } : null,
      status: l.status,
      disbursedOn: l.disbursedOn,
      repaid: b.repaidPrincipal,
      interestPaid: b.repaidInterest,
      outstanding: b.outstanding,
      instalmentsPaid: b.instalments,
      nextInstalment: l.status === 'ACTIVE' && emi ? nextInstalment(b.outstanding, Number(l.interestRate), emi) : null,
      createdAt: l.createdAt,
    };
  }

  private async names(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }
}
