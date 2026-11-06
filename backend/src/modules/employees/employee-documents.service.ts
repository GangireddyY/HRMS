import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Op } from 'sequelize';
import { DOCUMENT_MAX_BYTES, type DocumentContentType } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { Department, Employee, EmployeeDocument, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { ReviewDocumentDto, UpdateDocumentDto, UploadDocumentDto } from './dto/employees.dto';
import { EmployeeScopeService } from './employee-scope.service';

/** Hard cap while streaming the upload; anything between this and DOCUMENT_MAX_BYTES gets a friendly message. */
export const DOCUMENT_UPLOAD_LIMIT_BYTES = DOCUMENT_MAX_BYTES + 1024 * 1024;
const MAX_DOCUMENTS_PER_EMPLOYEE = 100;
const EXTENSION: Record<DocumentContentType, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export interface UploadedDocumentFile {
  buffer: Buffer;
  size: number;
  originalname: string;
}

/** Reads the type from the file's own signature, never from the client-supplied name or MIME type. */
export function detectDocumentType(data: Buffer): DocumentContentType | null {
  if (data.length >= 5 && data.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** A display-safe file name: no path, no control or reserved characters, and the extension matches the detected type. */
export function safeFileName(original: string, title: string, type: DocumentContentType): string {
  const base = (original.split(/[\\/]/).pop() ?? '')
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '')
    .replace(/\.[^.]*$/, '')
    .trim()
    .slice(0, 200);
  const stem = base || title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 200) || 'document';
  return `${stem}.${EXTENSION[type]}`;
}

const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();
const today = () => new Date().toISOString().slice(0, 10);

type Access = { employee: Employee; isSelf: boolean; canManage: boolean };

/**
 * Employee documents. The employee sees and uploads their own (pending until HR verifies them);
 * HR with employee.document.manage in scope uploads (verified on upload), reviews, edits and deletes.
 * Nobody verifies their own documents.
 */
@Injectable()
export class EmployeeDocumentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(auth: AuthContext, employeeId: string) {
    await this.access(auth, employeeId, 'read');
    const rows = await EmployeeDocument.findAll({ where: { employeeId }, order: [['createdAt', 'DESC']] });
    return this.present(rows);
  }

  async upload(auth: AuthContext, employeeId: string, file: UploadedDocumentFile | undefined, dto: UploadDocumentDto) {
    const { employee, canManage } = await this.access(auth, employeeId, 'upload');
    if (!file?.buffer?.length) throw AppError.validation([{ field: 'file', message: 'Choose a file to upload' }]);
    if (file.size > DOCUMENT_MAX_BYTES) throw AppError.validation([{ field: 'file', message: 'Documents must be 10 MB or smaller' }]);
    const contentType = detectDocumentType(file.buffer);
    if (!contentType) throw AppError.validation([{ field: 'file', message: 'Upload a PDF, PNG, JPG or WebP file' }]);
    if ((await EmployeeDocument.count({ where: { employeeId } })) >= MAX_DOCUMENTS_PER_EMPLOYEE) {
      throw AppError.conflict(`An employee can have up to ${MAX_DOCUMENTS_PER_EMPLOYEE} documents. Remove old ones first.`);
    }

    const id = randomUUID();
    const storageKey = `organizations/${auth.organizationId}/employees/${employee.id}/documents/${id}`;
    const verified = canManage;
    await this.storage.put(storageKey, file.buffer, contentType);
    try {
      const row = await this.db.transaction(async (transaction) => {
        const created = await EmployeeDocument.create(
          {
            id,
            organizationId: auth.organizationId!,
            employeeId: employee.id,
            category: dto.category,
            title: dto.title,
            fileName: safeFileName(file.originalname ?? '', dto.title, contentType),
            contentType,
            byteSize: file.size,
            checksum: createHash('sha256').update(file.buffer).digest('hex'),
            storageKey,
            expiryDate: dto.expiryDate ?? null,
            status: verified ? 'VERIFIED' : 'PENDING',
            reviewedAt: verified ? new Date() : null,
            reviewedById: verified ? auth.userId : null,
            createdById: auth.userId,
            updatedById: auth.userId,
          },
          { transaction },
        );
        await this.audit.record(
          { action: 'employee.document_uploaded', entityType: 'Employee', entityId: employee.id, summary: `Document "${dto.title}" uploaded`, metadata: { documentId: id, category: dto.category, contentType, byteSize: file.size } },
          transaction,
        );
        return created;
      });
      return (await this.present([row]))[0]!;
    } catch (e) {
      await this.storage.deleteQuietly([storageKey]);
      throw e;
    }
  }

  async update(auth: AuthContext, employeeId: string, documentId: string, dto: UpdateDocumentDto) {
    const access = await this.access(auth, employeeId, 'read');
    const doc = await this.find(employeeId, documentId);
    this.assertCanChange(auth, access, doc);
    await this.db.transaction(async (transaction) => {
      await doc.update({ ...dto, updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'employee.document_updated', entityType: 'Employee', entityId: employeeId, summary: `Document "${doc.title}" updated`, metadata: { documentId } }, transaction);
    });
    return (await this.present([doc]))[0]!;
  }

  async review(auth: AuthContext, employeeId: string, documentId: string, dto: ReviewDocumentDto) {
    const { isSelf, canManage } = await this.access(auth, employeeId, 'read');
    if (!canManage) throw AppError.forbidden();
    if (isSelf) throw AppError.forbidden('You cannot verify your own documents');
    if (dto.status === 'REJECTED' && !dto.note) throw AppError.validation([{ field: 'note', message: 'Tell the employee why the document was rejected' }]);
    const doc = await this.find(employeeId, documentId);
    if (doc.status !== 'PENDING') throw AppError.conflict('This document has already been reviewed');
    await this.db.transaction(async (transaction) => {
      await doc.update({ status: dto.status, reviewNote: dto.note ?? null, reviewedAt: new Date(), reviewedById: auth.userId, updatedById: auth.userId }, { transaction });
      await this.audit.record(
        { action: `employee.document_${dto.status === 'VERIFIED' ? 'verified' : 'rejected'}`, entityType: 'Employee', entityId: employeeId, summary: `Document "${doc.title}" ${dto.status.toLowerCase()}`, metadata: { documentId } },
        transaction,
      );
      if (doc.createdById && doc.createdById !== auth.userId) {
        await this.notifications.notify(
          doc.createdById,
          {
            organizationId: auth.organizationId,
            type: 'employee.document',
            title: `Your document "${doc.title}" was ${dto.status === 'VERIFIED' ? 'verified' : 'rejected'}`,
            body: dto.note ?? undefined,
            link: '/me/employment?tab=documents',
          },
          transaction,
        );
      }
    });
    return (await this.present([doc]))[0]!;
  }

  async download(auth: AuthContext, employeeId: string, documentId: string): Promise<{ doc: EmployeeDocument; stream: Readable }> {
    const { isSelf } = await this.access(auth, employeeId, 'read');
    const doc = await this.find(employeeId, documentId);
    const stream = await this.storage.get(doc.storageKey);
    if (!isSelf) {
      await this.audit.record({ action: 'employee.document_downloaded', entityType: 'Employee', entityId: employeeId, summary: `Document "${doc.title}" opened`, metadata: { documentId } });
    }
    return { doc, stream };
  }

  async remove(auth: AuthContext, employeeId: string, documentId: string): Promise<void> {
    const access = await this.access(auth, employeeId, 'read');
    const doc = await this.find(employeeId, documentId);
    this.assertCanChange(auth, access, doc);
    await this.db.transaction(async (transaction) => {
      await doc.destroy({ transaction });
      await this.audit.record({ action: 'employee.document_deleted', entityType: 'Employee', entityId: employeeId, summary: `Document "${doc.title}" deleted`, metadata: { documentId } }, transaction);
    });
    await this.storage.deleteQuietly([doc.storageKey]);
  }

  /** Documents in the caller's employee.document.manage scope that expired or expire within `days`. */
  async expiring(auth: AuthContext, days = 30) {
    const scoped = await this.scope.where(auth, 'employee.document.manage', 'employeeId');
    if (!scoped) return [];
    const until = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const rows = await EmployeeDocument.findAll({
      where: { [Op.and]: [scoped, { expiryDate: { [Op.lte]: until } }, { status: { [Op.ne]: 'REJECTED' } }] },
      include: [{ model: Employee, attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'status'], where: { status: ['ACTIVE', 'ON_NOTICE'] }, include: [{ model: Department, attributes: ['id', 'name'] }] }],
      order: [['expiryDate', 'ASC']],
      limit: 500,
    });
    return rows.map((d) => ({
      id: d.id,
      title: d.title,
      category: d.category,
      expiryDate: d.expiryDate,
      expired: d.expiryDate! < today(),
      employee: { id: d.employee!.id, name: fullName(d.employee!), employeeCode: d.employee!.employeeCode, department: d.employee!.department?.name ?? null },
    }));
  }

  // ---------------------------------------------------------------------------------------------

  private async access(auth: AuthContext, employeeId: string, mode: 'read' | 'upload'): Promise<Access> {
    const employee = await Employee.findByPk(employeeId, { attributes: ['id', 'organizationId', 'managerId', 'departmentId', 'firstName', 'lastName'] });
    if (!employee || !(await this.scope.covers(auth, 'employee.view', employee))) throw AppError.notFound('Employee');
    const self = await this.scope.self(auth);
    const isSelf = self?.id === employee.id;
    const canManage = !isSelf && (await this.scope.covers(auth, 'employee.document.manage', employee));
    const selfAllowed = isSelf && (mode === 'read' || auth.permissions.has('self.profile.update'));
    // HR managing their own record goes through self-service like everyone else (no self-verification).
    if (!canManage && !selfAllowed) throw isSelf ? AppError.forbidden() : AppError.forbidden('You do not have permission to manage this employee’s documents');
    return { employee, isSelf, canManage };
  }

  /** HR may change any document; the employee only their own uploads that are not verified yet. */
  private assertCanChange(auth: AuthContext, access: Access, doc: EmployeeDocument): void {
    if (access.canManage) return;
    if (access.isSelf && doc.createdById === auth.userId && doc.status !== 'VERIFIED' && auth.permissions.has('self.profile.update')) return;
    throw AppError.forbidden(access.isSelf ? 'Verified documents can only be changed by HR' : undefined);
  }

  private async find(employeeId: string, id: string): Promise<EmployeeDocument> {
    const doc = await EmployeeDocument.findOne({ where: { id, employeeId } });
    if (!doc) throw AppError.notFound('Document');
    return doc;
  }

  private async present(rows: EmployeeDocument[]) {
    const ids = [...new Set(rows.flatMap((r) => [r.createdById, r.reviewedById]).filter((x): x is string => !!x))];
    const names = new Map((ids.length ? await User.findAll({ where: { id: ids }, attributes: ['id', 'firstName', 'lastName'] }) : []).map((u) => [u.id, fullName(u)]));
    return rows.map((d) => ({
      id: d.id,
      category: d.category,
      title: d.title,
      fileName: d.fileName,
      contentType: d.contentType,
      byteSize: d.byteSize,
      expiryDate: d.expiryDate,
      status: d.status,
      reviewNote: d.reviewNote,
      reviewedAt: d.reviewedAt,
      reviewedBy: d.reviewedById ? (names.get(d.reviewedById) ?? null) : null,
      uploadedBy: d.createdById ? (names.get(d.createdById) ?? null) : null,
      uploadedById: d.createdById,
      createdAt: d.createdAt,
    }));
  }
}
