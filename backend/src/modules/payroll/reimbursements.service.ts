import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Op, type WhereOptions } from 'sequelize';
import { RECEIPT_MAX_BYTES } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { DatabaseService } from '../../database/database.service';
import { Department, Employee, OrganizationMembership, PayrollRun, ReimbursementApproval, ReimbursementClaim, User, type ApprovalInstance } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { ApprovalChainsService } from '../approvals/approval-chains.service';
import { detectDocumentType, safeFileName } from '../employees/employee-documents.service';
import { EntitiesService } from '../entities/entities.service';
import { managerAndCover, usersWithPermission } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { ClaimDto, ClaimQueryDto, ReviewClaimDto } from './dto/payroll.dto';
import { ExpensePolicyService } from './expense-policy.service';
import { periodLabel } from './payroll-period';
import { SalariesService } from './salaries.service';
import { fullName } from '../../common/utils/names';

export interface UploadedReceipt {
  buffer: Buffer;
  size: number;
  originalname: string;
}

const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const moneyIn = (n: number, currency: string) => (currency === 'INR' ? money(n) : new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n));
const FINANCE = 'payroll.reimbursement.finance';

/**
 * Reimbursement claims: employees claim expenses (with a receipt) within the expense policy, an approver within
 * `payroll.reimbursement.approve` scope — never the claimant — approves or rejects, claims above the finance threshold
 * also need finance's approval, and approved claims are paid with the next payroll run.
 */
