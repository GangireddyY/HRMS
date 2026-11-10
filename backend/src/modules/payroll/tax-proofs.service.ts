import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { literal, Op, type WhereOptions } from 'sequelize';
import { TAX_PROOF_MAX_BYTES, TAX_PROOF_SECTIONS, TAX_PROOF_SECTION_LABELS, type TaxProofSection } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { fullName } from '../../common/utils/names';
import { DatabaseService } from '../../database/database.service';
import { Employee, TaxDeclarationProof, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { detectDocumentType, safeFileName } from '../employees/employee-documents.service';
import { userIdsOf } from '../employees/employee-people';
import { NotificationsService } from '../notifications/notifications.service';
import type { AcceptProofDto, ProofQueryDto, RejectProofDto, UploadProofDto } from './dto/payroll.dto';
import type { UploadedReceipt } from './reimbursements.service';
import { SalariesService } from './salaries.service';

const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Investment and rent proofs (what Form 12BB lists): employees upload them for the financial year; payroll
 * (`payroll.process`) accepts each — fully or in part — or rejects it with a reason. From the proof cut-off month in
 * payroll settings, income tax uses accepted amounts only.
 */
@Injectable()
export class TaxProofsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly salaries: SalariesService,
    private readonly notifications: NotificationsService,
  ) {}

  /** One employee's proofs for a year, with declared vs. submitted vs. accepted per section. */
  async forEmployee(auth: AuthContext, employeeId: string | null, fy?: number) {
    const employee = await this.salaries.declarationOwner(auth, employeeId);
    const year = fy ?? (await this.salaries.currentFinancialYear(auth.organizationId!));
    const [declaration, rows] = await Promise.all([
      this.salaries.declaration(employee.id, year),
      TaxDeclarationProof.findAll({ where: { employeeId: employee.id, financialYear: year }, order: [['createdAt', 'DESC']] }),
    ]);
    const declared: Record<TaxProofSection, number> = {
      '80C': declaration.section80c,
      '80CCD1B': declaration.section80ccd1b,
      '80D': declaration.section80d,
      HRA: declaration.rentPaidAnnual,
      HOME_LOAN: declaration.homeLoanInterest,
    };
    const reviewers = await this.names(rows.map((r) => r.reviewedById));
    return {
      employee: { id: employee.id, name: fullName(employee), employeeCode: employee.employeeCode },
      financialYear: year,
      regime: declaration.regime,
      sections: TAX_PROOF_SECTIONS.map((s) => {
        const mine = rows.filter((r) => r.section === s);
        return {
          section: s,
          label: TAX_PROOF_SECTION_LABELS[s],
          declared: declared[s],
          submitted: round(mine.filter((r) => r.status !== 'REJECTED').reduce((n, r) => n + Number(r.amount), 0)),
          accepted: round(mine.filter((r) => r.status === 'ACCEPTED').reduce((n, r) => n + Number(r.acceptedAmount), 0)),
        };
      }),
      proofs: rows.map((r) => this.present(r, reviewers)),
    };
  }

  async upload(auth: AuthContext, dto: UploadProofDto, file: UploadedReceipt | undefined) {
    const employee = await this.salaries.declarationOwner(auth, null);
    const current = await this.salaries.currentFinancialYear(auth.organizationId!);
    const year = dto.fy ?? current;
    if (year < current - 1 || year > current) throw AppError.validation([{ field: 'fy', message: 'Proofs can be submitted for the current financial year (or the one just ended)' }]);
    if (!file) throw AppError.validation([{ field: 'file', message: 'Attach the proof' }]);
    if (file.size > TAX_PROOF_MAX_BYTES) throw AppError.validation([{ field: 'file', message: 'The proof must be 5 MB or smaller' }]);
    const type = detectDocumentType(file.buffer);
    if (!type) throw AppError.validation([{ field: 'file', message: 'Upload the proof as a PDF, PNG, JPG or WebP file' }]);
    const key = `organizations/${auth.organizationId}/tax-proofs/${employee.id}/${randomUUID()}`;
    await this.storage.put(key, file.buffer, type);
    try {
      const row = await this.db.transaction(async (transaction) => {
        const created = await TaxDeclarationProof.create(
          {
            organizationId: auth.organizationId!,
            employeeId: employee.id,
            financialYear: year,
            section: dto.section,
            description: dto.description,
            amount: String(dto.amount),
            storageKey: key,
            fileName: safeFileName(file.originalname, dto.description, type),
            contentType: type,
            byteSize: file.size,
            uploadedById: auth.userId,
          },
          { transaction },
        );
        await this.audit.record(
          {
            action: 'payroll.tax_proof_submitted',
            entityType: 'TaxDeclarationProof',
            entityId: created.id,
            summary: `${dto.section} proof of ${money(dto.amount)} submitted for FY ${year}-${(year + 1) % 100}`,
          },
          transaction,
        );
        return created;
      });
      return this.present(row, new Map());
    } catch (e) {
      await this.storage.deleteQuietly([key]);
      throw e;
    }
  }

  /** The employee withdraws a proof that hasn't been reviewed. */
  async remove(auth: AuthContext, id: string) {
    const self = await this.salaries.declarationOwner(auth, null);
    const row = await TaxDeclarationProof.findByPk(id);
    if (!row || row.employeeId !== self.id) throw AppError.notFound('Proof');
    if (row.status !== 'SUBMITTED') throw AppError.conflict('Reviewed proofs stay on record');
    await this.db.transaction(async (transaction) => {
      await row.destroy({ transaction });
      await this.audit.record({ action: 'payroll.tax_proof_withdrawn', entityType: 'TaxDeclarationProof', entityId: id, summary: `${row.section} proof withdrawn` }, transaction);
    });
    await this.storage.deleteQuietly([row.storageKey]);
  }

  /** Review queue for payroll (`payroll.process`). */
  async list(auth: AuthContext, query: ProofQueryDto) {
    const year = query.fy ?? (await this.salaries.currentFinancialYear(auth.organizationId!));
    const filters: WhereOptions[] = [{ financialYear: year }];
    if (query.status) filters.push({ status: query.status });
    const employeeWhere = query.search
      ? {
          [Op.or]: [
            { firstName: { [Op.iLike]: containsPattern(query.search) } },
            { lastName: { [Op.iLike]: containsPattern(query.search) } },
            { employeeCode: { [Op.iLike]: containsPattern(query.search) } },
          ],
        }
      : undefined;
    const { rows, count } = await TaxDeclarationProof.findAndCountAll({
      where: { [Op.and]: filters },
      include: [{ model: Employee, attributes: ['id', 'firstName', 'lastName', 'employeeCode'], ...(employeeWhere ? { where: employeeWhere } : {}) }],
      order: [
        [literal(`CASE WHEN "TaxDeclarationProof"."status" = 'SUBMITTED' THEN 0 ELSE 1 END`), 'ASC'],
        ['createdAt', 'ASC'],
      ],
      ...paginationArgs(query),
    });
    const reviewers = await this.names(rows.map((r) => r.reviewedById));
    return new PaginatedResult(
      rows.map((r) => ({ ...this.present(r, reviewers), employee: r.employee ? { id: r.employee.id, name: fullName(r.employee), employeeCode: r.employee.employeeCode } : null })),
      paginationMeta(query, count),
    );
  }

  async accept(auth: AuthContext, id: string, dto: AcceptProofDto) {
    const row = await this.reviewable(auth, id);
    const amount = dto.amount ?? Number(row.amount);
    if (amount > Number(row.amount)) throw AppError.validation([{ field: 'amount', message: `Accept at most the ${money(Number(row.amount))} claimed` }]);
    await this.db.transaction(async (transaction) => {
      await row.update({ status: 'ACCEPTED', acceptedAmount: String(amount), reviewNote: dto.note ?? null, reviewedById: auth.userId, reviewedAt: new Date() }, { transaction });
      await this.audit.record(
        { action: 'payroll.tax_proof_accepted', entityType: 'TaxDeclarationProof', entityId: id, summary: `${row.section} proof accepted for ${money(amount)} of ${money(Number(row.amount))}` },
        transaction,
      );
      await this.tell(
        row,
        amount === Number(row.amount) ? `Your ${row.section} proof (${money(amount)}) was accepted` : `Your ${row.section} proof was accepted for ${money(amount)} of ${money(Number(row.amount))}`,
        dto.note ?? undefined,
        auth,
        transaction,
      );
    });
    return this.present(row, await this.names([row.reviewedById]));
  }

  async reject(auth: AuthContext, id: string, dto: RejectProofDto) {
    const row = await this.reviewable(auth, id);
    await this.db.transaction(async (transaction) => {
      await row.update({ status: 'REJECTED', acceptedAmount: null, reviewNote: dto.note, reviewedById: auth.userId, reviewedAt: new Date() }, { transaction });
      await this.audit.record(
        { action: 'payroll.tax_proof_rejected', entityType: 'TaxDeclarationProof', entityId: id, summary: `${row.section} proof of ${money(Number(row.amount))} rejected` },
        transaction,
      );
      await this.tell(row, `Your ${row.section} proof (${money(Number(row.amount))}) was not accepted`, dto.note, auth, transaction);
    });
    return this.present(row, await this.names([row.reviewedById]));
  }

  async file(auth: AuthContext, id: string): Promise<{ stream: Readable; fileName: string; contentType: string; size: number }> {
    const row = await TaxDeclarationProof.findByPk(id);
    if (!row) throw AppError.notFound('Proof');
    const owner = await this.salaries.declarationOwner(auth, row.employeeId).catch(() => null);
    if (!owner) throw AppError.notFound('Proof');
    const stream = await this.storage.get(row.storageKey);
    if (owner.membershipId !== auth.membershipId)
      await this.audit.record({ action: 'payroll.tax_proof_viewed', entityType: 'TaxDeclarationProof', entityId: id, summary: `${row.section} proof opened` });
    return { stream, fileName: row.fileName, contentType: row.contentType, size: row.byteSize };
  }

  private async reviewable(auth: AuthContext, id: string) {
    if (!auth.permissions.has('payroll.process')) throw AppError.forbidden();
    const row = await TaxDeclarationProof.findByPk(id, { include: [{ model: Employee, attributes: ['id', 'membershipId'] }] });
    if (!row) throw AppError.notFound('Proof');
    if (row.employee?.membershipId && row.employee.membershipId === auth.membershipId) throw AppError.forbidden("You can't review your own proofs");
    if (row.status !== 'SUBMITTED') throw AppError.conflict(`This proof was already ${row.status.toLowerCase()}`);
    return row;
  }

  private async tell(row: TaxDeclarationProof, title: string, body: string | undefined, auth: AuthContext, transaction: import('sequelize').Transaction) {
    const userId = (await userIdsOf([row.employeeId], transaction)).get(row.employeeId);
    if (!userId || userId === auth.userId) return;
    await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'payroll.tax_proof', title, body, link: '/me/salary?tab=tax' }, transaction);
  }

  private present(r: TaxDeclarationProof, reviewers: Map<string, string>) {
    return {
      id: r.id,
      financialYear: r.financialYear,
      section: r.section,
      sectionLabel: TAX_PROOF_SECTION_LABELS[r.section],
      description: r.description,
      amount: Number(r.amount),
      acceptedAmount: r.acceptedAmount === null ? null : Number(r.acceptedAmount),
      status: r.status,
      reviewNote: r.reviewNote,
      reviewedBy: r.reviewedById ? (reviewers.get(r.reviewedById) ?? 'Former user') : null,
      reviewedAt: r.reviewedAt,
      file: { name: r.fileName, contentType: r.contentType, size: r.byteSize },
      createdAt: r.createdAt,
    };
  }

  private async names(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
