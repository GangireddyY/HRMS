import { Injectable } from '@nestjs/common';
import { col, fn, literal, Op, type Transaction, type WhereOptions } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { DatabaseService } from '../../database/database.service';
import { Department, Designation, Employee, JobApplication, JobOpening, JobRequisition, Location, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { RequisitionDto, RequisitionQueryDto, ReviewRequisitionDto, UpdateRequisitionDto } from './dto/recruitment.dto';
import { fullName } from '../../common/utils/names';

const ref = (r: { id: string; name: string } | null | undefined) => (r ? { id: r.id, name: r.name } : null);
const num = (v: string | null) => (v === null ? null : Number(v));

const INCLUDE = [
  { model: Department, attributes: ['id', 'name'] },
  { model: Designation, attributes: ['id', 'name'] },
  { model: Location, attributes: ['id', 'name'] },
  { model: Employee, as: 'hiringManager', attributes: ['id', 'firstName', 'lastName', 'employeeCode'] },
  { model: JobOpening, attributes: ['id', 'status', 'title'] },
];

/**
 * Manpower requisitions. Raised with recruitment.requisition.create; approved by someone with
 * recruitment.requisition.approve covering the requisition's department (ORGANIZATION = any, DEPARTMENT / TEAM = own
 * department) — never by the person who raised it. Recruiters open jobs only from approved requisitions.
 */
@Injectable()
export class RequisitionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(auth: AuthContext, query: RequisitionQueryDto) {
    this.assertEntitled(auth);
    const view = query.view ?? 'all';
    const filters: WhereOptions[] = [];
    if (view === 'mine') filters.push(await this.mineWhere(auth));
    else if (view === 'approve') {
      const where = await this.approvableWhere(auth);
      if (!where) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push(where, { status: 'PENDING_APPROVAL' });
    } else filters.push(await this.visibleWhere(auth));
    if (query.status) filters.push({ status: query.status });
    if (query.search) filters.push({ [Op.or]: [{ title: { [Op.iLike]: containsPattern(query.search) } }, { code: { [Op.iLike]: containsPattern(query.search) } }] });
    const { rows, count } = await JobRequisition.findAndCountAll({
      where: { [Op.and]: filters },
      include: INCLUDE,
      order: [
        [literal(`CASE WHEN "JobRequisition"."status" = 'PENDING_APPROVAL' THEN 0 ELSE 1 END`), 'ASC'],
        ['createdAt', 'DESC'],
      ],
      distinct: true,
      ...paginationArgs(query),
    });
    return new PaginatedResult(await this.present(auth, rows), paginationMeta(query, count));
  }

  async get(auth: AuthContext, id: string) {
    const r = await this.findVisible(auth, id);
    return (await this.present(auth, [r]))[0]!;
  }

  async create(auth: AuthContext, dto: RequisitionDto) {
    await this.validate(dto);
    const self = await this.scope.self(auth);
    const r = await this.db.transaction(async (transaction) => {
      const created = await JobRequisition.create(
        {
          organizationId: auth.organizationId!,
          code: await this.nextCode(transaction),
          title: dto.title,
          departmentId: dto.departmentId ?? self?.departmentId ?? null,
          designationId: dto.designationId ?? null,
          locationId: dto.locationId ?? null,
          hiringManagerId: dto.hiringManagerId === undefined ? (self?.id ?? null) : dto.hiringManagerId,
          employmentType: dto.employmentType ?? 'FULL_TIME',
          openings: dto.openings ?? 1,
          reason: dto.reason,
          justification: dto.justification,
          budgetMin: dto.budgetMin === undefined || dto.budgetMin === null ? null : String(dto.budgetMin),
          budgetMax: dto.budgetMax === undefined || dto.budgetMax === null ? null : String(dto.budgetMax),
          targetDate: dto.targetDate ?? null,
          status: dto.submit ? 'PENDING_APPROVAL' : 'DRAFT',
          submittedAt: dto.submit ? new Date() : null,
          requestedById: auth.userId,
        },
        { transaction },
      );
      await this.audit.record(
        { action: 'requisition.created', entityType: 'JobRequisition', entityId: created.id, summary: `Requisition ${created.code} – ${created.title} ${dto.submit ? 'submitted' : 'drafted'}` },
        transaction,
      );
      return created;
    });
    return this.get(auth, r.id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateRequisitionDto) {
    const r = await this.findVisible(auth, id);
    if (r.requestedById !== auth.userId && !auth.permissions.has('recruitment.manage')) throw AppError.forbidden();
    if (!['DRAFT', 'REJECTED'].includes(r.status)) throw AppError.conflict('Only draft or rejected requisitions can be edited');
    await this.validate({ ...this.plain(r), ...dto });
    const { submit, budgetMin, budgetMax, ...rest } = dto;
    await this.db.transaction(async (transaction) => {
      await r.update(
        {
          ...rest,
          ...(budgetMin !== undefined ? { budgetMin: budgetMin === null ? null : String(budgetMin) } : {}),
          ...(budgetMax !== undefined ? { budgetMax: budgetMax === null ? null : String(budgetMax) } : {}),
          ...(submit ? { status: 'PENDING_APPROVAL' as const, submittedAt: new Date(), reviewedById: null, reviewedAt: null, reviewNote: null } : {}),
        },
        { transaction },
      );
      await this.audit.record(
        { action: submit ? 'requisition.submitted' : 'requisition.updated', entityType: 'JobRequisition', entityId: id, summary: `Requisition ${r.code} ${submit ? 'submitted' : 'updated'}` },
        transaction,
      );
    });
    return this.get(auth, id);
  }

  async approve(auth: AuthContext, id: string, dto: ReviewRequisitionDto) {
    const r = await this.forDecision(auth, id);
    await this.decide(auth, r, 'APPROVED', dto.note ?? null);
    return this.get(auth, id);
  }

  async reject(auth: AuthContext, id: string, dto: ReviewRequisitionDto) {
    if (!dto.note) throw AppError.validation([{ field: 'note', message: 'Explain why the requisition is rejected' }]);
    const r = await this.forDecision(auth, id);
    await this.decide(auth, r, 'REJECTED', dto.note);
    return this.get(auth, id);
  }

  async cancel(auth: AuthContext, id: string) {
    const r = await this.findVisible(auth, id);
    if (r.requestedById !== auth.userId && !auth.permissions.has('recruitment.manage')) throw AppError.forbidden();
    if (['CANCELLED', 'FILLED'].includes(r.status)) throw AppError.conflict(`This requisition is already ${r.status.toLowerCase()}`);
    await this.db.transaction(async (transaction) => {
      await r.update({ status: 'CANCELLED' }, { transaction });
      await JobOpening.update({ status: 'CLOSED', closedAt: new Date() }, { where: { requisitionId: id, status: { [Op.ne]: 'CLOSED' } }, transaction });
      await this.audit.record({ action: 'requisition.cancelled', entityType: 'JobRequisition', entityId: id, summary: `Requisition ${r.code} cancelled` }, transaction);
    });
    return this.get(auth, id);
  }

  // ---------------------------------------------------------------------------------------------

  /** Whether the caller may approve requisitions of this department (excluding their own requests). */
  async canApprove(auth: AuthContext, r: Pick<JobRequisition, 'departmentId' | 'requestedById'>): Promise<boolean> {
    if (r.requestedById === auth.userId) return false;
    const scope = auth.permissions.get('recruitment.requisition.approve');
    if (!scope || scope === 'OWN') return false;
    if (scope === 'ORGANIZATION') return true;
    const self = await this.scope.self(auth);
    return !!self?.departmentId && r.departmentId === self.departmentId;
  }

  private async approvableWhere(auth: AuthContext): Promise<WhereOptions | null> {
    const scope = auth.permissions.get('recruitment.requisition.approve');
    if (!scope || scope === 'OWN') return null;
    const notMine = { [Op.or]: [{ requestedById: null }, { requestedById: { [Op.ne]: auth.userId } }] };
    if (scope === 'ORGANIZATION') return notMine;
    const self = await this.scope.self(auth);
    if (!self?.departmentId) return null;
    return { [Op.and]: [notMine, { departmentId: self.departmentId }] };
  }

  private async mineWhere(auth: AuthContext): Promise<WhereOptions> {
    const self = await this.scope.self(auth);
    return { [Op.or]: [{ requestedById: auth.userId }, ...(self ? [{ hiringManagerId: self.id }] : [])] };
  }

  /** Recruiters see all; others see what they raised, manage the hire for, or may approve. */
  private async visibleWhere(auth: AuthContext): Promise<WhereOptions> {
    if (auth.permissions.has('recruitment.view')) return {};
    const parts = [await this.mineWhere(auth)];
    const approvable = await this.approvableWhere(auth);
    if (approvable) parts.push(approvable);
    return { [Op.or]: parts };
  }

  private assertEntitled(auth: AuthContext) {
    if (!auth.features.has('recruitment')) throw AppError.forbidden('Recruitment is not included in your organization’s plan');
  }

  private async findVisible(auth: AuthContext, id: string): Promise<JobRequisition> {
    this.assertEntitled(auth);
    const r = await JobRequisition.findOne({ where: { [Op.and]: [{ id }, await this.visibleWhere(auth)] }, include: INCLUDE });
    if (!r) throw AppError.notFound('Requisition');
    return r;
  }

  private async forDecision(auth: AuthContext, id: string): Promise<JobRequisition> {
    const r = await JobRequisition.findByPk(id);
    if (!r) throw AppError.notFound('Requisition');
    if (r.requestedById === auth.userId) throw AppError.forbidden('Someone other than the requester must approve a requisition');
    if (!(await this.canApprove(auth, r))) throw AppError.notFound('Requisition');
    if (r.status !== 'PENDING_APPROVAL') throw AppError.conflict(`This requisition is ${r.status.toLowerCase().replace('_', ' ')}`);
    return r;
  }

  private async decide(auth: AuthContext, r: JobRequisition, status: 'APPROVED' | 'REJECTED', note: string | null) {
    await this.db.transaction(async (transaction) => {
      const [count] = await JobRequisition.update({ status, reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: note }, { where: { id: r.id, status: 'PENDING_APPROVAL' }, transaction });
      if (!count) throw AppError.conflict('This requisition was already decided');
      await this.audit.record({ action: `requisition.${status.toLowerCase()}`, entityType: 'JobRequisition', entityId: r.id, summary: `Requisition ${r.code} ${status.toLowerCase()}` }, transaction);
    });
    if (r.requestedById && r.requestedById !== auth.userId) {
      await this.notifications.notify(r.requestedById, {
        organizationId: auth.organizationId,
        type: 'recruitment.requisition',
        title: `Requisition ${r.code} (${r.title}) was ${status.toLowerCase()}`,
        body: note ?? undefined,
        link: '/hr/recruitment/requisitions',
      });
    }
  }

  private async validate(dto: Partial<RequisitionDto>) {
    const issues = [];
    if (dto.budgetMin != null && dto.budgetMax != null && dto.budgetMax < dto.budgetMin) issues.push({ field: 'budgetMax', message: 'The maximum must be at least the minimum' });
    const checks: [keyof RequisitionDto, () => Promise<unknown>][] = [
      ['departmentId', () => Department.findByPk(dto.departmentId!, { attributes: ['id'] })],
      ['designationId', () => Designation.findByPk(dto.designationId!, { attributes: ['id'] })],
      ['locationId', () => Location.findByPk(dto.locationId!, { attributes: ['id'] })],
      ['hiringManagerId', () => Employee.findOne({ where: { id: dto.hiringManagerId!, status: ['ACTIVE', 'ON_NOTICE'] }, attributes: ['id'] })],
    ];
    for (const [field, load] of checks) if (dto[field] && !(await load())) issues.push({ field, message: `${field.replace('Id', '')} not found` });
    if (issues.length) throw AppError.validation(issues);
  }

  private plain(r: JobRequisition): Partial<RequisitionDto> {
    return { departmentId: r.departmentId, designationId: r.designationId, locationId: r.locationId, hiringManagerId: r.hiringManagerId, budgetMin: num(r.budgetMin), budgetMax: num(r.budgetMax) };
  }

  private async nextCode(transaction: Transaction): Promise<string> {
    const rows = await JobRequisition.findAll({ attributes: ['code'], raw: true, transaction, lock: transaction.LOCK.UPDATE });
    const max = rows.reduce((m, r) => Math.max(m, Number(/^REQ-(\d+)$/.exec(r.code)?.[1] ?? 0)), 0);
    return `REQ-${String(max + 1).padStart(4, '0')}`;
  }

  private async present(auth: AuthContext, rows: JobRequisition[]) {
    const jobIds = rows.map((r) => r.job?.id).filter((x): x is string => !!x);
    const counts = jobIds.length
      ? ((await JobApplication.findAll({ where: { jobId: jobIds }, attributes: ['jobId', 'stage', [fn('COUNT', col('id')), 'count']], group: ['jobId', 'stage'], raw: true })) as unknown as {
          jobId: string;
          stage: string;
          count: string;
        }[])
      : [];
    const userIds = [...new Set(rows.flatMap((r) => [r.requestedById, r.reviewedById]).filter((x): x is string => !!x))];
    const users = new Map((userIds.length ? await User.findAll({ where: { id: userIds }, attributes: ['id', 'firstName', 'lastName'] }) : []).map((u) => [u.id, fullName(u)]));
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        code: r.code,
        title: r.title,
        department: ref(r.department),
        designation: ref(r.designation),
        location: ref(r.location),
        hiringManager: r.hiringManager ? { id: r.hiringManager.id, name: fullName(r.hiringManager), employeeCode: r.hiringManager.employeeCode } : null,
        employmentType: r.employmentType,
        openings: r.openings,
        hiredCount: r.hiredCount,
        reason: r.reason,
        justification: r.justification,
        budgetMin: num(r.budgetMin),
        budgetMax: num(r.budgetMax),
        targetDate: r.targetDate,
        status: r.status,
        requestedBy: r.requestedById ? (users.get(r.requestedById) ?? null) : null,
        submittedAt: r.submittedAt,
        reviewedBy: r.reviewedById ? (users.get(r.reviewedById) ?? null) : null,
        reviewedAt: r.reviewedAt,
        reviewNote: r.reviewNote,
        createdAt: r.createdAt,
        job: r.job ? { id: r.job.id, status: r.job.status, pipeline: Object.fromEntries(counts.filter((c) => c.jobId === r.job!.id).map((c) => [c.stage, Number(c.count)])) } : null,
        permissions: {
          edit: ['DRAFT', 'REJECTED'].includes(r.status) && (r.requestedById === auth.userId || auth.permissions.has('recruitment.manage')),
          decide: r.status === 'PENDING_APPROVAL' && (await this.canApprove(auth, r)),
        },
      })),
    );
  }
}
