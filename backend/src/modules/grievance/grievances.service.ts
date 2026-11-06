import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import {
  GRIEVANCE_ATTACHMENT_MAX_BYTES,
  GRIEVANCE_MAX_ATTACHMENTS,
  GRIEVANCE_RESOLUTION_DAYS,
  OPEN_GRIEVANCE_STATUSES,
  type GrievanceOutcome,
  type GrievanceStatus,
  type GrievanceVisibility,
} from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { PaginationQueryDto, paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { addDays, zonedParts } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { Department, Designation, Employee, GrievanceAttachment, GrievanceCase, GrievanceEvent, GrievanceNote, Organization, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { detectDocumentType, safeFileName } from '../employees/employee-documents.service';
import { fullName, organizationToday, personRef, userIdsOf, usersWithPermission } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AssignDto, AttachmentDto, GrievanceDto, GrievanceQueryDto, GrievanceView, NoteDto, ReasonDto, ReopenDto, ResolveDto, UpdateGrievanceDto } from './dto/grievance.dto';
import { acceptsUpdates, closeBlocker, dueDate, isOpen, isOverdue, isPosh, poshAnnualReport, poshFiling, reopenBlocker, reopenUntil } from './grievance-rules';

const VIEW = 'grievance.view';
const MANAGE = 'grievance.manage';
const POSH = 'grievance.posh.access';
const PERSON = ['id', 'employeeCode', 'firstName', 'lastName', 'departmentId', 'designationId'];
const personInclude = () => [
  { model: Department, attributes: ['id', 'name'] },
  { model: Designation, attributes: ['id', 'name'] },
];
const OUTCOME_LABELS: Record<GrievanceOutcome, string> = { UPHELD: 'Upheld', PARTIALLY_UPHELD: 'Partially upheld', NOT_UPHELD: 'Not upheld', SETTLED: 'Settled' };

/** Encrypted complaint details. */
interface Details {
  description: string;
  witnesses: string | null;
  delayReason: string | null;
  interimRelief: string | null;
  conciliationRequested: boolean;
}
/** Encrypted resolution: the summary is shared with the complainant, the actions are internal. */
interface Resolution {
  summary: string;
  actions: string | null;
}

/**
 * How the caller relates to a case: its complainant, or someone handling it.
 * `manage` = may assign, investigate and resolve (grievance.manage; for POSH cases grievance.posh.access).
 */
interface Access {
  complainant: boolean;
  manage: boolean;
}

export interface UploadedEvidence {
  buffer: Buffer;
  size: number;
  originalname: string;
}

const people = (e: Employee | null | undefined) => (e ? { ...personRef(e)!, department: e.department?.name ?? null, designation: e.designation?.name ?? null } : null);

/**
 * Grievances and POSH complaints.
 *  - Employees raise cases about themselves (`grievance.submit`) and follow them; they never see internal notes.
 *  - Grievances: `grievance.manage` sees and handles every one; `grievance.view` sees the cases assigned to them.
 *  - POSH complaints: only the Internal Committee (`grievance.posh.access`, a restricted permission) — never HR or
 *    Organization Admin. References are numbered separately so gaps don't reveal them.
 *  - Nobody handles a case they are the complainant or respondent of.
 * Complaint details, notes and resolutions are stored encrypted; audit entries carry only the case reference.
 */
@Injectable()
export class GrievancesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly encryption: EncryptionService,
  ) {}

  // ---- Complainant ------------------------------------------------------------------------------

  async create(auth: AuthContext, dto: GrievanceDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees can raise grievances');
    if (self.status === 'EXITED') throw AppError.forbidden('You have exited the organization');
    const today = await organizationToday(auth.organizationId!);
    const posh = isPosh(dto.category);
    const problems: { field: string; message: string }[] = [];
    if (dto.incidentDate && dto.incidentDate > today) problems.push({ field: 'incidentDate', message: "The incident date can't be in the future" });
    if (dto.respondentId) {
      if (dto.respondentId === self.id) problems.push({ field: 'respondentId', message: "You can't name yourself" });
      else if (!(await Employee.count({ where: { id: dto.respondentId } }))) problems.push({ field: 'respondentId', message: 'Choose a colleague from the directory' });
    }
    if (posh && poshFiling(dto.incidentDate ?? null, today) !== 'ON_TIME' && !dto.delayReason) {
      problems.push({ field: 'delayReason', message: 'Explain why the complaint is made more than 3 months after the incident' });
    }
    if (problems.length) throw AppError.validation(problems);
    const details: Details = {
      description: dto.description,
      witnesses: dto.witnesses ?? null,
      delayReason: posh ? (dto.delayReason ?? null) : null,
      interimRelief: posh ? (dto.interimRelief ?? null) : null,
      conciliationRequested: posh && !!dto.conciliationRequested,
    };
    const c = await this.db.transaction(async (transaction) => {
      // Serializes reference numbering per organization.
      await Organization.findByPk(auth.organizationId!, { attributes: ['id'], transaction, lock: transaction.LOCK.NO_KEY_UPDATE });
      const created = await GrievanceCase.create(
        {
          organizationId: auth.organizationId!,
          reference: await this.nextReference(posh, transaction),
          category: dto.category,
          subject: dto.subject,
          detailsEncrypted: this.seal(details),
          complainantId: self.id,
          respondentId: dto.respondentId ?? null,
          respondentName: dto.respondentName ?? null,
          incidentDate: dto.incidentDate ?? null,
          incidentLocation: dto.incidentLocation ?? null,
          submittedOn: today,
          dueOn: dueDate(dto.category, today),
          createdById: auth.userId,
        },
        { transaction },
      );
      await this.event(created, auth, 'SUBMITTED', { to: 'SUBMITTED' }, transaction);
      await this.record(created, 'submitted', 'submitted', transaction);
      for (const userId of await this.eligibleHandlers(created, transaction)) {
        if (userId === auth.userId) continue;
        await this.notifications.notify(
          userId,
          { organizationId: auth.organizationId, type: 'grievance.case', title: `New ${posh ? 'POSH complaint' : 'grievance'} ${created.reference}`, link: `/hr/grievances/${created.id}` },
          transaction,
        );
      }
      return created;
    });
    return this.get(auth, c.id);
  }

  async mine(auth: AuthContext, query: PaginationQueryDto) {
    const self = await this.scope.self(auth);
    if (!self) return new PaginatedResult([], paginationMeta(query, 0));
    const { rows, count } = await GrievanceCase.findAndCountAll({ where: { complainantId: self.id }, order: [['createdAt', 'DESC']], ...paginationArgs(query) });
    const today = await organizationToday(auth.organizationId!);
    const users = await this.userNames(rows.map((r) => r.assigneeUserId));
    return new PaginatedResult(
      rows.map((c) => this.summary(c, today, users, true)),
      paginationMeta(query, count),
    );
  }

  async withdraw(auth: AuthContext, id: string, dto: ReasonDto) {
    await this.mutate(auth, id, 'complainant', async (c, transaction) => {
      if (!isOpen(c.status)) throw AppError.conflict('Only an open case can be withdrawn');
      const from = c.status;
      await c.update({ status: 'WITHDRAWN', withdrawnAt: new Date() }, { transaction });
      if (dto.reason) await this.addNoteRow(c, auth, true, 'SHARED', `Withdrawn: ${dto.reason}`, transaction);
      await this.event(c, auth, 'WITHDRAWN', { from, to: 'WITHDRAWN' }, transaction);
      await this.record(c, 'withdrawn', 'withdrawn by the complainant', transaction);
      await this.notifyHandlers(c, `${c.reference} was withdrawn`, auth, transaction);
    });
    return this.get(auth, id);
  }

  async accept(auth: AuthContext, id: string) {
    await this.mutate(auth, id, 'complainant', async (c, transaction) => {
      if (c.status !== 'RESOLVED') throw AppError.conflict('Only a resolved case can be accepted');
      const now = new Date();
      await c.update({ status: 'CLOSED', acceptedAt: now, closedAt: now }, { transaction });
      await this.event(c, auth, 'ACCEPTED', { from: 'RESOLVED', to: 'CLOSED', detail: 'Resolution accepted' }, transaction);
      await this.record(c, 'accepted', 'resolution accepted by the complainant', transaction);
      await this.notifyHandlers(c, `${c.reference}: the resolution was accepted`, auth, transaction);
    });
    return this.get(auth, id);
  }

  async reopen(auth: AuthContext, id: string, dto: ReopenDto) {
    await this.mutate(auth, id, 'complainant', async (c, transaction) => {
      const today = await organizationToday(c.organizationId);
      const blocker = reopenBlocker(c, today);
      if (blocker) throw AppError.conflict(blocker);
      // The previous resolution stays readable until the case is resolved again.
      await c.update({ status: 'IN_REVIEW', reopened: true, outcome: null, resolvedOn: null, acceptedAt: null, dueOn: addDays(today, GRIEVANCE_RESOLUTION_DAYS) }, { transaction });
      await this.addNoteRow(c, auth, true, 'SHARED', `Asked to reopen: ${dto.reason}`, transaction);
      await this.event(c, auth, 'REOPENED', { from: 'RESOLVED', to: 'IN_REVIEW' }, transaction);
      await this.record(c, 'reopened', 'reopened at the complainant’s request', transaction);
      await this.notifyHandlers(c, `${c.reference} was reopened by the complainant`, auth, transaction);
    });
    return this.get(auth, id);
  }

  /** Active colleagues the complaint can be about: names and roles only. */
  async colleagues(auth: AuthContext, search?: string) {
    const self = await this.scope.self(auth);
    const like = search ? containsPattern(search) : null;
    const rows = await Employee.findAll({
      where: {
        status: ['ACTIVE', 'ON_NOTICE'],
        ...(self ? { id: { [Op.ne]: self.id } } : {}),
        ...(like ? { [Op.or]: [{ firstName: { [Op.iLike]: like } }, { lastName: { [Op.iLike]: like } }, { employeeCode: { [Op.iLike]: like } }] } : {}),
      },
      attributes: PERSON,
      include: personInclude(),
      order: [
        ['firstName', 'ASC'],
        ['lastName', 'ASC'],
      ],
      limit: 20,
    });
    return rows.map(people);
  }

  /** Internal Committee members (names only), so employees know who handles POSH complaints. */
  async committee() {
    const ids = await usersWithPermission(POSH);
    const users = ids.length ? await User.findAll({ where: { id: ids }, attributes: ['id', 'firstName', 'lastName'], order: [['firstName', 'ASC']] }) : [];
    return users.map((u) => ({ name: fullName(u) }));
  }

  // ---- Handling ---------------------------------------------------------------------------------

  async list(auth: AuthContext, query: GrievanceQueryDto) {
    const today = await organizationToday(auth.organizationId!);
    const conditions: WhereOptions[] = [await this.handlerWhere(auth, query.view ?? 'assigned')];
    if (query.status === 'OPEN') conditions.push({ status: OPEN_GRIEVANCE_STATUSES });
    else if (query.status) conditions.push({ status: query.status });
    if (query.category) conditions.push({ category: query.category });
    if (query.priority) conditions.push({ priority: query.priority });
    if (query.unassigned) conditions.push({ assigneeUserId: null });
    if (query.overdue) conditions.push({ status: OPEN_GRIEVANCE_STATUSES, dueOn: { [Op.lt]: today } });
    if (query.search) {
      const like = containsPattern(query.search);
      conditions.push({ [Op.or]: [{ reference: { [Op.iLike]: like } }, { subject: { [Op.iLike]: like } }] });
    }
    const where = { [Op.and]: conditions };
    const count = await GrievanceCase.count({ where });
    const rows = await GrievanceCase.findAll({
      where,
      include: [
        { model: Employee, as: 'complainant', attributes: PERSON, include: personInclude() },
        { model: Employee, as: 'respondent', attributes: PERSON },
      ],
      order: [['createdAt', 'DESC']],
      ...paginationArgs(query),
    });
    const users = await this.userNames(rows.map((r) => r.assigneeUserId));
    return new PaginatedResult(
      rows.map((c) => ({ ...this.summary(c, today, users, false), complainant: people(c.complainant), respondent: c.respondent ? personRef(c.respondent) : null, respondentName: c.respondentName })),
      paginationMeta(query, count),
    );
  }

  /** Open / overdue / unassigned counts for each list the caller can see. */
  async stats(auth: AuthContext) {
    const today = await organizationToday(auth.organizationId!);
    const views: GrievanceView[] = [];
    if ([VIEW, MANAGE, POSH].some((p) => auth.permissions.has(p))) views.push('assigned');
    if (auth.permissions.has(MANAGE)) views.push('all');
    if (auth.permissions.has(POSH)) views.push('posh');
    const out: Partial<Record<GrievanceView, { open: number; overdue: number; unassigned?: number }>> = {};
    for (const view of views) {
      const base = await this.handlerWhere(auth, view);
      const open = { [Op.and]: [base, { status: OPEN_GRIEVANCE_STATUSES }] };
      out[view] = {
        open: await GrievanceCase.count({ where: open }),
        overdue: await GrievanceCase.count({ where: { [Op.and]: [open, { dueOn: { [Op.lt]: today } }] } }),
        ...(view === 'assigned' ? {} : { unassigned: await GrievanceCase.count({ where: { [Op.and]: [open, { assigneeUserId: null }] } }) }),
      };
    }
    return out;
  }

  async get(auth: AuthContext, id: string) {
    const c = await this.find(id);
    return this.present(c, await this.access(auth, c));
  }

  /** People the case can be assigned to: grievance handlers, or Internal Committee members for POSH — never anyone involved. */
  async handlers(auth: AuthContext, id: string) {
    const c = await this.find(id);
    if (!(await this.access(auth, c)).manage) throw AppError.forbidden();
    const ids = await this.candidates(c);
    const users = ids.length ? await User.findAll({ where: { id: ids }, attributes: ['id', 'firstName', 'lastName', 'email'], order: [['firstName', 'ASC']] }) : [];
    return users.map((u) => ({ id: u.id, name: fullName(u), email: u.email }));
  }

  async assign(auth: AuthContext, id: string, dto: AssignDto) {
    await this.mutate(auth, id, 'manage', async (c, transaction) => {
      if (!isOpen(c.status)) throw AppError.conflict('Only an open case can be assigned');
      const to = dto.assigneeUserId ?? null;
      if (to && !(await this.candidates(c, transaction)).includes(to)) {
        throw AppError.validation([
          { field: 'assigneeUserId', message: isPosh(c.category) ? 'Choose a member of the Internal Committee who is not involved in the case' : 'Choose someone who handles grievances and is not involved in the case' },
        ]);
      }
      if (to === c.assigneeUserId) return;
      const from = c.status;
      const acknowledging = from === 'SUBMITTED' && !!to;
      await c.update({ assigneeUserId: to, ...(acknowledging ? { status: 'IN_REVIEW' as const, acknowledgedAt: new Date() } : {}) }, { transaction });
      const name = to ? (await this.userNames([to])).get(to) : null;
      await this.event(c, auth, 'ASSIGNED', { detail: name ? `Assigned to ${name}` : 'Unassigned' }, transaction);
      if (acknowledging) {
        await this.event(c, auth, 'ACKNOWLEDGED', { from, to: 'IN_REVIEW' }, transaction);
        await this.notifyComplainant(c, `Your case ${c.reference} is being reviewed`, transaction);
      }
      await this.record(c, 'assigned', name ? 'assigned' : 'unassigned', transaction, { assigneeUserId: to });
      if (to && to !== auth.userId) {
        await this.notifications.notify(to, { organizationId: c.organizationId, type: 'grievance.case', title: `${c.reference} has been assigned to you`, link: `/hr/grievances/${c.id}` }, transaction);
      }
    });
    return this.get(auth, id);
  }

  async acknowledge(auth: AuthContext, id: string) {
    await this.mutate(auth, id, 'manage', async (c, transaction) => {
      if (c.status !== 'SUBMITTED') throw AppError.conflict('The case has already been acknowledged');
      await c.update({ status: 'IN_REVIEW', acknowledgedAt: new Date() }, { transaction });
      await this.event(c, auth, 'ACKNOWLEDGED', { from: 'SUBMITTED', to: 'IN_REVIEW' }, transaction);
      await this.record(c, 'acknowledged', 'acknowledged', transaction);
      await this.notifyComplainant(c, `Your case ${c.reference} is being reviewed`, transaction);
    });
    return this.get(auth, id);
  }

  async investigate(auth: AuthContext, id: string) {
    await this.mutate(auth, id, 'manage', async (c, transaction) => {
      if (c.status !== 'SUBMITTED' && c.status !== 'IN_REVIEW') throw AppError.conflict('Only a submitted or reviewed case can move to investigation');
      const from = c.status;
      await c.update({ status: 'INVESTIGATING', acknowledgedAt: c.acknowledgedAt ?? new Date() }, { transaction });
      await this.event(c, auth, 'INVESTIGATING', { from, to: 'INVESTIGATING' }, transaction);
      await this.record(c, 'investigating', 'moved to investigation', transaction);
      await this.notifyComplainant(c, `Your case ${c.reference} is under investigation`, transaction);
    });
    return this.get(auth, id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateGrievanceDto) {
    await this.mutate(auth, id, 'manage', async (c, transaction) => {
      if (!acceptsUpdates(c.status)) throw AppError.conflict('A closed case can no longer change');
      if (dto.priority === c.priority) return;
      const before = c.priority;
      await c.update({ priority: dto.priority }, { transaction });
      await this.event(c, auth, 'PRIORITY', { detail: `Priority set to ${dto.priority.toLowerCase()}`, internal: true }, transaction);
      await this.audit.record({ action: 'grievance.priority_changed', entityType: 'GrievanceCase', entityId: c.id, summary: `${c.reference} priority changed`, changes: { priority: { from: before, to: dto.priority } } }, transaction);
    });
    return this.get(auth, id);
  }

  async resolve(auth: AuthContext, id: string, dto: ResolveDto) {
    await this.mutate(auth, id, 'manage', async (c, transaction) => {
      if (c.status === 'SUBMITTED') throw AppError.conflict('Acknowledge the case before resolving it');
      if (c.status !== 'IN_REVIEW' && c.status !== 'INVESTIGATING') throw AppError.conflict('Only an open case can be resolved');
      if (isPosh(c.category) && dto.outcome === 'SETTLED' && !this.open<Details>(c.detailsEncrypted).conciliationRequested) {
        throw AppError.validation([{ field: 'outcome', message: 'A POSH complaint can only be settled by conciliation at the complainant’s request (section 10)' }]);
      }
      const from = c.status;
      const today = await organizationToday(c.organizationId);
      const resolution: Resolution = { summary: dto.summary, actions: dto.actions ?? null };
      await c.update({ status: 'RESOLVED', outcome: dto.outcome, resolutionEncrypted: this.seal(resolution), resolvedAt: new Date(), resolvedOn: today, resolvedById: auth.userId, acceptedAt: null }, { transaction });
      await this.event(c, auth, 'RESOLVED', { from, to: 'RESOLVED', detail: `Outcome: ${OUTCOME_LABELS[dto.outcome]}` }, transaction);
      await this.record(c, 'resolved', 'resolved', transaction, { outcome: dto.outcome });
      await this.notifyComplainant(c, `Your case ${c.reference} has been resolved`, transaction);
    });
    return this.get(auth, id);
  }

  async close(auth: AuthContext, id: string) {
    await this.mutate(auth, id, 'manage', async (c, transaction) => {
      const blocker = closeBlocker(c, await organizationToday(c.organizationId));
      if (blocker) throw AppError.conflict(blocker);
      await c.update({ status: 'CLOSED', closedAt: new Date() }, { transaction });
      await this.event(c, auth, 'CLOSED', { from: 'RESOLVED', to: 'CLOSED' }, transaction);
      await this.record(c, 'closed', 'closed', transaction);
      await this.notifyComplainant(c, `Your case ${c.reference} has been closed`, transaction);
    });
    return this.get(auth, id);
  }

  async poshReport(auth: AuthContext, year?: number) {
    const org = await Organization.findByPk(auth.organizationId!, { attributes: ['timezone'] });
    const zone = org?.timezone ?? 'UTC';
    const today = zonedParts(new Date(), zone).date;
    const rows = await GrievanceCase.findAll({ where: { category: 'POSH' }, attributes: ['submittedOn', 'resolvedOn', 'withdrawnAt', 'outcome'] });
    const cases = rows.map((r) => ({ submittedOn: r.submittedOn, resolvedOn: r.resolvedOn, withdrawnOn: r.withdrawnAt ? zonedParts(r.withdrawnAt, zone).date : null, outcome: r.outcome }));
    return poshAnnualReport(cases, year ?? Number(today.slice(0, 4)), today);
  }

  // ---- Notes & evidence (complainant and handlers) ----------------------------------------------

  async addNote(auth: AuthContext, id: string, dto: NoteDto) {
    await this.mutate(auth, id, 'any', async (c, transaction, access) => {
      if (!acceptsUpdates(c.status)) throw AppError.conflict('The case is closed');
      const visibility: GrievanceVisibility = access.complainant ? 'SHARED' : (dto.visibility ?? 'SHARED');
      await this.addNoteRow(c, auth, access.complainant, visibility, dto.body, transaction);
      await this.audit.record({ action: 'grievance.note_added', entityType: 'GrievanceCase', entityId: c.id, summary: `${c.reference} note added`, metadata: { visibility } }, transaction);
      if (access.complainant) await this.notifyHandlers(c, `New message from the complainant on ${c.reference}`, auth, transaction);
      else if (visibility === 'SHARED') await this.notifyComplainant(c, `New message on your case ${c.reference}`, transaction);
    });
    return this.get(auth, id);
  }

  async upload(auth: AuthContext, id: string, dto: AttachmentDto, file?: UploadedEvidence) {
    if (!file) throw AppError.validation([{ field: 'file', message: 'Choose a file' }]);
    if (file.size > GRIEVANCE_ATTACHMENT_MAX_BYTES) throw AppError.validation([{ field: 'file', message: 'The file must be 5 MB or smaller' }]);
    const type = detectDocumentType(file.buffer);
    if (!type) throw AppError.validation([{ field: 'file', message: 'Upload a PDF, PNG, JPG or WebP file' }]);
    const c = await this.find(id);
    const access = await this.access(auth, c);
    if (!acceptsUpdates(c.status)) throw AppError.conflict('The case is closed');
    if ((await GrievanceAttachment.count({ where: { caseId: c.id } })) >= GRIEVANCE_MAX_ATTACHMENTS) throw AppError.conflict(`A case can have up to ${GRIEVANCE_MAX_ATTACHMENTS} files`);
    const key = `organizations/${c.organizationId}/grievances/${c.id}/${randomUUID()}`;
    const visibility: GrievanceVisibility = access.complainant ? 'SHARED' : (dto.visibility ?? 'SHARED');
    await this.storage.put(key, file.buffer, type);
    try {
      await this.db.transaction(async (transaction) => {
        await GrievanceAttachment.create(
          {
            organizationId: c.organizationId,
            caseId: c.id,
            uploadedById: auth.userId,
            fromComplainant: access.complainant,
            visibility,
            storageKey: key,
            fileName: safeFileName(file.originalname, 'evidence', type),
            contentType: type,
            sizeBytes: file.size,
          },
          { transaction },
        );
        await this.audit.record({ action: 'grievance.file_added', entityType: 'GrievanceCase', entityId: c.id, summary: `${c.reference} file added`, metadata: { visibility } }, transaction);
      });
    } catch (e) {
      await this.storage.deleteQuietly([key]);
      throw e;
    }
    return this.get(auth, id);
  }

  async download(auth: AuthContext, id: string, attachmentId: string): Promise<{ stream: Readable; fileName: string; contentType: string; size: number }> {
    const c = await this.find(id);
    const access = await this.access(auth, c);
    const file = await GrievanceAttachment.findOne({ where: { id: attachmentId, caseId: c.id } });
    if (!file || (access.complainant && file.visibility !== 'SHARED')) throw AppError.notFound('File');
    const stream = await this.storage.get(file.storageKey);
    if (!access.complainant) await this.audit.record({ action: 'grievance.file_opened', entityType: 'GrievanceCase', entityId: c.id, summary: `${c.reference} file opened`, metadata: { attachmentId } });
    return { stream, fileName: file.fileName, contentType: file.contentType, size: file.sizeBytes };
  }

  // ---- Internals --------------------------------------------------------------------------------

  private async find(id: string, transaction?: Transaction) {
    const c = await GrievanceCase.findByPk(id, transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {});
    if (!c) throw AppError.notFound('Case');
    return c;
  }

  /** Cases the caller is involved in as respondent are invisible to them; anything else they can't handle is "not found". */
  private async access(auth: AuthContext, c: GrievanceCase): Promise<Access> {
    const self = await this.scope.self(auth);
    if (self && c.complainantId === self.id) return { complainant: true, manage: false };
    if (self && c.respondentId === self.id) throw AppError.notFound('Case');
    if (isPosh(c.category)) {
      if (auth.permissions.has(POSH)) return { complainant: false, manage: true };
    } else if (auth.permissions.has(MANAGE)) {
      return { complainant: false, manage: true };
    } else if (auth.permissions.has(VIEW) && c.assigneeUserId === auth.userId) {
      return { complainant: false, manage: false };
    }
    throw AppError.notFound('Case');
  }

  private async mutate(auth: AuthContext, id: string, need: 'complainant' | 'manage' | 'any', fn: (c: GrievanceCase, transaction: Transaction, access: Access) => Promise<void>) {
    await this.db.transaction(async (transaction) => {
      const c = await this.find(id, transaction);
      const access = await this.access(auth, c);
      if (need === 'complainant' && !access.complainant) throw AppError.forbidden('Only the complainant can do this');
      if (need === 'manage' && !access.manage) throw AppError.forbidden(isPosh(c.category) ? 'Only the Internal Committee handles POSH complaints' : 'You can only add notes to this case');
      await fn(c, transaction, access);
    });
  }

  /** Visible cases of a handler list. Throws when the caller can't see that list. */
  private async handlerWhere(auth: AuthContext, view: GrievanceView): Promise<WhereOptions> {
    const posh = auth.permissions.has(POSH);
    const manage = auth.permissions.has(MANAGE);
    const grievances = manage || auth.permissions.has(VIEW);
    let base: WhereOptions;
    if (view === 'posh') {
      if (!posh) throw AppError.forbidden('POSH complaints are only visible to the Internal Committee');
      base = { category: 'POSH' };
    } else if (view === 'all') {
      if (!manage) throw AppError.forbidden();
      base = { category: { [Op.ne]: 'POSH' } };
    } else {
      if (!posh && !grievances) throw AppError.forbidden();
      base = { assigneeUserId: auth.userId, ...(posh && grievances ? {} : posh ? { category: 'POSH' } : { category: { [Op.ne]: 'POSH' } }) };
    }
    const self = await this.scope.self(auth);
    if (!self) return base;
    return { [Op.and]: [base, { complainantId: { [Op.ne]: self.id } }, { [Op.or]: [{ respondentId: null }, { respondentId: { [Op.ne]: self.id } }] }] };
  }

  /** Users of the complainant and respondent (never handlers or recipients of internal updates). */
  private async involved(c: GrievanceCase, transaction?: Transaction): Promise<Set<string>> {
    return new Set((await userIdsOf([c.complainantId, c.respondentId], transaction)).values());
  }

  /** Who may be assigned: grievance handlers (`grievance.manage` / `grievance.view`) or, for POSH, the Internal Committee. */
  private async candidates(c: GrievanceCase, transaction?: Transaction): Promise<string[]> {
    const keys = isPosh(c.category) ? [POSH] : [MANAGE, VIEW];
    const ids = new Set((await Promise.all(keys.map((k) => usersWithPermission(k, transaction)))).flat());
    for (const u of await this.involved(c, transaction)) ids.delete(u);
    return [...ids];
  }

  /** Who is told about new and unassigned cases: grievance managers or the Internal Committee. */
  private async eligibleHandlers(c: GrievanceCase, transaction: Transaction): Promise<string[]> {
    const involved = await this.involved(c, transaction);
    return (await usersWithPermission(isPosh(c.category) ? POSH : MANAGE, transaction)).filter((u) => !involved.has(u));
  }

  private async notifyHandlers(c: GrievanceCase, title: string, auth: AuthContext, transaction: Transaction) {
    const recipients = c.assigneeUserId ? [c.assigneeUserId] : await this.eligibleHandlers(c, transaction);
    for (const userId of recipients) {
      if (userId !== auth.userId) await this.notifications.notify(userId, { organizationId: c.organizationId, type: 'grievance.case', title, link: `/hr/grievances/${c.id}` }, transaction);
    }
  }

  private async notifyComplainant(c: GrievanceCase, title: string, transaction: Transaction) {
    const userId = (await userIdsOf([c.complainantId], transaction)).get(c.complainantId);
    if (userId) await this.notifications.notify(userId, { organizationId: c.organizationId, type: 'grievance.update', title, link: `/me/grievances/${c.id}` }, transaction);
  }

  private async addNoteRow(c: GrievanceCase, auth: AuthContext, fromComplainant: boolean, visibility: GrievanceVisibility, body: string, transaction: Transaction) {
    await GrievanceNote.create({ organizationId: c.organizationId, caseId: c.id, authorUserId: auth.userId, fromComplainant, visibility, bodyEncrypted: this.encryption.encrypt(body) }, { transaction });
  }

  private async event(c: GrievanceCase, auth: AuthContext, type: string, opts: { from?: GrievanceStatus; to?: GrievanceStatus; detail?: string; internal?: boolean }, transaction: Transaction) {
    await GrievanceEvent.create(
      { organizationId: c.organizationId, caseId: c.id, actorUserId: auth.userId, type, fromStatus: opts.from ?? null, toStatus: opts.to ?? null, detail: opts.detail ?? null, internal: opts.internal ?? false },
      { transaction },
    );
  }

  /** Audit entries carry only the reference: no names, categories or complaint text. */
  private async record(c: GrievanceCase, action: string, summary: string, transaction: Transaction, metadata?: Record<string, unknown>) {
    await this.audit.record({ action: `grievance.${action}`, entityType: 'GrievanceCase', entityId: c.id, summary: `${c.reference} ${summary}`, metadata }, transaction);
  }

  private async nextReference(posh: boolean, transaction: Transaction): Promise<string> {
    const prefix = posh ? 'POSH' : 'GRV';
    const rows = await GrievanceCase.findAll({ where: { reference: { [Op.like]: `${prefix}-%` } }, attributes: ['reference'], raw: true, transaction });
    const pattern = new RegExp(`^${prefix}-(\\d+)$`);
    const max = rows.reduce((m, r) => Math.max(m, Number(pattern.exec(r.reference)?.[1] ?? 0)), 0);
    return `${prefix}-${String(max + 1).padStart(4, '0')}`;
  }

  private seal(value: Details | Resolution): string {
    return this.encryption.encrypt(JSON.stringify(value));
  }

  private open<T>(payload: string): T {
    return JSON.parse(this.encryption.decrypt(payload)) as T;
  }

  private async userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    const users = await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] });
    return new Map(users.map((u) => [u.id, fullName(u)]));
  }

  private summary(c: GrievanceCase, today: string, users: Map<string, string>, complainantView: boolean) {
    return {
      id: c.id,
      reference: c.reference,
      category: c.category,
      posh: isPosh(c.category),
      subject: c.subject,
      status: c.status,
      ...(complainantView ? {} : { priority: c.priority }),
      assignee: c.assigneeUserId ? { id: c.assigneeUserId, name: users.get(c.assigneeUserId) ?? 'Former user' } : null,
      submittedOn: c.submittedOn,
      dueOn: c.dueOn,
      overdue: isOverdue(c, today),
      resolvedOn: c.resolvedOn,
      outcome: c.outcome,
      updatedAt: c.updatedAt,
    };
  }

  private async present(c: GrievanceCase, access: Access) {
    const full = (await GrievanceCase.findByPk(c.id, {
      include: [
        { model: Employee, as: 'complainant', attributes: PERSON, include: personInclude() },
        { model: Employee, as: 'respondent', attributes: PERSON, include: personInclude() },
      ],
    }))!;
    const shared = access.complainant ? { visibility: 'SHARED' } : {};
    const [notes, files, events] = await Promise.all([
      GrievanceNote.findAll({ where: { caseId: c.id, ...shared }, order: [['createdAt', 'ASC']] }),
      GrievanceAttachment.findAll({ where: { caseId: c.id, ...shared }, order: [['createdAt', 'ASC']] }),
      GrievanceEvent.findAll({ where: { caseId: c.id, ...(access.complainant ? { internal: false } : {}) }, order: [['createdAt', 'ASC']] }),
    ]);
    const users = await this.userNames([full.assigneeUserId, full.resolvedById, ...notes.map((n) => n.authorUserId), ...files.map((f) => f.uploadedById), ...events.map((e) => e.actorUserId)]);
    const today = await organizationToday(full.organizationId);
    const details = this.open<Details>(full.detailsEncrypted);
    const resolution = full.resolutionEncrypted ? this.open<Resolution>(full.resolutionEncrypted) : null;
    const complainantName = full.complainant ? fullName(full.complainant) : 'Complainant';
    const author = (fromComplainant: boolean, userId: string | null) => (fromComplainant ? complainantName : userId ? (users.get(userId) ?? 'Former user') : 'Former user');
    const posh = isPosh(full.category);
    const updatable = acceptsUpdates(full.status);
    const reopen = reopenBlocker(full, today);
    const close = closeBlocker(full, today);
    return {
      ...this.summary(full, today, users, access.complainant),
      role: access.complainant ? ('COMPLAINANT' as const) : ('HANDLER' as const),
      complainant: people(full.complainant),
      respondent: people(full.respondent),
      respondentName: full.respondentName,
      incidentDate: full.incidentDate,
      incidentLocation: full.incidentLocation,
      description: details.description,
      witnesses: details.witnesses,
      poshDetails: posh
        ? { delayReason: details.delayReason, interimRelief: details.interimRelief, conciliationRequested: details.conciliationRequested, filing: poshFiling(full.incidentDate, full.submittedOn) }
        : null,
      resolution: resolution
        ? { summary: resolution.summary, ...(access.complainant ? {} : { actions: resolution.actions }), resolvedBy: full.resolvedById ? (users.get(full.resolvedById) ?? 'Former user') : null, resolvedAt: full.resolvedAt }
        : null,
      reopened: full.reopened,
      reopenUntil: full.resolvedOn && !posh && !full.reopened ? reopenUntil(full.resolvedOn) : null,
      acknowledgedAt: full.acknowledgedAt,
      acceptedAt: full.acceptedAt,
      closedAt: full.closedAt,
      withdrawnAt: full.withdrawnAt,
      notes: notes.map((n) => ({ id: n.id, author: author(n.fromComplainant, n.authorUserId), fromComplainant: n.fromComplainant, visibility: n.visibility, body: this.encryption.decrypt(n.bodyEncrypted), createdAt: n.createdAt })),
      attachments: files.map((f) => ({ id: f.id, fileName: f.fileName, contentType: f.contentType, size: f.sizeBytes, visibility: f.visibility, fromComplainant: f.fromComplainant, uploadedBy: author(f.fromComplainant, f.uploadedById), createdAt: f.createdAt })),
      events: events.map((e) => ({ id: e.id, type: e.type, fromStatus: e.fromStatus, toStatus: e.toStatus, detail: e.detail, internal: e.internal, actor: e.actorUserId ? (users.get(e.actorUserId) ?? 'Former user') : null, createdAt: e.createdAt })),
      permissions: access.complainant
        ? { note: updatable, attach: updatable && files.length < GRIEVANCE_MAX_ATTACHMENTS, withdraw: isOpen(full.status), accept: full.status === 'RESOLVED', reopen: !reopen, reopenBlocker: full.status === 'RESOLVED' ? reopen : null }
        : {
            manage: access.manage,
            note: updatable,
            attach: updatable && files.length < GRIEVANCE_MAX_ATTACHMENTS,
            assign: access.manage && isOpen(full.status),
            priority: access.manage && updatable,
            acknowledge: access.manage && full.status === 'SUBMITTED',
            investigate: access.manage && (full.status === 'SUBMITTED' || full.status === 'IN_REVIEW'),
            resolve: access.manage && (full.status === 'IN_REVIEW' || full.status === 'INVESTIGATING'),
            close: access.manage && !close,
            closeBlocker: access.manage && full.status === 'RESOLVED' ? close : null,
          },
    };
  }
}
