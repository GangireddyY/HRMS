import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { POLICY_FILE_MAX_BYTES } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { RequestContext } from '../../common/context/request-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { csvCell } from '../../common/utils/csv';
import { containsPattern } from '../../common/utils/like';
import { addMonths } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { Department, Employee, OrganizationMembership, Policy, PolicyAcknowledgement, PolicyVersion, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { detectDocumentType, safeFileName } from '../employees/employee-documents.service';
import { fullName, organizationToday, userIdsOf } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ackDueOn, ackState, acknowledgementBasis, inAudience, type AckState } from './compliance-rules';
import type { AcknowledgeDto, PolicyDraftDto, PolicyDto, PolicyQueryDto, TrackingQueryDto, UpdatePolicyDto } from './dto/compliance.dto';

export interface UploadedPolicyFile {
  buffer: Buffer;
  size: number;
  originalname: string;
}

const REMIND_EVERY_MS = 24 * 3_600_000;
const PEOPLE = ['id', 'employeeCode', 'firstName', 'lastName', 'departmentId', 'locationId', 'employmentType', 'dateOfJoining'];
const list = <T>(x: T[] | null | undefined) => (x?.length ? x : null);

interface PersonState {
  employee: Employee;
  state: AckState;
  dueOn: string;
  acknowledgedAt: Date | null;
  acknowledgedVersion: number | null;
}

/**
 * Company policies (`compliance.manage`): versioned text and / or PDF, an audience, acknowledgement deadlines and a
 * review cycle. Employees read the current version and acknowledge it (`compliance.policy.acknowledge`); the record
 * keeps the time, IP address and browser as evidence. HR tracks who has acknowledged and sends reminders.
 */