@Injectable()
export class ReimbursementsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly salaries: SalariesService,
    private readonly policy: ExpensePolicyService,
    private readonly chains: ApprovalChainsService,
    private readonly entities: EntitiesService,
  ) {}

  async create(auth: AuthContext, dto: ClaimDto, file?: UploadedReceipt) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees can claim reimbursements');
    if (self.status === 'EXITED') throw AppError.forbidden('You have exited the organization');
    const today = await this.salaries.today(auth.organizationId!);
    if (dto.expenseDate > today) throw AppError.validation([{ field: 'expenseDate', message: "The expense date can't be in the future" }]);
    if (dto.expenseDate < self.dateOfJoining) throw AppError.validation([{ field: 'expenseDate', message: 'The expense is from before you joined' }]);
    // A receipt in another currency is converted to the pay currency at the rate on the expense date.
    const payCurrency = await this.entities.payCurrencyOf(auth.organizationId!, (await Employee.findByPk(self.id, { attributes: ['legalEntityId'] }))!);
    const foreign = dto.currency && dto.currency !== payCurrency ? dto.currency : null;
    const converted = foreign ? await this.entities.convert(auth.organizationId!, dto.amount, foreign, payCurrency, dto.expenseDate) : null;
    if (foreign && !converted) throw AppError.validation([{ field: 'currency', message: `No exchange rate for ${foreign} to ${payCurrency} on or before ${dto.expenseDate}; ask payroll to add one` }]);
    const amount = converted?.amount ?? dto.amount;
    await this.policy.checkClaim(auth.organizationId!, dto.category, amount, !!file);

    let receipt: { key: string; name: string; type: string; size: number } | null = null;
    if (file) {
      if (file.size > RECEIPT_MAX_BYTES) throw AppError.validation([{ field: 'file', message: 'The receipt must be 5 MB or smaller' }]);
      const type = detectDocumentType(file.buffer);
      if (!type) throw AppError.validation([{ field: 'file', message: 'Upload the receipt as a PDF, PNG, JPG or WebP file' }]);
      receipt = { key: `organizations/${auth.organizationId}/reimbursements/${self.id}/${randomUUID()}`, name: safeFileName(file.originalname, dto.title, type), type, size: file.size };
      await this.storage.put(receipt.key, file.buffer, type);
    }
    try {
      const claim = await this.db.transaction(async (transaction) => {
        await this.policy.checkMonthly(auth.organizationId!, self.id, dto.category, dto.expenseDate, amount, transaction);
        const c = await ReimbursementClaim.create(
          {
            organizationId: auth.organizationId!,
            employeeId: self.id,
            category: dto.category,
            title: dto.title,
            expenseDate: dto.expenseDate,
            amount: String(amount),
            ...(foreign ? { currency: foreign, originalAmount: String(dto.amount), exchangeRate: String(converted!.rate) } : {}),
            description: dto.description ?? null,
            receiptKey: receipt?.key ?? null,
            receiptName: receipt?.name ?? null,
            receiptType: receipt?.type ?? null,
            receiptSize: receipt?.size ?? null,
            createdById: auth.userId,
          },
          { transaction },
        );
        await this.audit.record(
          { action: 'payroll.claim_submitted', entityType: 'ReimbursementClaim', entityId: c.id, summary: `${self.employeeCode} claimed ${moneyIn(amount, payCurrency)}${foreign ? ` (${foreign} ${dto.amount})` : ''} for "${dto.title}"` },
          transaction,
        );
        // A configured approval chain, when one applies, replaces the manager / finance steps.
        const requester = await Employee.findByPk(self.id, { attributes: ['id', 'managerId', 'departmentId', 'membershipId'], transaction });
        const chain = await this.chains.start('EXPENSE', c.id, requester!, { amount, category: dto.category }, transaction);
        const firstApprovers = chain ? await this.chains.usersOf(chain.steps[0]!.approverMembershipIds, transaction) : await managerAndCover(self.managerId, transaction);
        for (const managerUser of firstApprovers) {
          if (managerUser === auth.userId) continue;
          await this.notifications.notify(
            managerUser,
            { organizationId: auth.organizationId, type: 'payroll.claim', title: `${fullName(self)} claimed ${moneyIn(amount, payCurrency)}`, body: dto.title, link: chain ? '/me/approvals' : '/hr/payroll/reimbursements' },
            transaction,
          );
        }
        return c;
      });
      return this.get(auth, claim.id);
    } catch (e) {
      if (receipt) await this.storage.deleteQuietly([receipt.key]);
      throw e;
    }
  }

  async list(auth: AuthContext, query: ClaimQueryDto) {
    const view = query.view ?? 'mine';
    const conditions: WhereOptions[] = [];
    const self = await this.scope.self(auth);
    if (view === 'mine') {
      if (!self) return new PaginatedResult([], paginationMeta(query, 0));
      conditions.push({ employeeId: self.id });
    } else if (view === 'finance') {
      if (!auth.permissions.has(FINANCE)) return new PaginatedResult([], paginationMeta(query, 0));
      const managed = await this.chains.managedPending('EXPENSE');
      conditions.push({ status: 'PENDING', approvalStage: 'FINANCE', ...(managed.length ? { id: { [Op.notIn]: managed } } : {}) });
      if (self) conditions.push({ employeeId: { [Op.ne]: self.id } });
    } else if (view === 'approve') {
      // Claims on an approval chain show for their current step's approvers only; the rest at the manager step.
      const [scoped, mine, managed] = await Promise.all([this.scope.where(auth, 'payroll.reimbursement.approve', 'employeeId'), this.chains.waitingFor(auth, 'EXPENSE'), this.chains.managedPending('EXPENSE')]);
      const legacy = scoped ? { [Op.and]: [scoped, { status: 'PENDING', approvalStage: 'MANAGER' }, ...(managed.length ? [{ id: { [Op.notIn]: managed } }] : [])] } : null;
      const any = [...(legacy ? [legacy] : []), ...(mine.length ? [{ id: mine, status: 'PENDING' }] : [])];
      if (!any.length) return new PaginatedResult([], paginationMeta(query, 0));
      conditions.push({ [Op.or]: any });
      if (self) conditions.push({ employeeId: { [Op.ne]: self.id } });
    } else {
      const broad = (auth.permissions.has('payroll.view') || auth.permissions.has(FINANCE)) && view === 'all';
      const scoped = broad ? {} : await this.scope.where(auth, 'payroll.reimbursement.approve', 'employeeId');
      if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
      conditions.push(scoped);
    }
    if (query.status && view !== 'approve' && view !== 'finance') conditions.push({ status: query.status });
    if (query.search) conditions.push({ title: { [Op.iLike]: containsPattern(query.search) } });
    const { rows, count } = await ReimbursementClaim.findAndCountAll({
      where: { [Op.and]: conditions },
      include: [
        { model: Employee, attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'managerId', 'departmentId'], include: [{ model: Department, attributes: ['id', 'name'] }] },
        { model: PayrollRun, attributes: ['id', 'year', 'month', 'status'] },
        { model: ReimbursementApproval, separate: true, order: [['createdAt', 'ASC']] },
      ],
      order: [['createdAt', 'DESC']],
      distinct: true,
      ...paginationArgs(query),
    });
    const reviewers = await this.names(rows.flatMap((r) => [r.reviewedById, ...(r.approvals ?? []).map((a) => a.decidedById)]));
    const chains = await this.chains.forMany('EXPENSE', rows.map((r) => r.id));
    const out = [];
    for (const r of rows) out.push(await this.present(auth, r, reviewers, self?.id ?? null, chains.get(r.id) ?? null));
    return new PaginatedResult(out, paginationMeta(query, count));
  }

  async get(auth: AuthContext, id: string) {
    const { claim, self, chain } = await this.readable(auth, id);
    const names = await this.names([claim.reviewedById, ...(claim.approvals ?? []).map((a) => a.decidedById)]);
    const used = await this.policy.usage(claim.employeeId, claim.expenseDate);
    const rule = (await this.policy.view(auth.organizationId!)).categories.find((c) => c.category === claim.category)!;
    return {
      ...(await this.present(auth, claim, names, self?.id ?? null, chain)),
      policy: { perClaimLimit: rule.perClaimLimit, monthlyLimit: rule.monthlyLimit, monthUsed: used[claim.category], month: claim.expenseDate.slice(0, 7) },
    };
  }

  /** The caller's claimed amounts per category in a month (for the claim form's limits). */
  async myUsage(auth: AuthContext, month: string) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees can claim reimbursements');
    const policy = await this.policy.view(auth.organizationId!);
    const used = await this.policy.usage(self.id, `${month}-01`);
    return { month, ...policy, used };
  }

  async approve(auth: AuthContext, id: string, dto: ReviewClaimDto) {
    return this.review(auth, id, 'APPROVED', dto.note ?? null);
  }

  async reject(auth: AuthContext, id: string, dto: ReviewClaimDto) {
    if (!dto.note || dto.note.trim().length < 3) throw AppError.validation([{ field: 'note', message: 'Give a reason for rejecting the claim' }]);
    return this.review(auth, id, 'REJECTED', dto.note);
  }

  async cancel(auth: AuthContext, id: string) {
    const self = await this.scope.self(auth);
    const claim = await ReimbursementClaim.findByPk(id);
    if (!claim || !self || claim.employeeId !== self.id) throw AppError.notFound('Claim');
    if (claim.status !== 'PENDING') throw AppError.conflict('Only a pending claim can be withdrawn');
    await this.db.transaction(async (transaction) => {
      await claim.update({ status: 'CANCELLED' }, { transaction });
      await this.chains.cancel('EXPENSE', id, transaction);
      await this.audit.record({ action: 'payroll.claim_cancelled', entityType: 'ReimbursementClaim', entityId: id, summary: `Claim "${claim.title}" withdrawn` }, transaction);
    });
    return this.get(auth, id);
  }

  async receipt(auth: AuthContext, id: string): Promise<{ stream: Readable; fileName: string; contentType: string; size: number }> {
    const { claim, self } = await this.readable(auth, id);
    if (!claim.receiptKey) throw AppError.notFound('Receipt');
    const stream = await this.storage.get(claim.receiptKey);
    if (claim.employeeId !== self?.id) {
      await this.audit.record({ action: 'payroll.claim_receipt_viewed', entityType: 'ReimbursementClaim', entityId: id, summary: `Receipt for "${claim.title}" opened` });
    }
    return { stream, fileName: claim.receiptName!, contentType: claim.receiptType!, size: claim.receiptSize! };
  }

  /**
   * The manager step (`payroll.reimbursement.approve` covering the claimant), then — for claims above the finance
   * threshold — the finance step (`payroll.reimbursement.finance`, someone other than the manager-step approver).
   */
  private async review(auth: AuthContext, id: string, decision: 'APPROVED' | 'REJECTED', note: string | null) {
    if (!auth.features.has('payroll')) throw AppError.forbidden('Payroll is not enabled for this organization');
    const chain = await this.chains.find('EXPENSE', id);
    if (chain?.status === 'PENDING') return this.reviewOnChain(auth, id, chain, decision, note);
    if (!auth.permissions.has('payroll.reimbursement.approve') && !auth.permissions.has(FINANCE) && !(auth.delegated ?? []).some((d) => d.permission === 'payroll.reimbursement.approve')) throw AppError.forbidden();
    const claim = await ReimbursementClaim.findByPk(id, { include: [{ model: Employee }] });
    if (!claim) throw AppError.notFound('Claim');
    const self = await this.scope.self(auth);
    if (claim.employeeId === self?.id) throw AppError.forbidden("You can't review your own claim");
    const step = claim.approvalStage;
    if (step === 'MANAGER' && !(await this.scope.covers(auth, 'payroll.reimbursement.approve', claim.employee!))) {
      if (claim.status === 'PENDING' && auth.permissions.has(FINANCE)) throw AppError.conflict('This claim is still waiting for the manager’s approval');
      throw AppError.notFound('Claim');
    }
    if (claim.status !== 'PENDING') throw AppError.conflict(`This claim is already ${claim.status.toLowerCase()}`);
    if (step === 'FINANCE') {
      if (!auth.permissions.has(FINANCE)) throw AppError.forbidden('This claim is waiting for the finance approval');
      if (await this.approvedFirstBy(claim.id, auth.userId)) throw AppError.forbidden('Someone other than the first approver gives the finance approval');
    }
    const threshold = await this.policy.financeThreshold(auth.organizationId!);
    const toFinance = decision === 'APPROVED' && step === 'MANAGER' && threshold !== null && Number(claim.amount) > threshold;
    const amount = money(Number(claim.amount));
    await this.db.transaction(async (transaction) => {
      const locked = await ReimbursementClaim.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (locked!.status !== 'PENDING' || locked!.approvalStage !== step) throw AppError.conflict('This claim was just decided by someone else');
      await ReimbursementApproval.create({ organizationId: auth.organizationId!, claimId: id, step, decision, decidedById: auth.userId, note }, { transaction });
      if (toFinance) await locked!.update({ approvalStage: 'FINANCE' }, { transaction });
      else await locked!.update({ status: decision, reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: note }, { transaction });
      await this.audit.record(
        {
          action: toFinance ? 'payroll.claim_manager_approved' : decision === 'APPROVED' ? 'payroll.claim_approved' : 'payroll.claim_rejected',
          entityType: 'ReimbursementClaim',
          entityId: id,
          summary: toFinance
            ? `Claim "${claim.title}" of ${claim.employee!.employeeCode} (${amount}) approved by the manager; finance approval next`
            : `Claim "${claim.title}" of ${claim.employee!.employeeCode} ${decision.toLowerCase()}${step === 'FINANCE' ? ' by finance' : ''}`,
        },
        transaction,
      );
      const userId = await this.userOfEmployee(claim.employeeId);
      if (userId) {
        await this.notifications.notify(
          userId,
          {
            organizationId: auth.organizationId,
            type: 'payroll.claim',
            title: toFinance ? `Your claim "${claim.title}" was approved by your manager` : decision === 'APPROVED' ? `Your claim "${claim.title}" was approved` : `Your claim "${claim.title}" was rejected`,
            body: toFinance ? 'Finance approves claims of this size next.' : decision === 'APPROVED' ? 'It will be paid with the next payroll.' : (note ?? undefined),
            link: '/me/reimbursements',
          },
          transaction,
        );
      }
      if (toFinance) {
        for (const financeUser of await usersWithPermission(FINANCE, transaction)) {
          if (financeUser === auth.userId || financeUser === userId) continue;
          await this.notifications.notify(
            financeUser,
            { organizationId: auth.organizationId, type: 'payroll.claim', title: `Finance approval needed: ${fullName(claim.employee!)} claimed ${amount}`, body: claim.title, link: '/hr/payroll/reimbursements?tab=finance' },
            transaction,
          );
        }
      }
    });
    return this.get(auth, id);
  }

  /** A claim on an approval chain: the current step's approvers decide; the last approval (or any rejection) settles it. */
  private async reviewOnChain(auth: AuthContext, id: string, chain: ApprovalInstance, decision: 'APPROVED' | 'REJECTED', note: string | null) {
    const claim = await ReimbursementClaim.findByPk(id, { include: [{ model: Employee }] });
    if (!claim) throw AppError.notFound('Claim');
    if (claim.status !== 'PENDING') throw AppError.conflict(`This claim is already ${claim.status.toLowerCase()}`);
    const blocked = this.chains.blockReason(auth, chain);
    if (blocked) throw AppError.forbidden(blocked);
    const amount = money(Number(claim.amount));
    const userId = await this.userOfEmployee(claim.employeeId);
    let next: string[] = [];
    let nextLabel: string | null = null;
    await this.db.transaction(async (transaction) => {
      const locked = await ReimbursementClaim.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (locked!.status !== 'PENDING') throw AppError.conflict('This claim was just decided by someone else');
      const result = await this.chains.decide(auth, chain, decision, note, transaction);
      if (result.final) await locked!.update({ status: decision, reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: note }, { transaction });
      next = result.nextApprovers;
      nextLabel = result.nextLabel;
      await this.audit.record(
        {
          action: result.final ? (decision === 'APPROVED' ? 'payroll.claim_approved' : 'payroll.claim_rejected') : 'payroll.claim_step_approved',
          entityType: 'ReimbursementClaim',
          entityId: id,
          summary: result.final ? `Claim "${claim.title}" of ${claim.employee!.employeeCode} ${decision.toLowerCase()}` : `Claim "${claim.title}" of ${claim.employee!.employeeCode} (${amount}) approved; ${result.nextLabel} next`,
        },
        transaction,
      );
      if (userId) {
        await this.notifications.notify(
          userId,
          {
            organizationId: auth.organizationId,
            type: 'payroll.claim',
            title: !result.final ? `Your claim "${claim.title}" was approved; ${result.nextLabel} approves next` : decision === 'APPROVED' ? `Your claim "${claim.title}" was approved` : `Your claim "${claim.title}" was rejected`,
            body: result.final && decision === 'APPROVED' ? 'It will be paid with the next payroll.' : (note ?? undefined),
            link: '/me/reimbursements',
          },
          transaction,
        );
      }
    });
    for (const approver of await this.chains.usersOf(next)) {
      if (approver === auth.userId || approver === userId) continue;
      await this.notifications.notify(approver, { organizationId: auth.organizationId, type: 'payroll.claim', title: `${nextLabel} approval needed: ${fullName(claim.employee!)} claimed ${amount}`, body: claim.title, link: '/me/approvals' });
    }
    return this.get(auth, id);
  }

  private async approvedFirstBy(claimId: string, userId: string): Promise<boolean> {
    return (await ReimbursementApproval.count({ where: { claimId, step: 'MANAGER', decision: 'APPROVED', decidedById: userId } })) > 0;
  }

  /** The claimant, an approver covering them, or `payroll.view`. */
  private async readable(auth: AuthContext, id: string) {
    const claim = await ReimbursementClaim.findByPk(id, {
      include: [
        { model: Employee, attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'managerId', 'departmentId'], include: [{ model: Department, attributes: ['id', 'name'] }] },
        { model: PayrollRun, attributes: ['id', 'year', 'month', 'status'] },
        { model: ReimbursementApproval, separate: true, order: [['createdAt', 'ASC']] },
      ],
    });
    if (!claim) throw AppError.notFound('Claim');
    const self = await this.scope.self(auth);
    const chain = await this.chains.find('EXPENSE', id);
    const allowed =
      claim.employeeId === self?.id ||
      auth.permissions.has('payroll.view') ||
      auth.permissions.has(FINANCE) ||
      (await this.scope.covers(auth, 'payroll.reimbursement.approve', claim.employee!)) ||
      (!!chain && (this.chains.canDecide(auth, chain) || chain.decisions.some((d) => d.membershipId === auth.membershipId)));
    if (!allowed) throw AppError.notFound('Claim');
    return { claim, self, chain };
  }

  private async present(auth: AuthContext, c: ReimbursementClaim, reviewers: Map<string, string>, selfId: string | null, chain: ApprovalInstance | null = null) {
    const trail = c.approvals ?? [];
    const onChain = chain?.status === 'PENDING';
    const canReview =
      c.status === 'PENDING' &&
      c.employeeId !== selfId &&
      (onChain
        ? this.chains.canDecide(auth, chain)
        : c.approvalStage === 'FINANCE'
          ? auth.permissions.has(FINANCE) && !trail.some((a) => a.step === 'MANAGER' && a.decision === 'APPROVED' && a.decidedById === auth.userId)
          : await this.scope.covers(auth, 'payroll.reimbursement.approve', c.employee!));
    return {
      id: c.id,
      employee: c.employee ? { id: c.employee.id, name: fullName(c.employee), employeeCode: c.employee.employeeCode, department: c.employee.department?.name ?? null } : null,
      category: c.category,
      title: c.title,
      expenseDate: c.expenseDate,
      amount: Number(c.amount),
      /** The receipt in another currency (amount is the converted figure). */
      original: c.currency ? { currency: c.currency, amount: Number(c.originalAmount), rate: Number(c.exchangeRate) } : null,
      description: c.description,
      receipt: c.receiptKey ? { fileName: c.receiptName, contentType: c.receiptType, size: c.receiptSize } : null,
      status: c.status,
      approvalStage: c.status === 'PENDING' && !onChain ? c.approvalStage : null,
      chain: this.chains.present(chain),
      trail: trail.map((a) => ({ step: a.step, decision: a.decision, by: a.decidedById ? (reviewers.get(a.decidedById) ?? null) : null, note: a.note, at: a.createdAt })),
      reviewedBy: c.reviewedById ? (reviewers.get(c.reviewedById) ?? null) : null,
      reviewedAt: c.reviewedAt,
      reviewNote: c.reviewNote,
      payroll: c.run ? { id: c.run.id, period: periodLabel(c.run.year, c.run.month), status: c.run.status } : null,
      createdAt: c.createdAt,
      permissions: { review: canReview, cancel: c.status === 'PENDING' && c.employeeId === selfId },
    };
  }

  private async names(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }

  private async userOfEmployee(employeeId: string): Promise<string | null> {
    const e = await Employee.findByPk(employeeId, { attributes: ['id', 'membershipId'] });
    if (!e?.membershipId) return null;
    const m = await OrganizationMembership.findByPk(e.membershipId, { attributes: ['userId', 'status'] });
    return m && m.status === 'ACTIVE' ? m.userId : null;
  }
}
