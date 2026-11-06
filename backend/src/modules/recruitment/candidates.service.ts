import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { col, fn, Op, UniqueConstraintError, where, type Transaction, type WhereOptions } from 'sequelize';
import { RESUME_MAX_BYTES, type ResumeContentType } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { DatabaseService } from '../../database/database.service';
import { ApplicationEvent, Candidate, Employee, JobApplication, JobOpening } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import type { CandidateDto, CandidateQueryDto, UpdateCandidateDto } from './dto/recruitment.dto';

export interface UploadedResume {
  buffer: Buffer;
  size: number;
  originalname: string;
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();
const num = (v: string | null) => (v === null ? null : Number(v));
const digits = (p: string | null | undefined) => (p ?? '').replace(/\D/g, '').slice(-10);

/** PDF, or a Word document (a ZIP package containing word/document.xml); detected from the bytes. */
export function detectResumeType(data: Buffer): ResumeContentType | null {
  if (data.length >= 5 && data.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04 && data.includes('word/document.xml')) return DOCX;
  return null;
}

export function presentCandidate(c: Candidate) {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    name: fullName(c),
    email: c.email,
    phone: c.phone,
    currentCompany: c.currentCompany,
    currentTitle: c.currentTitle,
    experienceYears: num(c.experienceYears),
    currentCtc: num(c.currentCtc),
    expectedCtc: num(c.expectedCtc),
    noticePeriodDays: c.noticePeriodDays,
    location: c.location,
    linkedinUrl: c.linkedinUrl,
    source: c.source,
    referredBy: c.referredBy ? { id: c.referredBy.id, name: fullName(c.referredBy) } : null,
    notes: c.notes,
    resume: c.resumeKey ? { fileName: c.resumeFileName, contentType: c.resumeContentType, size: c.resumeSize, uploadedAt: c.resumeUploadedAt } : null,
    consentAt: c.consentAt,
    createdAt: c.createdAt,
  };
}

