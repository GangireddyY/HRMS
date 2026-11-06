import { Injectable } from '@nestjs/common';
import { col, fn, Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import type { JobStatus } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { DatabaseService } from '../../database/database.service';
import { Department, Designation, Employee, JobApplication, JobOpening, JobRequisition, Location } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import type { JobDto, JobQueryDto, UpdateJobDto } from './dto/recruitment.dto';

const ref = (r: { id: string; name: string } | null | undefined) => (r ? { id: r.id, name: r.name } : null);
const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();
const REQUISITION_INCLUDE = {
  model: JobRequisition,
  include: [
    { model: Department, attributes: ['id', 'name'] },
    { model: Designation, attributes: ['id', 'name'] },
    { model: Location, attributes: ['id', 'name'] },
    { model: Employee, as: 'hiringManager', attributes: ['id', 'firstName', 'lastName'] },
  ],
};

const TRANSITIONS: Record<JobStatus, JobStatus[]> = { DRAFT: ['OPEN', 'CLOSED'], OPEN: ['ON_HOLD', 'CLOSED'], ON_HOLD: ['OPEN', 'CLOSED'], CLOSED: ['OPEN'] };

/** Job openings, created from approved requisitions (recruitment.manage). */
@Injectable()
export class JobsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(query: JobQueryDto) {
    const filters: WhereOptions[] = [];
    if (query.status) filters.push({ status: query.status });
    if (query.search) filters.push({ title: { [Op.iLike]: containsPattern(query.search) } });
    const { rows, count } = await JobOpening.findAndCountAll({ where: { [Op.and]: filters }, include: [REQUISITION_INCLUDE], order: [['status', 'ASC'], ['createdAt', 'DESC']], distinct: true, ...paginationArgs(query) });
    const counts = await this.counts(rows.map((r) => r.id));
    return new PaginatedResult(rows.map((j) => this.present(j, counts.get(j.id) ?? {})), paginationMeta(query, count));
  }

  async get(id: string) {
    const j = await this.find(id);
    return { ...this.present(j, (await this.counts([id])).get(id) ?? {}), description: j.description, requirements: j.requirements };
  }

  async create(auth: AuthContext, dto: JobDto) {
    const r = await JobRequisition.findByPk(dto.requisitionId);
    if (!r) throw AppError.validation([{ field: 'requisitionId', message: 'Requisition not found' }]);
    if (r.status !== 'APPROVED') throw AppError.validation([{ field: 'requisitionId', message: 'Jobs can only be opened for approved requisitions' }]);
    this.assertExperience(dto.experienceMin, dto.experienceMax);
    try {
      const job = await this.db.transaction(async (transaction) => {
        const created = await JobOpening.create(
          {
            organizationId: auth.organizationId!,
            requisitionId: r.id,
            title: dto.title ?? r.title,
            description: dto.description,
            requirements: dto.requirements ?? null,
            experienceMin: dto.experienceMin ?? null,
            experienceMax: dto.experienceMax ?? null,
            isPublic: dto.isPublic ?? false,
            closesOn: dto.closesOn ?? null,
            createdById: auth.userId,
            updatedById: auth.userId,
          },
          { transaction },
        );
        await this.audit.record({ action: 'job.created', entityType: 'JobOpening', entityId: created.id, summary: `Job "${created.title}" created from ${r.code}` }, transaction);
        return created;
      });
      return this.get(job.id);
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict('A job already exists for this requisition');
      throw e;
    }
  }

  async update(auth: AuthContext, id: string, dto: UpdateJobDto) {
    const j = await this.find(id);
    const { requisitionId: _ignored, ...rest } = dto;
    this.assertExperience(rest.experienceMin !== undefined ? rest.experienceMin : j.experienceMin, rest.experienceMax !== undefined ? rest.experienceMax : j.experienceMax);
    await this.db.transaction(async (transaction) => {
      await j.update({ ...rest, updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'job.updated', entityType: 'JobOpening', entityId: id, summary: `Job "${j.title}" updated` }, transaction);
    });
    return this.get(id);
  }

  async setStatus(auth: AuthContext, id: string, status: JobStatus) {
    const j = await this.find(id);
    if (!TRANSITIONS[j.status as JobStatus].includes(status)) throw AppError.conflict(`A ${j.status.toLowerCase().replace('_', ' ')} job cannot become ${status.toLowerCase().replace('_', ' ')}`);
    if (status === 'OPEN' && j.requisition!.status !== 'APPROVED') throw AppError.conflict(`The requisition is ${j.requisition!.status.toLowerCase()}; the job cannot open`);
    await this.db.transaction(async (transaction) => {
      await j.update({ status, ...(status === 'OPEN' ? { openedAt: j.openedAt ?? new Date(), closedAt: null } : {}), ...(status === 'CLOSED' ? { closedAt: new Date() } : {}), updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: `job.${status.toLowerCase()}`, entityType: 'JobOpening', entityId: id, summary: `Job "${j.title}" ${status.toLowerCase().replace('_', ' ')}` }, transaction);
    });
    return this.get(id);
  }

  async find(id: string): Promise<JobOpening> {
    const j = await JobOpening.findByPk(id, { include: [REQUISITION_INCLUDE] });
    if (!j) throw AppError.notFound('Job');
    return j;
  }

  private assertExperience(min: number | null | undefined, max: number | null | undefined) {
    if (min != null && max != null && max < min) throw AppError.validation([{ field: 'experienceMax', message: 'The maximum must be at least the minimum' }]);
  }

  private async counts(jobIds: string[]): Promise<Map<string, Record<string, number>>> {
    if (!jobIds.length) return new Map();
    const rows = (await JobApplication.findAll({ where: { jobId: jobIds }, attributes: ['jobId', 'stage', [fn('COUNT', col('id')), 'count']], group: ['jobId', 'stage'], raw: true })) as unknown as { jobId: string; stage: string; count: string }[];
    const out = new Map<string, Record<string, number>>();
    for (const r of rows) out.set(r.jobId, { ...(out.get(r.jobId) ?? {}), [r.stage]: Number(r.count) });
    return out;
  }

  present(j: JobOpening, pipeline: Record<string, number>) {
    const r = j.requisition!;
    return {
      id: j.id,
      title: j.title,
      status: j.status,
      isPublic: j.isPublic,
      closesOn: j.closesOn,
      experienceMin: j.experienceMin,
      experienceMax: j.experienceMax,
      openedAt: j.openedAt,
      closedAt: j.closedAt,
      createdAt: j.createdAt,
      requisition: {
        id: r.id,
        code: r.code,
        status: r.status,
        openings: r.openings,
        hiredCount: r.hiredCount,
        employmentType: r.employmentType,
        department: ref(r.department),
        designation: ref(r.designation),
        location: ref(r.location),
        hiringManager: r.hiringManager ? { id: r.hiringManager.id, name: fullName(r.hiringManager) } : null,
      },
      pipeline,
    };
  }
}
