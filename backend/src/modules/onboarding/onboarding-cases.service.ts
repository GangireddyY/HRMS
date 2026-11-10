import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import { ONBOARDING_JOINER_WINDOW_DAYS, type OnboardingTaskState } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { addDays, zonedParts } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { Department, Designation, Employee, EmployeeDocument, OnboardingCase, OnboardingTask, Organization, OrganizationMembership, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EmployeeDocumentsService, type UploadedDocumentFile } from '../employees/employee-documents.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CancelCaseDto, CaseQueryDto, CaseTaskDto, StartCaseDto, TaskActionDto, UpdateCaseDto, UpdateCaseTaskDto, VerifyTaskDocumentDto } from './dto/onboarding.dto';
import { OnboardingTemplatesService } from './onboarding-templates.service';
import { fullName } from '../../common/utils/names';

const EMPLOYEE_ATTRS = ['id', 'organizationId', 'employeeCode', 'firstName', 'lastName', 'status', 'dateOfJoining', 'managerId', 'departmentId', 'membershipId', 'workEmail'];
const EMPLOYEE_INCLUDE = [
  { model: Department, attributes: ['id', 'name'] },
  { model: Designation, attributes: ['id', 'name'] },
];

interface CaseAccess {
  employee: Employee;
  isSelf: boolean;
  /** The caller is the joiner's direct manager. */
  isManager: boolean;
  canManage: boolean;
  canVerify: boolean;
}

type DocInfo = Pick<EmployeeDocument, 'id' | 'status' | 'title' | 'fileName' | 'contentType' | 'reviewNote' | 'createdAt'>;

/** A document task is done once its document is verified (here or from the employee's Documents tab). */
export function taskState(t: Pick<OnboardingTask, 'status' | 'documentCategory'>, doc: Pick<EmployeeDocument, 'status'> | undefined): OnboardingTaskState {
  if (t.status !== 'PENDING') return t.status;
  if (!t.documentCategory || !doc) return 'PENDING';
  return doc.status === 'VERIFIED' ? 'DONE' : doc.status === 'REJECTED' ? 'REJECTED' : 'SUBMITTED';
}
const finished = (s: OnboardingTaskState) => s === 'DONE' || s === 'SKIPPED';

/**
 * Onboarding cases. HR (onboarding.manage, cases in onboarding.view scope) runs the checklist; the joiner completes their
 * own tasks and uploads documents (self-service); the joiner's direct manager completes manager tasks; onboarding
 * verifiers (onboarding.document.verify) verify the documents. Nobody manages or verifies their own onboarding.
 */