@Injectable()
export class PoliciesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- HR ---------------------------------------------------------------------------------------

  async list(auth: AuthContext, query: PolicyQueryDto) {
    const manage = auth.permissions.has('compliance.manage');
    const conditions: WhereOptions[] = [];
    if (query.status) conditions.push({ status: query.status });
    if (!manage) conditions.push({ status: { [Op.ne]: 'DRAFT' } });
    if (query.category) conditions.push({ category: query.category });
    if (query.search) conditions.push({ title: { [Op.iLike]: containsPattern(query.search) } });
    const where = { [Op.and]: conditions };
    const count = await Policy.count({ where });
    const rows = await Policy.findAll({ where, include: [{ model: PolicyVersion }], order: [['status', 'ASC'], ['title', 'ASC']], ...paginationArgs(query) });
    const today = await organizationToday(auth.organizationId!);
    const employees = rows.some((p) => p.status === 'PUBLISHED' && p.requiresAck) ? await this.activeEmployees() : [];
    const out = [];
    for (const p of rows) {
      const stats = p.status === 'PUBLISHED' && p.requiresAck ? this.counts(await this.states(p, employees, today)) : null;
      out.push({ ...this.summary(p, today), stats });
    }
    return new PaginatedResult(out, paginationMeta(query, count));
  }

  async get(auth: AuthContext, id: string) {
    const p = await this.find(id);
    const manage = auth.permissions.has('compliance.manage');
    if (!manage && p.status === 'DRAFT') throw AppError.notFound('Policy');
    const today = await organizationToday(p.organizationId);
    const versions = [...(p.versions ?? [])].sort((a, b) => b.version - a.version);
    const names = await this.names([p.ownerUserId, ...versions.map((v) => v.publishedById)]);
    const stats = p.status === 'PUBLISHED' && p.requiresAck ? this.counts(await this.states(p, await this.activeEmployees(), today)) : null;
    return {
      ...this.summary(p, today),
      owner: p.ownerUserId ? { id: p.ownerUserId, name: names.get(p.ownerUserId) ?? 'Former user' } : null,
      stats,
      versions: versions.filter((v) => manage || v.status !== 'DRAFT').map((v) => this.presentVersion(v, names)),
    };
  }

  async create(auth: AuthContext, dto: PolicyDto) {
    await this.checkOwner(dto.ownerUserId);
    const p = await this.db.transaction(async (transaction) => {
      const created = await Policy.create({ organizationId: auth.organizationId!, ...this.columns(dto), createdById: auth.userId }, { transaction });
      await PolicyVersion.create({ organizationId: auth.organizationId!, policyId: created.id, version: 1, content: dto.content ?? null }, { transaction });
      await this.audit.record({ action: 'compliance.policy_created', entityType: 'Policy', entityId: created.id, summary: `Policy "${created.title}" drafted` }, transaction);
      return created;
    });
    return this.get(auth, p.id);
  }

  async update(auth: AuthContext, id: string, dto: UpdatePolicyDto) {
    await this.checkOwner(dto.ownerUserId);
    await this.db.transaction(async (transaction) => {
      const p = await this.find(id, transaction);
      if (p.status === 'RETIRED') throw AppError.conflict('A retired policy can no longer change');
      const rest: UpdatePolicyDto = { ...dto };
      delete rest.content;
      const merged = this.columns({ ...this.asDto(p), ...rest });
      const reviewChanged = rest.reviewMonths !== undefined && rest.reviewMonths !== p.reviewMonths;
      const published = p.versions?.find((v) => v.status === 'PUBLISHED');
      await p.update({ ...merged, ...(reviewChanged ? { nextReviewOn: merged.reviewMonths && published?.publishedOn ? addMonths(published.publishedOn, merged.reviewMonths) : null } : {}) }, { transaction });
      await this.audit.record({ action: 'compliance.policy_updated', entityType: 'Policy', entityId: p.id, summary: `Policy "${p.title}" updated` }, transaction);
    });
    return this.get(auth, id);
  }

  /** Creates or edits the draft of the next version. */
  async saveDraft(auth: AuthContext, id: string, dto: PolicyDraftDto) {
    await this.db.transaction(async (transaction) => {
      const p = await this.find(id, transaction);
      if (p.status === 'RETIRED') throw AppError.conflict('A retired policy can no longer change');
      const draft = await this.draftOf(p, transaction);
      await draft.update(
        {
          ...(dto.content !== undefined ? { content: dto.content } : {}),
          ...(dto.changeSummary !== undefined ? { changeSummary: dto.changeSummary } : {}),
          ...(dto.reacknowledge !== undefined ? { reacknowledge: dto.reacknowledge } : {}),
          ...(dto.effectiveFrom !== undefined ? { effectiveFrom: dto.effectiveFrom } : {}),
        },
        { transaction },
      );
    });
    return this.get(auth, id);
  }

  async uploadFile(auth: AuthContext, id: string, file?: UploadedPolicyFile) {
    if (!file) throw AppError.validation([{ field: 'file', message: 'Choose a PDF' }]);
    if (file.size > POLICY_FILE_MAX_BYTES) throw AppError.validation([{ field: 'file', message: 'The PDF must be 10 MB or smaller' }]);
    if (detectDocumentType(file.buffer) !== 'application/pdf') throw AppError.validation([{ field: 'file', message: 'Upload the policy as a PDF' }]);
    const key = `organizations/${auth.organizationId}/policies/${id}/${randomUUID()}`;
    let previous: string | null = null;
    await this.storage.put(key, file.buffer, 'application/pdf');
    try {
      await this.db.transaction(async (transaction) => {
        const p = await this.find(id, transaction);
        if (p.status === 'RETIRED') throw AppError.conflict('A retired policy can no longer change');
        const draft = await this.draftOf(p, transaction);
        previous = draft.fileKey;
        await draft.update({ fileKey: key, fileName: safeFileName(file.originalname, p.title, 'application/pdf'), fileSize: file.size }, { transaction });
      });
    } catch (e) {
      await this.storage.deleteQuietly([key]);
      throw e;
    }
    if (previous) await this.storage.deleteQuietly([previous]);
    return this.get(auth, id);
  }

  async removeFile(auth: AuthContext, id: string) {
    let previous: string | null = null;
    await this.db.transaction(async (transaction) => {
      const p = await this.find(id, transaction);
      const draft = p.versions?.find((v) => v.status === 'DRAFT');
      if (!draft?.fileKey) throw AppError.notFound('Draft file');
      previous = draft.fileKey;
      await draft.update({ fileKey: null, fileName: null, fileSize: null }, { transaction });
    });
    if (previous) await this.storage.deleteQuietly([previous]);
    return this.get(auth, id);
  }

  async discardDraft(auth: AuthContext, id: string) {
    let file: string | null = null;
    await this.db.transaction(async (transaction) => {
      const p = await this.find(id, transaction);
      if (p.status === 'DRAFT') throw AppError.conflict('Delete the policy instead');
      const draft = p.versions?.find((v) => v.status === 'DRAFT');
      if (!draft) throw AppError.notFound('Draft');
      file = draft.fileKey;
      await draft.destroy({ transaction });
    });
    if (file) await this.storage.deleteQuietly([file]);
    return this.get(auth, id);
  }

  async publish(auth: AuthContext, id: string) {
    const notifyIds = await this.db.transaction(async (transaction) => {
      const p = await this.find(id, transaction);
      if (p.status === 'RETIRED') throw AppError.conflict('A retired policy can no longer be published');
      const draft = p.versions?.find((v) => v.status === 'DRAFT');
      if (!draft) throw AppError.conflict('There is no draft to publish');
      if (!draft.content?.trim() && !draft.fileKey) throw AppError.validation([{ field: 'content', message: 'Add the policy text or a PDF before publishing' }]);
      const today = await organizationToday(p.organizationId);
      const first = p.status === 'DRAFT';
      await PolicyVersion.update({ status: 'SUPERSEDED' }, { where: { policyId: p.id, status: 'PUBLISHED' }, transaction });
      await draft.update({ status: 'PUBLISHED', publishedAt: new Date(), publishedOn: today, publishedById: auth.userId, effectiveFrom: draft.effectiveFrom ?? today, reacknowledge: first ? true : draft.reacknowledge }, { transaction });
      await p.update({ status: 'PUBLISHED', currentVersionId: draft.id, nextReviewOn: p.reviewMonths ? addMonths(today, p.reviewMonths) : null }, { transaction });
      await this.audit.record({ action: 'compliance.policy_published', entityType: 'Policy', entityId: p.id, summary: `Policy "${p.title}" version ${draft.version} published` }, transaction);
      return p.requiresAck && (first || draft.reacknowledge) ? { p, version: draft.version, due: p.ackDueDays } : null;
    });
    if (notifyIds) {
      const audience = (await this.activeEmployees()).filter((e) => inAudience(notifyIds.p, e));
      const users = await userIdsOf(audience.map((e) => e.id));
      for (const userId of users.values()) {
        if (userId === auth.userId) continue;
        await this.notifications.notify(userId, { organizationId: notifyIds.p.organizationId, type: 'compliance.policy', title: `Please read and acknowledge: ${notifyIds.p.title}`, body: `Version ${notifyIds.version}. Due within ${notifyIds.due} days.`, link: `/me/policies/${notifyIds.p.id}` });
      }
    }
    return this.get(auth, id);
  }

  async retire(auth: AuthContext, id: string) {
    await this.db.transaction(async (transaction) => {
      const p = await this.find(id, transaction);
      if (p.status !== 'PUBLISHED') throw AppError.conflict('Only a published policy can be retired');
      await p.update({ status: 'RETIRED', nextReviewOn: null }, { transaction });
      await this.audit.record({ action: 'compliance.policy_retired', entityType: 'Policy', entityId: p.id, summary: `Policy "${p.title}" retired` }, transaction);
    });
    return this.get(auth, id);
  }

  /** Records a review without changes: the next review moves forward by the review cycle. */
  async markReviewed(auth: AuthContext, id: string) {
    await this.db.transaction(async (transaction) => {
      const p = await this.find(id, transaction);
      if (p.status !== 'PUBLISHED') throw AppError.conflict('Only a published policy is reviewed');
      if (!p.reviewMonths) throw AppError.conflict('Set a review cycle first');
      const next = addMonths(await organizationToday(p.organizationId), p.reviewMonths);
      await p.update({ nextReviewOn: next }, { transaction });
      await this.audit.record({ action: 'compliance.policy_reviewed', entityType: 'Policy', entityId: p.id, summary: `Policy "${p.title}" reviewed; next review ${next}` }, transaction);
    });
    return this.get(auth, id);
  }

  async remove(auth: AuthContext, id: string) {
    let file: string | null = null;
    await this.db.transaction(async (transaction) => {
      const p = await this.find(id, transaction);
      if (p.status !== 'DRAFT') throw AppError.conflict('Only a draft policy can be deleted; retire a published one');
      file = p.versions?.find((v) => v.fileKey)?.fileKey ?? null;
      await PolicyVersion.destroy({ where: { policyId: p.id }, transaction });
      await p.destroy({ transaction });
      await this.audit.record({ action: 'compliance.policy_deleted', entityType: 'Policy', entityId: id, summary: `Draft policy "${p.title}" deleted` }, transaction);
    });
    if (file) await this.storage.deleteQuietly([file]);
  }

  /** Who in the audience has acknowledged the policy, and who is pending or overdue. */
  async tracking(auth: AuthContext, id: string, query: TrackingQueryDto) {
    const p = await this.find(id);
    if (p.status !== 'PUBLISHED') throw AppError.conflict('Only a published policy is acknowledged');
    const today = await organizationToday(p.organizationId);
    let states = await this.states(p, await this.activeEmployees(), today);
    const counts = this.counts(states);
    if (query.state) states = states.filter((s) => s.state === query.state);
    if (query.search) {
      const q = query.search.toLowerCase();
      states = states.filter((s) => fullName(s.employee).toLowerCase().includes(q) || s.employee.employeeCode.toLowerCase().includes(q));
    }
    const order: Record<AckState, number> = { OVERDUE: 0, PENDING: 1, ACKNOWLEDGED: 2 };
    states.sort((a, b) => order[a.state] - order[b.state] || fullName(a.employee).localeCompare(fullName(b.employee)));
    const page = states.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    return { items: page.map((s) => this.presentState(s)), meta: paginationMeta(query, states.length), counts };
  }

  async trackingCsv(auth: AuthContext, id: string): Promise<{ fileName: string; content: string }> {
    const p = await this.find(id);
    if (p.status !== 'PUBLISHED') throw AppError.conflict('Only a published policy is acknowledged');
    const today = await organizationToday(p.organizationId);
    const states = await this.states(p, await this.activeEmployees(), today);
    const lines = [['Employee code', 'Name', 'Department', 'Status', 'Due by', 'Acknowledged at', 'Version acknowledged'].map(csvCell).join(',')];
    for (const s of states) {
      lines.push([s.employee.employeeCode, fullName(s.employee), s.employee.department?.name ?? '', s.state, s.dueOn, s.acknowledgedAt?.toISOString() ?? '', s.acknowledgedVersion ?? ''].map(csvCell).join(','));
    }
    await this.audit.record({ action: 'compliance.acknowledgements_exported', entityType: 'Policy', entityId: p.id, summary: `Acknowledgements of "${p.title}" exported` });
    return { fileName: `${p.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'policy'} acknowledgements ${today}.csv`, content: lines.join('\r\n') };
  }

  /** Reminds everyone who hasn't acknowledged yet (at most once a day). */
  async remind(auth: AuthContext, id: string) {
    const p = await this.find(id);
    if (p.status !== 'PUBLISHED' || !p.requiresAck) throw AppError.conflict('This policy does not need acknowledging');
    if (p.lastRemindedAt && Date.now() - p.lastRemindedAt.getTime() < REMIND_EVERY_MS) throw AppError.conflict('Reminders were sent in the last 24 hours');
    const today = await organizationToday(p.organizationId);
    const pending = (await this.states(p, await this.activeEmployees(), today)).filter((s) => s.state !== 'ACKNOWLEDGED');
    const users = await userIdsOf(pending.map((s) => s.employee.id));
    await this.db.transaction(async (transaction) => {
      for (const s of pending) {
        const userId = users.get(s.employee.id);
        if (userId) await this.notifications.notify(userId, { organizationId: p.organizationId, type: 'compliance.policy', title: `Reminder: please acknowledge ${p.title}`, body: s.state === 'OVERDUE' ? `It was due on ${s.dueOn}.` : `Due by ${s.dueOn}.`, link: `/me/policies/${p.id}` }, transaction);
      }
      await p.update({ lastRemindedAt: new Date() }, { transaction });
      await this.audit.record({ action: 'compliance.policy_reminded', entityType: 'Policy', entityId: p.id, summary: `Reminders for "${p.title}" sent to ${users.size} people` }, transaction);
    });
    return { reminded: users.size, withoutLogin: pending.length - users.size };
  }

  // ---- Employees --------------------------------------------------------------------------------

  async mine(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return [];
    const today = await organizationToday(auth.organizationId!);
    const policies = await Policy.findAll({ where: { status: 'PUBLISHED' }, include: [{ model: PolicyVersion }], order: [['title', 'ASC']] });
    const out = [];
    for (const p of policies.filter((x) => inAudience(x, self))) {
      const [s] = await this.states(p, [self], today);
      const current = p.versions!.find((v) => v.id === p.currentVersionId)!;
      out.push({
        id: p.id,
        title: p.title,
        category: p.category,
        summary: p.summary,
        requiresAck: p.requiresAck,
        version: { id: current.id, version: current.version, effectiveFrom: current.effectiveFrom, publishedOn: current.publishedOn, changeSummary: current.changeSummary },
        ...(p.requiresAck ? this.presentState(s!) : { state: null, dueOn: null, acknowledgedAt: s?.acknowledgedAt ?? null, acknowledgedVersion: s?.acknowledgedVersion ?? null }),
      });
    }
    return out;
  }

  /** The current version for an employee in the audience (HR can read any published policy). */
  async read(auth: AuthContext, id: string) {
    const { p, self } = await this.readable(auth, id);
    const today = await organizationToday(p.organizationId);
    const current = p.versions!.find((v) => v.id === p.currentVersionId)!;
    const state = self && inAudience(p, self) ? (await this.states(p, [self], today))[0]! : null;
    const names = await this.names([current.publishedById]);
    return {
      id: p.id,
      title: p.title,
      category: p.category,
      summary: p.summary,
      requiresAck: p.requiresAck,
      version: this.presentVersion(current, names),
      mine: state ? this.presentState(state) : null,
      canAcknowledge: !!state && p.requiresAck && auth.permissions.has('compliance.policy.acknowledge') && state.acknowledgedVersion !== current.version,
    };
  }

  async acknowledge(auth: AuthContext, id: string, dto: AcknowledgeDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees acknowledge policies');
    const p = await this.find(id);
    if (p.status !== 'PUBLISHED' || !inAudience(p, self)) throw AppError.notFound('Policy');
    if (!p.requiresAck) throw AppError.conflict('This policy does not need acknowledging');
    if (dto.versionId !== p.currentVersionId) throw AppError.conflict('A newer version has been published; read it first');
    const version = p.versions!.find((v) => v.id === dto.versionId)!;
    const ctx = RequestContext.get();
    try {
      await this.db.transaction(async (transaction) => {
        await PolicyAcknowledgement.create(
          { organizationId: p.organizationId, policyId: p.id, versionId: version.id, employeeId: self.id, ipAddress: ctx?.ipAddress ?? null, userAgent: ctx?.userAgent?.slice(0, 512) ?? null },
          { transaction },
        );
        await this.audit.record({ action: 'compliance.policy_acknowledged', entityType: 'Policy', entityId: p.id, summary: `${self.employeeCode} acknowledged "${p.title}" version ${version.version}` }, transaction);
      });
    } catch (e) {
      if ((e as { name?: string }).name === 'SequelizeUniqueConstraintError') throw AppError.conflict('You have already acknowledged this version');
      throw e;
    }
    return this.read(auth, id);
  }

  async download(auth: AuthContext, id: string, versionId: string): Promise<{ stream: Readable; fileName: string; size: number }> {
    const { p, hr } = await this.readable(auth, id, true);
    const v = p.versions!.find((x) => x.id === versionId);
    if (!v?.fileKey || (!hr && v.id !== p.currentVersionId)) throw AppError.notFound('File');
    return { stream: await this.storage.get(v.fileKey), fileName: v.fileName!, size: v.fileSize! };
  }

  // ---- Internals --------------------------------------------------------------------------------

  private async readable(auth: AuthContext, id: string, allowDraft = false) {
    const p = await this.find(id);
    const hr = auth.permissions.has('compliance.manage');
    const self = await this.scope.self(auth);
    if (hr) {
      if (p.status === 'DRAFT' && !allowDraft) throw AppError.notFound('Policy');
      return { p, self, hr };
    }
    if (p.status !== 'PUBLISHED' || !self || !inAudience(p, self)) throw AppError.notFound('Policy');
    return { p, self, hr };
  }

  private async find(id: string, transaction?: Transaction) {
    const p = await Policy.findByPk(id, { transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
    if (!p) throw AppError.notFound('Policy');
    p.versions = await PolicyVersion.findAll({ where: { policyId: p.id }, order: [['version', 'ASC']], transaction });
    return p;
  }

  private async draftOf(p: Policy, transaction: Transaction) {
    const existing = p.versions?.find((v) => v.status === 'DRAFT');
    if (existing) return existing;
    const next = Math.max(0, ...(p.versions ?? []).map((v) => v.version)) + 1;
    const current = p.versions?.find((v) => v.status === 'PUBLISHED');
    return PolicyVersion.create({ organizationId: p.organizationId, policyId: p.id, version: next, content: current?.content ?? null, reacknowledge: true }, { transaction });
  }

  private activeEmployees() {
    return Employee.findAll({ where: { status: ['ACTIVE', 'ON_NOTICE'] }, attributes: PEOPLE, include: [{ model: Department, attributes: ['id', 'name'] }] });
  }

  private async states(p: Policy, employees: Employee[], today: string): Promise<PersonState[]> {
    const published = (p.versions ?? []).filter((v) => v.status !== 'DRAFT' && v.publishedOn);
    const basis = acknowledgementBasis(published.map((v) => ({ version: v.version, reacknowledge: v.reacknowledge, publishedOn: v.publishedOn! })));
    if (!basis) return [];
    const audience = employees.filter((e) => inAudience(p, e));
    if (!audience.length) return [];
    const numberOf = new Map(published.map((v) => [v.id, v.version]));
    const acks = await PolicyAcknowledgement.findAll({ where: { policyId: p.id, employeeId: audience.map((e) => e.id) }, attributes: ['employeeId', 'versionId', 'acknowledgedAt'], order: [['acknowledgedAt', 'ASC']] });
    const by = new Map<string, PolicyAcknowledgement[]>();
    for (const a of acks) by.set(a.employeeId, [...(by.get(a.employeeId) ?? []), a]);
    return audience.map((e) => {
      const mine = by.get(e.id) ?? [];
      const versions = mine.map((a) => numberOf.get(a.versionId) ?? 0);
      const latest = mine[mine.length - 1];
      const dueOn = ackDueOn(basis.publishedOn, e.dateOfJoining, p.ackDueDays);
      return { employee: e, state: ackState(versions, basis.version, dueOn, today), dueOn, acknowledgedAt: latest?.acknowledgedAt ?? null, acknowledgedVersion: latest ? (numberOf.get(latest.versionId) ?? null) : null };
    });
  }

  private counts(states: PersonState[]) {
    return {
      audience: states.length,
      acknowledged: states.filter((s) => s.state === 'ACKNOWLEDGED').length,
      pending: states.filter((s) => s.state === 'PENDING').length,
      overdue: states.filter((s) => s.state === 'OVERDUE').length,
    };
  }

  private presentState(s: PersonState) {
    return {
      employee: { id: s.employee.id, name: fullName(s.employee), employeeCode: s.employee.employeeCode, department: s.employee.department?.name ?? null },
      state: s.state,
      dueOn: s.dueOn,
      acknowledgedAt: s.acknowledgedAt,
      acknowledgedVersion: s.acknowledgedVersion,
    };
  }

  private summary(p: Policy, today: string) {
    const current = p.versions?.find((v) => v.id === p.currentVersionId);
    const draft = p.versions?.find((v) => v.status === 'DRAFT');
    return {
      id: p.id,
      title: p.title,
      category: p.category,
      summary: p.summary,
      status: p.status,
      departmentIds: p.departmentIds,
      locationIds: p.locationIds,
      employmentTypes: p.employmentTypes,
      requiresAck: p.requiresAck,
      ackDueDays: p.ackDueDays,
      reviewMonths: p.reviewMonths,
      nextReviewOn: p.nextReviewOn,
      reviewDue: p.status === 'PUBLISHED' && !!p.nextReviewOn && p.nextReviewOn <= today,
      currentVersion: current ? { id: current.id, version: current.version, publishedOn: current.publishedOn, effectiveFrom: current.effectiveFrom } : null,
      hasDraft: !!draft,
      lastRemindedAt: p.lastRemindedAt,
      updatedAt: p.updatedAt,
    };
  }

  private presentVersion(v: PolicyVersion, names: Map<string, string>) {
    return {
      id: v.id,
      version: v.version,
      status: v.status,
      content: v.content,
      file: v.fileKey ? { name: v.fileName, size: v.fileSize } : null,
      changeSummary: v.changeSummary,
      reacknowledge: v.reacknowledge,
      effectiveFrom: v.effectiveFrom,
      publishedOn: v.publishedOn,
      publishedBy: v.publishedById ? (names.get(v.publishedById) ?? 'Former user') : null,
    };
  }

  private columns(dto: Partial<PolicyDto>) {
    return {
      title: dto.title!,
      category: dto.category!,
      summary: dto.summary ?? null,
      ownerUserId: dto.ownerUserId ?? null,
      departmentIds: list(dto.departmentIds),
      locationIds: list(dto.locationIds),
      employmentTypes: list(dto.employmentTypes),
      requiresAck: dto.requiresAck ?? true,
      ackDueDays: dto.ackDueDays ?? 14,
      reviewMonths: dto.reviewMonths ?? null,
    };
  }

  private asDto(p: Policy): Partial<PolicyDto> {
    return {
      title: p.title,
      category: p.category,
      summary: p.summary,
      ownerUserId: p.ownerUserId,
      departmentIds: p.departmentIds,
      locationIds: p.locationIds,
      employmentTypes: p.employmentTypes,
      requiresAck: p.requiresAck,
      ackDueDays: p.ackDueDays,
      reviewMonths: p.reviewMonths,
    };
  }

  private async checkOwner(userId: string | null | undefined) {
    if (userId && !(await OrganizationMembership.count({ where: { userId, status: 'ACTIVE' } }))) throw AppError.validation([{ field: 'ownerUserId', message: 'Choose a member of the organization' }]);
  }

  private async names(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }
}
