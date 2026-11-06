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
import { Department, Employee, OrganizationMembership, PayrollRun, ReimbursementClaim, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { detectDocumentType, safeFileName } from '../employees/employee-documents.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { ClaimDto, ClaimQueryDto, ReviewClaimDto } from './dto/payroll.dto';
import { periodLabel } from './payroll-runs.service';
import { SalariesService } from './salaries.service';

export interface UploadedReceipt {
  buffer: Buffer;
  size: number;
  originalname: string;
}

const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();
const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Reimbursement claims: employees claim expenses (with a receipt), an approver within `payroll.reimbursement.approve`
 * scope — never the claimant — approves or rejects, and approved claims are paid with the next payroll run.
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
  ) {}

  async create(auth: AuthContext, dto: ClaimDto, file?: UploadedReceipt) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees can claim reimbursements');
    if (self.status === 'EXITED') throw AppError.forbidden('You have exited the organization');
    const today = await this.salaries.today(auth.organizationId!);
    if (dto.expenseDate > today) throw AppError.validation([{ field: 'expenseDate', message: "The expense date can't be in the future" }]);
    if (dto.expenseDate < self.dateOfJoining) throw AppError.validation([{ field: 'expenseDate', message: 'The expense is from before you joined' }]);

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
        const c = await ReimbursementClaim.create(
          {
            organizationId: auth.organizationId!,
            employeeId: self.id,
            category: dto.category,
            title: dto.title,
            expenseDate: dto.expenseDate,
            amount: String(dto.amount),
            description: dto.description ?? null,
            receiptKey: receipt?.key ?? null,
            receiptName: receipt?.name ?? null,
            receiptType: receipt?.type ?? null,
            receiptSize: receipt?.size ?? null,
            createdById: auth.userId,
          },
          { transaction },
        );
        await this.audit.record({ action: 'payroll.claim_submitted', entityType: 'ReimbursementClaim', entityId: c.id, summary: `${self.employeeCode} claimed ${money(dto.amount)} for "${dto.title}"` }, transaction);
        const managerUser = self.managerId ? await this.userOfEmployee(self.managerId) : null;
        if (managerUser && managerUser !== auth.userId) {
          await this.notifications.notify(
            managerUser,
            { organizationId: auth.organizationId, type: 'payroll.claim', title: `${fullName(self)} claimed ${money(dto.amount)}`, body: dto.title, link: '/hr/payroll/reimbursements' },
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
    } else {
      const scoped = auth.permissions.has('payroll.view') && view === 'all' ? {} : await this.scope.where(auth, 'payroll.reimbursement.approve', 'employeeId');
      if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
      conditions.push(scoped);
      if (view === 'approve') {
        conditions.push({ status: 'PENDING' });
        if (self) conditions.push({ employeeId: { [Op.ne]: self.id } });
      }
    }
    if (query.status && view !== 'approve') conditions.push({ status: query.status });
    if (query.search) conditions.push({ title: { [Op.iLike]: containsPattern(query.search) } });
    const { rows, count } = await ReimbursementClaim.findAndCountAll({
      where: { [Op.and]: conditions },
      include: [
        { model: Employee, attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'managerId', 'departmentId'], include: [{ model: Department, attributes: ['id', 'name'] }] },
        { model: PayrollRun, attributes: ['id', 'year', 'month', 'status'] },
      ],
      order: [['createdAt', 'DESC']],
      ...paginationArgs(query),
    });
    const reviewers = await this.names(rows.map((r) => r.reviewedById));
    const out = [];
    for (const r of rows) out.push(await this.present(auth, r, reviewers, self?.id ?? null));
    return new PaginatedResult(out, paginationMeta(query, count));
  }

  async get(auth: AuthContext, id: string) {
    const { claim, self } = await this.readable(auth, id);
    return this.present(auth, claim, await this.names([claim.reviewedById]), self?.id ?? null);
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

  private async review(auth: AuthContext, id: string, status: 'APPROVED' | 'REJECTED', note: string | null) {
    const claim = await ReimbursementClaim.findByPk(id, { include: [{ model: Employee }] });
    if (!claim) throw AppError.notFound('Claim');
    const self = await this.scope.self(auth);
    if (claim.employeeId === self?.id) throw AppError.forbidden("You can't review your own claim");
    if (!(await this.scope.covers(auth, 'payroll.reimbursement.approve', claim.employee!))) throw AppError.notFound('Claim');
    if (claim.status !== 'PENDING') throw AppError.conflict(`This claim is already ${claim.status.toLowerCase()}`);
    await this.db.transaction(async (transaction) => {
      await claim.update({ status, reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: note }, { transaction });
      await this.audit.record(
        { action: status === 'APPROVED' ? 'payroll.claim_approved' : 'payroll.claim_rejected', entityType: 'ReimbursementClaim', entityId: id, summary: `Claim "${claim.title}" of ${claim.employee!.employeeCode} ${status.toLowerCase()}` },
        transaction,
      );
      const userId = await this.userOfEmployee(claim.employeeId);
      if (userId) {
        await this.notifications.notify(
          userId,
          {
            organizationId: auth.organizationId,
            type: 'payroll.claim',
            title: status === 'APPROVED' ? `Your claim "${claim.title}" was approved` : `Your claim "${claim.title}" was rejected`,
            body: status === 'APPROVED' ? 'It will be paid with the next payroll.' : (note ?? undefined),
            link: '/me/reimbursements',
          },
          transaction,
        );
      }
    });
    return this.get(auth, id);
  }

  /** The claimant, an approver covering them, or `payroll.view`. */
  private async readable(auth: AuthContext, id: string) {
    const claim = await ReimbursementClaim.findByPk(id, {
      include: [
        { model: Employee, attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'managerId', 'departmentId'], include: [{ model: Department, attributes: ['id', 'name'] }] },
        { model: PayrollRun, attributes: ['id', 'year', 'month', 'status'] },
      ],
    });
    if (!claim) throw AppError.notFound('Claim');
    const self = await this.scope.self(auth);
    const allowed = claim.employeeId === self?.id || auth.permissions.has('payroll.view') || (await this.scope.covers(auth, 'payroll.reimbursement.approve', claim.employee!));
    if (!allowed) throw AppError.notFound('Claim');
    return { claim, self };
  }

  private async present(auth: AuthContext, c: ReimbursementClaim, reviewers: Map<string, string>, selfId: string | null) {
    const canReview = c.status === 'PENDING' && c.employeeId !== selfId && (await this.scope.covers(auth, 'payroll.reimbursement.approve', c.employee!));
    return {
      id: c.id,
      employee: c.employee ? { id: c.employee.id, name: fullName(c.employee), employeeCode: c.employee.employeeCode, department: c.employee.department?.name ?? null } : null,
      category: c.category,
      title: c.title,
      expenseDate: c.expenseDate,
      amount: Number(c.amount),
      description: c.description,
      receipt: c.receiptKey ? { fileName: c.receiptName, contentType: c.receiptType, size: c.receiptSize } : null,
      status: c.status,
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