/** The candidate database (recruitment.view / recruitment.manage). Email is unique per organization; phone matches are flagged. */
@Injectable()
export class CandidatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async list(query: CandidateQueryDto) {
    const filters: WhereOptions[] = [];
    if (query.source) filters.push({ source: query.source });
    if (query.search) {
      const p = containsPattern(query.search);
      filters.push({ [Op.or]: [{ firstName: { [Op.iLike]: p } }, { lastName: { [Op.iLike]: p } }, { email: { [Op.iLike]: p } }, { phone: { [Op.iLike]: p } }, { currentCompany: { [Op.iLike]: p } }, { currentTitle: { [Op.iLike]: p } }] });
    }
    const { rows, count } = await Candidate.findAndCountAll({
      where: { [Op.and]: filters },
      include: [{ model: Employee, as: 'referredBy', attributes: ['id', 'firstName', 'lastName'] }, { model: JobApplication, attributes: ['id', 'stage', 'jobId'], include: [{ model: JobOpening, attributes: ['id', 'title'] }] }],
      order: [['createdAt', 'DESC']],
      distinct: true,
      ...paginationArgs(query),
    });
    return new PaginatedResult(
      rows.map((c) => ({ ...presentCandidate(c), applications: (c.applications ?? []).map((a) => ({ id: a.id, stage: a.stage, job: { id: a.job!.id, title: a.job!.title } })) })),
      paginationMeta(query, count),
    );
  }

  async get(id: string) {
    const c = await this.find(id);
    const apps = await JobApplication.findAll({ where: { candidateId: id }, include: [{ model: JobOpening, attributes: ['id', 'title', 'status'] }], order: [['createdAt', 'DESC']] });
    return { ...presentCandidate(c), applications: apps.map((a) => ({ id: a.id, stage: a.stage, stageChangedAt: a.stageChangedAt, job: { id: a.job!.id, title: a.job!.title, status: a.job!.status } })) };
  }

  /** Existing candidates with the same email or phone (last 10 digits). */
  async duplicates(email?: string, phone?: string) {
    const ors: WhereOptions[] = [];
    if (email) ors.push({ email: email.toLowerCase() });
    const d = digits(phone);
    if (d.length >= 7) ors.push(where(fn('regexp_replace', col('phone'), '[^0-9]', '', 'g'), { [Op.like]: `%${d}` }));
    if (!ors.length) return [];
    const rows = await Candidate.findAll({ where: { [Op.or]: ors }, limit: 20 });
    return rows
      .filter((c) => (email && c.email === email.toLowerCase()) || (d.length >= 7 && digits(c.phone) === d))
      .map((c) => ({ id: c.id, name: fullName(c), email: c.email, phone: c.phone, match: email && c.email === email.toLowerCase() ? ('EMAIL' as const) : ('PHONE' as const) }));
  }

  async create(auth: AuthContext, dto: CandidateDto) {
    const existing = await Candidate.findOne({ where: { email: dto.email }, attributes: ['id', 'firstName', 'lastName'] });
    if (existing) throw AppError.conflict(`${fullName(existing)} is already in the candidate database with this email (candidate ${existing.id})`);
    if (dto.referredById && !(await Employee.findByPk(dto.referredById, { attributes: ['id'] }))) throw AppError.validation([{ field: 'referredById', message: 'Referrer not found' }]);
    const job = dto.jobId ? await JobOpening.findByPk(dto.jobId) : null;
    if (dto.jobId && (!job || job.status !== 'OPEN')) throw AppError.validation([{ field: 'jobId', message: 'The job is not open' }]);
    try {
      const c = await this.db.transaction(async (transaction) => {
        const created = await Candidate.create({ ...this.values(dto), organizationId: auth.organizationId!, email: dto.email, firstName: dto.firstName, lastName: dto.lastName, createdById: auth.userId, updatedById: auth.userId }, { transaction });
        if (job) await this.addApplication(auth.organizationId!, job.id, created.id, created.source, auth.userId, transaction);
        await this.audit.record({ action: 'candidate.created', entityType: 'Candidate', entityId: created.id, summary: `Candidate ${fullName(created)} added${job ? ` to "${job.title}"` : ''}` }, transaction);
        return created;
      });
      return this.get(c.id);
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict('A candidate with this email already exists');
      throw e;
    }
  }

  async update(auth: AuthContext, id: string, dto: UpdateCandidateDto) {
    const c = await this.find(id);
    if (dto.email && dto.email !== c.email && (await Candidate.count({ where: { email: dto.email } }))) throw AppError.conflict('Another candidate already uses this email');
    const { jobId: _ignored, ...rest } = dto;
    await this.db.transaction(async (transaction) => {
      await c.update({ ...this.values(rest), ...(rest.email ? { email: rest.email } : {}), ...(rest.firstName ? { firstName: rest.firstName } : {}), ...(rest.lastName ? { lastName: rest.lastName } : {}), updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'candidate.updated', entityType: 'Candidate', entityId: id, summary: `Candidate ${fullName(c)} updated` }, transaction);
    });
    return this.get(id);
  }

  /** Removes the candidate, their applications and resume (e.g. on a data-deletion request). Hired candidates are kept. */
  async remove(auth: AuthContext, id: string): Promise<void> {
    const c = await this.find(id);
    if (await JobApplication.count({ where: { candidateId: id, stage: 'HIRED' } })) throw AppError.conflict('This candidate was hired; their record is kept with the employee history.');
    await this.db.transaction(async (transaction) => {
      await c.destroy({ transaction });
      await this.audit.record({ action: 'candidate.deleted', entityType: 'Candidate', entityId: id, summary: `Candidate ${fullName(c)} deleted` }, transaction);
    });
    if (c.resumeKey) await this.storage.deleteQuietly([c.resumeKey]);
  }

  async uploadResume(auth: AuthContext | null, organizationId: string, candidate: Candidate, file: UploadedResume | undefined, transaction?: Transaction): Promise<void> {
    if (!file?.buffer?.length) throw AppError.validation([{ field: 'file', message: 'Choose a resume to upload' }]);
    if (file.size > RESUME_MAX_BYTES) throw AppError.validation([{ field: 'file', message: 'The resume must be 5 MB or smaller' }]);
    const type = detectResumeType(file.buffer);
    if (!type) throw AppError.validation([{ field: 'file', message: 'Upload the resume as a PDF or Word (.docx) file' }]);
    const key = `organizations/${organizationId}/candidates/${candidate.id}/resumes/${randomUUID()}`;
    const ext = type === 'application/pdf' ? 'pdf' : 'docx';
    const stem = (file.originalname.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '').replace(/\.[^.]*$/, '').trim().slice(0, 200) || `${fullName(candidate)} resume`;
    await this.storage.put(key, file.buffer, type);
    const previous = candidate.resumeKey;
    try {
      await candidate.update({ resumeKey: key, resumeFileName: `${stem}.${ext}`, resumeContentType: type, resumeSize: file.size, resumeUploadedAt: new Date(), ...(auth ? { updatedById: auth.userId } : {}) }, { transaction });
    } catch (e) {
      await this.storage.deleteQuietly([key]);
      throw e;
    }
    if (previous) await this.storage.deleteQuietly([previous]);
  }

  async replaceResume(auth: AuthContext, id: string, file: UploadedResume | undefined) {
    const c = await this.find(id);
    await this.db.transaction(async (transaction) => {
      await this.uploadResume(auth, auth.organizationId!, c, file, transaction);
      await this.audit.record({ action: 'candidate.resume_uploaded', entityType: 'Candidate', entityId: id, summary: `Resume uploaded for ${fullName(c)}` }, transaction);
    });
    return this.get(id);
  }

  async resume(id: string): Promise<{ stream: Readable; fileName: string; contentType: string; size: number }> {
    const c = await Candidate.findByPk(id, { attributes: ['id', 'resumeKey', 'resumeFileName', 'resumeContentType', 'resumeSize'] });
    if (!c?.resumeKey) throw AppError.notFound('Resume');
    return { stream: await this.storage.get(c.resumeKey), fileName: c.resumeFileName!, contentType: c.resumeContentType!, size: c.resumeSize! };
  }

  async addApplication(organizationId: string, jobId: string, candidateId: string, source: Candidate['source'], userId: string | null, transaction: Transaction) {
    const app = await JobApplication.create({ organizationId, jobId, candidateId, source: source ?? 'DIRECT', createdById: userId }, { transaction });
    await ApplicationEvent.create({ organizationId, applicationId: app.id, fromStage: null, toStage: 'APPLIED', createdById: userId }, { transaction });
    return app;
  }

  async find(id: string): Promise<Candidate> {
    const c = await Candidate.findByPk(id, { include: [{ model: Employee, as: 'referredBy', attributes: ['id', 'firstName', 'lastName'] }] });
    if (!c) throw AppError.notFound('Candidate');
    return c;
  }

  private values(dto: Partial<CandidateDto>): Partial<Candidate> {
    const out: Partial<Candidate> = {};
    const set = <K extends keyof Candidate>(k: K, v: Candidate[K] | undefined) => {
      if (v !== undefined) out[k] = v;
    };
    set('phone', dto.phone);
    set('currentCompany', dto.currentCompany);
    set('currentTitle', dto.currentTitle);
    set('experienceYears', dto.experienceYears === undefined ? undefined : dto.experienceYears === null ? null : String(dto.experienceYears));
    set('currentCtc', dto.currentCtc === undefined ? undefined : dto.currentCtc === null ? null : String(dto.currentCtc));
    set('expectedCtc', dto.expectedCtc === undefined ? undefined : dto.expectedCtc === null ? null : String(dto.expectedCtc));
    set('noticePeriodDays', dto.noticePeriodDays);
    set('location', dto.location);
    set('linkedinUrl', dto.linkedinUrl);
    set('source', dto.source);
    set('referredById', dto.referredById);
    set('notes', dto.notes);
    return out;
  }
}