@Injectable()
export class OnboardingCasesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly templates: OnboardingTemplatesService,
    private readonly documents: EmployeeDocumentsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Lists -----------------------------------------------------------------------------------

  async list(auth: AuthContext, query: CaseQueryDto) {
    const scoped = await this.scope.where(auth, 'onboarding.view', 'employeeId');
    if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
    const filters: WhereOptions[] = [scoped];
    if (query.status) filters.push({ status: query.status });
    // Matched up front: a filter on the employee include combined with the task include and paging breaks the query.
    if (query.search) {
      const like = containsPattern(query.search);
      const matching = await Employee.findAll({
        where: { [Op.or]: [{ firstName: { [Op.iLike]: like } }, { lastName: { [Op.iLike]: like } }, { employeeCode: { [Op.iLike]: like } }] },
        attributes: ['id'],
        raw: true,
      });
      filters.push({ employeeId: matching.map((e) => e.id) });
    }
    const { rows, count } = await OnboardingCase.findAndCountAll({
      where: { [Op.and]: filters },
      include: [{ model: Employee, as: 'employee', attributes: EMPLOYEE_ATTRS, include: EMPLOYEE_INCLUDE }, { model: OnboardingTask }],
      order: [['status', 'DESC'], ['joiningDate', 'DESC']],
      distinct: true,
      ...paginationArgs(query),
    });
    const docs = await this.documentsFor(rows.flatMap((c) => c.tasks ?? []));
    const today = await this.today(auth.organizationId!);
    return new PaginatedResult(rows.map((c) => ({ ...this.summary(c, docs, today), employee: this.employeeRef(c.employee!) })), paginationMeta(query, count));
  }

  /** Recent and upcoming joiners without an onboarding case (to start one). */
  async joiners(auth: AuthContext) {
    const scoped = await this.scope.where(auth, 'onboarding.view');
    if (!scoped) return [];
    const today = await this.today(auth.organizationId!);
    const started = (await OnboardingCase.findAll({ where: { status: ['IN_PROGRESS', 'COMPLETED'] }, attributes: ['employeeId'], raw: true })).map((c) => c.employeeId);
    const rows = await Employee.findAll({
      where: { [Op.and]: [scoped, { status: 'ACTIVE' }, { dateOfJoining: { [Op.gte]: addDays(today, -ONBOARDING_JOINER_WINDOW_DAYS) } }, ...(started.length ? [{ id: { [Op.notIn]: started } }] : [])] },
      attributes: EMPLOYEE_ATTRS,
      include: EMPLOYEE_INCLUDE,
      order: [['dateOfJoining', 'DESC']],
      limit: 200,
    });
    return rows.map((e) => this.employeeRef(e));
  }

  async get(auth: AuthContext, id: string) {
    const c = await this.find(id);
    const access = await this.access(auth, c);
    if (!access.canManage && !access.isSelf && !access.isManager && !(await this.scope.covers(auth, 'onboarding.view', access.employee))) throw AppError.notFound('Onboarding case');
    return this.detail(auth, c, access);
  }

  /** The joiner's own open case (or the latest one). */
  async mine(auth: AuthContext) {
    this.assertEntitled(auth);
    const self = await this.scope.self(auth);
    if (!self) return null;
    const c = await OnboardingCase.findOne({ where: { employeeId: self.id, status: ['IN_PROGRESS', 'COMPLETED'] }, order: [['status', 'DESC'], ['createdAt', 'DESC']] });
    if (!c) return null;
    const full = await this.find(c.id);
    return this.detail(auth, full, await this.access(auth, full));
  }

  /** Open cases of the caller's direct reports that have manager tasks. */
  async managerTasks(auth: AuthContext) {
    this.assertEntitled(auth);
    const self = await this.scope.self(auth);
    if (!self) return [];
    const cases = await OnboardingCase.findAll({
      where: { status: 'IN_PROGRESS' },
      include: [{ model: Employee, as: 'employee', attributes: EMPLOYEE_ATTRS, include: EMPLOYEE_INCLUDE, where: { managerId: self.id } }, { model: OnboardingTask, where: { assignee: 'MANAGER' } }],
      order: [['joiningDate', 'ASC']],
    });
    const today = await this.today(auth.organizationId!);
    return cases.map((c) => ({
      caseId: c.id,
      joiningDate: c.joiningDate,
      employee: this.employeeRef(c.employee!),
      tasks: [...(c.tasks ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => this.presentTask(t, undefined, today, new Map())),
    }));
  }

  // ---- Case lifecycle --------------------------------------------------------------------------

  async start(auth: AuthContext, dto: StartCaseDto) {
    const employee = await Employee.findByPk(dto.employeeId, { attributes: EMPLOYEE_ATTRS });
    if (!employee || !(await this.scope.covers(auth, 'onboarding.view', employee))) throw AppError.notFound('Employee');
    const self = await this.scope.self(auth);
    if (self?.id === employee.id) throw AppError.forbidden('You cannot run your own onboarding');
    if (employee.status !== 'ACTIVE') throw AppError.validation([{ field: 'employeeId', message: 'Onboarding can only start for active employees' }]);
    if (dto.buddyId) await this.assertBuddy(dto.buddyId, employee.id);
    const template = dto.templateId === null ? null : dto.templateId ? await this.templates.find(dto.templateId) : await this.templates.defaultTemplate();
    if (template && !template.isActive) throw AppError.validation([{ field: 'templateId', message: 'This checklist is inactive' }]);

    let created: OnboardingCase;
    try {
      created = await this.db.transaction(async (transaction) => {
        const c = await OnboardingCase.create(
          {
            organizationId: auth.organizationId!,
            employeeId: employee.id,
            templateId: template?.id ?? null,
            joiningDate: employee.dateOfJoining,
            buddyId: dto.buddyId ?? null,
            notes: dto.notes ?? null,
            createdById: auth.userId,
            updatedById: auth.userId,
          },
          { transaction },
        );
        const tasks = [...(template?.tasks ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
        if (tasks.length) {
          await OnboardingTask.bulkCreate(
            tasks.map((t, i) => ({
              organizationId: auth.organizationId!,
              caseId: c.id,
              title: t.title,
              description: t.description,
              assignee: t.assignee,
              documentCategory: t.documentCategory,
              dueDate: addDays(employee.dateOfJoining, t.dueOffsetDays),
              isRequired: t.isRequired,
              sortOrder: i,
            })),
            { transaction },
          );
        }
        await this.audit.record(
          { action: 'onboarding.started', entityType: 'OnboardingCase', entityId: c.id, summary: `Onboarding started for ${fullName(employee)}${template ? ` (${template.name})` : ''}` },
          transaction,
        );
        return c;
      });
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict(`${fullName(employee)} already has onboarding in progress`);
      throw e;
    }

    const notify = async (userId: string | null, title: string, body?: string) =>
      userId && userId !== auth.userId && this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'onboarding', title, body, link: '/me/onboarding' });
    await notify(await this.userIdOf(employee.membershipId), 'Welcome aboard! Your onboarding checklist is ready', 'Upload your joining documents and complete your tasks.');
    if (employee.managerId) {
      const manager = await Employee.findByPk(employee.managerId, { attributes: ['membershipId'] });
      await notify(await this.userIdOf(manager?.membershipId), `${fullName(employee)} is joining your team`, 'You have onboarding tasks for them.');
    }
    if (dto.buddyId) {
      const buddy = await Employee.findByPk(dto.buddyId, { attributes: ['membershipId'] });
      await notify(await this.userIdOf(buddy?.membershipId), `You are ${fullName(employee)}'s onboarding buddy`);
    }
    return this.get(auth, created.id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateCaseDto) {
    const { c } = await this.forManage(auth, id);
    if (dto.buddyId) await this.assertBuddy(dto.buddyId, c.employeeId);
    await this.db.transaction(async (transaction) => {
      await c.update({ ...dto, updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'onboarding.updated', entityType: 'OnboardingCase', entityId: id }, transaction);
    });
    return this.get(auth, id);
  }

  async complete(auth: AuthContext, id: string) {
    const { c, access } = await this.forManage(auth, id);
    const docs = await this.documentsFor(c.tasks ?? []);
    const open = (c.tasks ?? []).filter((t) => t.isRequired && !finished(taskState(t, t.documentId ? docs.get(t.documentId) : undefined)));
    if (open.length) throw AppError.validation([{ field: 'tasks', message: `${open.length} required task${open.length === 1 ? ' is' : 's are'} still open` }]);
    await this.db.transaction(async (transaction) => {
      await c.update({ status: 'COMPLETED', completedAt: new Date(), completedById: auth.userId, updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'onboarding.completed', entityType: 'OnboardingCase', entityId: id, summary: `Onboarding of ${fullName(access.employee)} completed` }, transaction);
    });
    const userId = await this.userIdOf(access.employee.membershipId);
    if (userId) await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'onboarding', title: 'Your onboarding is complete', link: '/me/onboarding' });
    return this.get(auth, id);
  }

  async cancel(auth: AuthContext, id: string, dto: CancelCaseDto) {
    const { c, access } = await this.forManage(auth, id);
    await this.db.transaction(async (transaction) => {
      await c.update({ status: 'CANCELLED', cancelledAt: new Date(), cancelReason: dto.reason, updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'onboarding.cancelled', entityType: 'OnboardingCase', entityId: id, summary: `Onboarding of ${fullName(access.employee)} cancelled`, metadata: { reason: dto.reason } }, transaction);
    });
    return this.get(auth, id);
  }

  // ---- Tasks -----------------------------------------------------------------------------------

  async addTask(auth: AuthContext, caseId: string, dto: CaseTaskDto) {
    const { c } = await this.forManage(auth, caseId);
    if (dto.documentCategory && dto.assignee !== 'EMPLOYEE') throw AppError.validation([{ field: 'assignee', message: 'Document tasks are completed by the employee' }]);
    await this.db.transaction(async (transaction) => {
      const last = Math.max(-1, ...(c.tasks ?? []).map((t) => t.sortOrder));
      await OnboardingTask.create(
        { organizationId: auth.organizationId!, caseId, title: dto.title, description: dto.description ?? null, assignee: dto.assignee, documentCategory: dto.documentCategory ?? null, dueDate: dto.dueDate, isRequired: dto.isRequired ?? true, sortOrder: last + 1 },
        { transaction },
      );
      await this.audit.record({ action: 'onboarding.task_added', entityType: 'OnboardingCase', entityId: caseId, summary: `Task "${dto.title}" added` }, transaction);
    });
    return this.get(auth, caseId);
  }

  async updateTask(auth: AuthContext, taskId: string, dto: UpdateCaseTaskDto) {
    const { task, c } = await this.taskForManage(auth, taskId);
    const assignee = dto.assignee ?? task.assignee;
    const category = dto.documentCategory !== undefined ? dto.documentCategory : task.documentCategory;
    if (category && assignee !== 'EMPLOYEE') throw AppError.validation([{ field: 'assignee', message: 'Document tasks are completed by the employee' }]);
    await this.db.transaction(async (transaction) => {
      await task.update({ ...dto }, { transaction });
      await this.audit.record({ action: 'onboarding.task_updated', entityType: 'OnboardingCase', entityId: c.id, summary: `Task "${task.title}" updated` }, transaction);
    });
    return this.get(auth, c.id);
  }

  async removeTask(auth: AuthContext, taskId: string) {
    const { task, c } = await this.taskForManage(auth, taskId);
    await this.db.transaction(async (transaction) => {
      await task.destroy({ transaction });
      await this.audit.record({ action: 'onboarding.task_removed', entityType: 'OnboardingCase', entityId: c.id, summary: `Task "${task.title}" removed` }, transaction);
    });
    return this.get(auth, c.id);
  }

  async completeTask(auth: AuthContext, taskId: string, dto: TaskActionDto) {
    const { task, c, access } = await this.taskForAction(auth, taskId);
    if (task.documentCategory) throw AppError.validation([{ field: 'task', message: 'Upload the document; the task is completed when it is verified' }]);
    if (task.status !== 'PENDING') throw AppError.conflict('This task is already closed');
    this.assertCanAct(task.assignee, access);
    await this.setStatus(auth, task, c, 'DONE', dto.note ?? null, 'onboarding.task_completed');
    return this.get(auth, c.id);
  }

  async skipTask(auth: AuthContext, taskId: string, dto: TaskActionDto) {
    const { task, c } = await this.taskForManage(auth, taskId);
    if (!dto.note) throw AppError.validation([{ field: 'note', message: 'Say why the task is skipped' }]);
    if (task.status !== 'PENDING') throw AppError.conflict('This task is already closed');
    await this.setStatus(auth, task, c, 'SKIPPED', dto.note, 'onboarding.task_skipped');
    return this.get(auth, c.id);
  }

  async reopenTask(auth: AuthContext, taskId: string) {
    const { task, c, access } = await this.taskForAction(auth, taskId);
    if (task.status === 'PENDING') throw AppError.conflict('This task is already open');
    if (task.status === 'SKIPPED' || task.documentCategory) {
      if (!access.canManage) throw AppError.forbidden();
    } else this.assertCanAct(task.assignee, access);
    await this.setStatus(auth, task, c, 'PENDING', null, 'onboarding.task_reopened');
    return this.get(auth, c.id);
  }

  /** The joiner (or HR) uploads the document a task asks for; HR uploads are verified immediately. */
  async uploadTaskDocument(auth: AuthContext, taskId: string, file: UploadedDocumentFile | undefined) {
    const { task, c, access } = await this.taskForAction(auth, taskId);
    if (!task.documentCategory) throw AppError.validation([{ field: 'task', message: 'This task does not ask for a document' }]);
    if (task.status !== 'PENDING') throw AppError.conflict('This task is already closed');
    const linked = task.documentId ? await EmployeeDocument.findByPk(task.documentId, { attributes: ['id', 'status'] }) : null;
    if (linked?.status === 'VERIFIED') throw AppError.conflict('The document for this task is already verified');
    if (!access.isSelf && !access.canManage) throw AppError.forbidden();
    const doc = await this.documents.upload(
      auth,
      access.employee.id,
      file,
      { category: task.documentCategory, title: task.title.replace(/^Upload\s+/i, '').replace(/^\w/, (ch) => ch.toUpperCase()).slice(0, 200), expiryDate: null },
      access.canManage ? { employeeId: access.employee.id, reason: 'onboarding' } : undefined,
    );
    await this.db.transaction(async (transaction) => {
      await task.update({ documentId: doc.id }, { transaction });
      await this.audit.record({ action: 'onboarding.document_submitted', entityType: 'OnboardingCase', entityId: c.id, summary: `Document submitted for "${task.title}"`, metadata: { documentId: doc.id } }, transaction);
    });
    if (access.isSelf && c.createdById) {
      await this.notifications.notify(c.createdById, {
        organizationId: auth.organizationId,
        type: 'onboarding',
        title: `${fullName(access.employee)} uploaded a document to verify`,
        body: task.title,
        link: `/hr/onboarding/${c.id}`,
      });
    }
    return this.get(auth, c.id);
  }

  async verifyTaskDocument(auth: AuthContext, taskId: string, dto: VerifyTaskDocumentDto) {
    const { task, c, access } = await this.taskForAction(auth, taskId);
    if (!access.canVerify) throw AppError.forbidden(access.isSelf ? 'You cannot verify your own documents' : undefined);
    if (!task.documentId) throw AppError.conflict('No document has been submitted for this task');
    await this.documents.review(auth, access.employee.id, task.documentId, { status: dto.status, note: dto.note ?? null }, { employeeId: access.employee.id, reason: 'onboarding' });
    if (dto.status === 'VERIFIED') await this.setStatus(auth, task, c, 'DONE', dto.note ?? null, 'onboarding.document_verified');
    return this.get(auth, c.id);
  }

  async downloadTaskDocument(auth: AuthContext, taskId: string): Promise<{ doc: EmployeeDocument; stream: Readable }> {
    const { task, access } = await this.taskForAction(auth, taskId);
    if (!task.documentId) throw AppError.notFound('Document');
    if (access.isSelf) return this.documents.download(auth, access.employee.id, task.documentId);
    if (!access.canVerify && !access.canManage) throw AppError.forbidden();
    return this.documents.download(auth, access.employee.id, task.documentId, { employeeId: access.employee.id, reason: 'onboarding' });
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  private assertEntitled(auth: AuthContext) {
    if (!auth.features.has('onboarding')) throw AppError.forbidden('Onboarding is not included in your organization’s plan');
  }

  private assertCanAct(assignee: OnboardingTask['assignee'], access: CaseAccess) {
    const ok = access.canManage || (assignee === 'EMPLOYEE' && access.isSelf) || (assignee === 'MANAGER' && access.isManager);
    if (!ok) throw AppError.forbidden(assignee === 'HR' ? 'Only HR can complete this task' : assignee === 'MANAGER' ? "Only the employee's manager or HR can complete this task" : undefined);
  }

  private async setStatus(auth: AuthContext, task: OnboardingTask, c: OnboardingCase, status: OnboardingTask['status'], note: string | null, action: string) {
    await this.db.transaction(async (transaction) => {
      await task.update(
        { status, note, completedAt: status === 'PENDING' ? null : new Date(), completedById: status === 'PENDING' ? null : auth.userId },
        { transaction },
      );
      await this.audit.record({ action, entityType: 'OnboardingCase', entityId: c.id, summary: `"${task.title}": ${status.toLowerCase()}` }, transaction);
    });
  }

  private async find(id: string): Promise<OnboardingCase> {
    const c = await OnboardingCase.findByPk(id, {
      include: [
        { model: Employee, as: 'employee', attributes: EMPLOYEE_ATTRS, include: EMPLOYEE_INCLUDE },
        { model: Employee, as: 'buddy', attributes: ['id', 'firstName', 'lastName', 'employeeCode'] },
        { model: OnboardingTask },
      ],
    });
    if (!c) throw AppError.notFound('Onboarding case');
    return c;
  }

  private async access(auth: AuthContext, c: OnboardingCase): Promise<CaseAccess> {
    this.assertEntitled(auth);
    const employee = c.employee ?? (await Employee.findByPk(c.employeeId, { attributes: EMPLOYEE_ATTRS }))!;
    const self = await this.scope.self(auth);
    const isSelf = self?.id === employee.id;
    const isManager = !!self && employee.managerId === self.id;
    const inScope = !isSelf && (await this.scope.covers(auth, 'onboarding.view', employee));
    return {
      employee,
      isSelf,
      isManager,
      canManage: inScope && auth.permissions.has('onboarding.manage'),
      canVerify: inScope && auth.permissions.has('onboarding.document.verify'),
    };
  }

  private async forManage(auth: AuthContext, id: string) {
    const c = await this.find(id);
    const access = await this.access(auth, c);
    if (!access.canManage) throw access.isSelf ? AppError.forbidden('You cannot manage your own onboarding') : AppError.notFound('Onboarding case');
    if (c.status !== 'IN_PROGRESS') throw AppError.conflict(`This onboarding is ${c.status.toLowerCase().replace('_', ' ')}`);
    return { c, access };
  }

  private async taskForAction(auth: AuthContext, taskId: string) {
    const task = await OnboardingTask.findByPk(taskId);
    if (!task) throw AppError.notFound('Task');
    const c = await this.find(task.caseId);
    const access = await this.access(auth, c);
    if (!access.canManage && !access.canVerify && !access.isSelf && !access.isManager) throw AppError.notFound('Task');
    if (c.status !== 'IN_PROGRESS') throw AppError.conflict(`This onboarding is ${c.status.toLowerCase().replace('_', ' ')}`);
    return { task, c, access };
  }

  private async taskForManage(auth: AuthContext, taskId: string) {
    const task = await OnboardingTask.findByPk(taskId);
    if (!task) throw AppError.notFound('Task');
    const { c, access } = await this.forManage(auth, task.caseId);
    return { task, c, access };
  }

  private async assertBuddy(buddyId: string, employeeId: string) {
    if (buddyId === employeeId) throw AppError.validation([{ field: 'buddyId', message: 'The buddy must be someone else' }]);
    if (!(await Employee.findOne({ where: { id: buddyId, status: ['ACTIVE', 'ON_NOTICE'] }, attributes: ['id'] }))) throw AppError.validation([{ field: 'buddyId', message: 'Buddy not found or not active' }]);
  }

  private async documentsFor(tasks: OnboardingTask[]): Promise<Map<string, DocInfo>> {
    const ids = [...new Set(tasks.map((t) => t.documentId).filter((x): x is string => !!x))];
    if (!ids.length) return new Map();
    const docs = await EmployeeDocument.findAll({ where: { id: ids }, attributes: ['id', 'status', 'title', 'fileName', 'contentType', 'reviewNote', 'createdAt'] });
    return new Map(docs.map((d) => [d.id, d]));
  }

  private async today(organizationId: string): Promise<string> {
    const org = await Organization.findByPk(organizationId, { attributes: ['timezone'] });
    return zonedParts(new Date(), org?.timezone ?? 'UTC').date;
  }

  private employeeRef(e: Employee) {
    return {
      id: e.id,
      name: fullName(e),
      employeeCode: e.employeeCode,
      dateOfJoining: e.dateOfJoining,
      designation: e.designation ? { id: e.designation.id, name: e.designation.name } : null,
      department: e.department ? { id: e.department.id, name: e.department.name } : null,
    };
  }

  private presentTask(t: OnboardingTask, doc: DocInfo | undefined, today: string, names: Map<string, string>) {
    const state = taskState(t, doc);
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      assignee: t.assignee,
      documentCategory: t.documentCategory,
      dueDate: t.dueDate,
      isRequired: t.isRequired,
      state,
      overdue: !finished(state) && t.dueDate < today,
      note: t.note,
      completedAt: t.completedAt,
      completedBy: t.completedById ? (names.get(t.completedById) ?? null) : null,
      document: doc ? { id: doc.id, status: doc.status, title: doc.title, fileName: doc.fileName, contentType: doc.contentType, reviewNote: doc.reviewNote, uploadedAt: doc.createdAt } : null,
    };
  }

  private summary(c: OnboardingCase, docs: Map<string, DocInfo>, today: string) {
    const states = (c.tasks ?? []).map((t) => ({ t, s: taskState(t, t.documentId ? docs.get(t.documentId) : undefined) }));
    const required = states.filter((x) => x.t.isRequired);
    return {
      id: c.id,
      status: c.status,
      joiningDate: c.joiningDate,
      progress: {
        total: states.length,
        done: states.filter((x) => finished(x.s)).length,
        requiredOpen: required.filter((x) => !finished(x.s)).length,
        overdue: states.filter((x) => !finished(x.s) && x.t.dueDate < today).length,
        awaitingVerification: states.filter((x) => x.s === 'SUBMITTED').length,
      },
      completedAt: c.completedAt,
      cancelledAt: c.cancelledAt,
      createdAt: c.createdAt,
    };
  }

  private async detail(auth: AuthContext, c: OnboardingCase, access: CaseAccess) {
    const tasks = [...(c.tasks ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.dueDate.localeCompare(b.dueDate));
    const docs = await this.documentsFor(tasks);
    const today = await this.today(auth.organizationId!);
    const actorIds = [...new Set(tasks.map((t) => t.completedById).filter((x): x is string => !!x))];
    const names = new Map((actorIds.length ? await User.findAll({ where: { id: actorIds }, attributes: ['id', 'firstName', 'lastName'] }) : []).map((u) => [u.id, fullName(u)]));
    const manager = access.employee.managerId ? await Employee.findByPk(access.employee.managerId, { attributes: ['id', 'firstName', 'lastName', 'employeeCode'] }) : null;
    return {
      ...this.summary(c, docs, today),
      employee: this.employeeRef(access.employee),
      manager: manager ? { id: manager.id, name: fullName(manager), employeeCode: manager.employeeCode } : null,
      buddy: c.buddy ? { id: c.buddy.id, name: fullName(c.buddy), employeeCode: c.buddy.employeeCode } : null,
      notes: c.notes,
      cancelReason: c.cancelReason,
      tasks: tasks.map((t) => this.presentTask(t, t.documentId ? docs.get(t.documentId) : undefined, today, names)),
      permissions: { manage: access.canManage, verify: access.canVerify, isSelf: access.isSelf, isManager: access.isManager },
    };
  }

  private async userIdOf(membershipId: string | null | undefined): Promise<string | null> {
    if (!membershipId) return null;
    const m = await OrganizationMembership.findByPk(membershipId, { attributes: ['userId', 'status'] });
    return m && m.status !== 'SUSPENDED' ? m.userId : null;
  }
}
