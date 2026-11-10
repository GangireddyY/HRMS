import { Injectable } from '@nestjs/common';
import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import { PIPELINE_STAGES, type ApplicationStage } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { DatabaseService } from '../../database/database.service';
import { ApplicationEvent, Candidate, Designation, Employee, Interview, InterviewPanelist, JobApplication, JobOpening, Offer, OrganizationMembership, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CandidatesService, presentCandidate } from './candidates.service';
import type { AddApplicationDto, ApplicationQueryDto, FeedbackDto, InterviewDto, MoveStageDto, UpdateInterviewDto } from './dto/recruitment.dto';
import { fullName } from '../../common/utils/names';

const ACTIVE: readonly ApplicationStage[] = PIPELINE_STAGES;
const isActive = (s: ApplicationStage) => ACTIVE.includes(s);

/**
 * Applications move through the pipeline (recruitment.manage). Interviews have a panel of employees; each panelist
 * submits their own feedback once (recruitment.interview.feedback), and sees colleagues' feedback only after submitting.
 */
@Injectable()
export class PipelineService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly candidates: CandidatesService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Applications ----------------------------------------------------------------------------

  async list(query: ApplicationQueryDto) {
    const filters: WhereOptions[] = [];
    if (query.jobId) filters.push({ jobId: query.jobId });
    if (query.stage) filters.push({ stage: query.stage });
    const { rows, count } = await JobApplication.findAndCountAll({
      where: { [Op.and]: filters },
      include: [
        { model: Candidate, attributes: ['id', 'firstName', 'lastName', 'email', 'phone', 'currentCompany', 'currentTitle', 'experienceYears', 'resumeKey', 'source'] },
        { model: JobOpening, attributes: ['id', 'title'] },
        { model: Interview, attributes: ['id', 'status', 'scheduledAt'], include: [{ model: InterviewPanelist, attributes: ['id', 'recommendation', 'rating', 'submittedAt'] }] },
      ],
      order: [['stageChangedAt', 'DESC']],
      distinct: true,
      ...paginationArgs({ ...query, pageSize: Math.min(query.pageSize, 100) }),
    });
    return new PaginatedResult(
      rows.map((a) => this.summary(a)),
      paginationMeta(query, count),
    );
  }

  async add(auth: AuthContext, jobId: string, dto: AddApplicationDto) {
    const job = await JobOpening.findByPk(jobId);
    if (!job) throw AppError.notFound('Job');
    if (job.status !== 'OPEN') throw AppError.conflict('Candidates can only be added to open jobs');
    const candidate = await Candidate.findByPk(dto.candidateId, { attributes: ['id', 'firstName', 'lastName', 'source'] });
    if (!candidate) throw AppError.validation([{ field: 'candidateId', message: 'Candidate not found' }]);
    try {
      const app = await this.db.transaction(async (transaction) => {
        const created = await this.candidates.addApplication(auth.organizationId!, jobId, candidate.id, dto.source ?? candidate.source, auth.userId, transaction);
        await this.audit.record({ action: 'application.created', entityType: 'JobApplication', entityId: created.id, summary: `${fullName(candidate)} added to "${job.title}"` }, transaction);
        return created;
      });
      return this.get(auth, app.id);
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict(`${fullName(candidate)} is already in this job's pipeline`);
      throw e;
    }
  }

  async get(auth: AuthContext, id: string) {
    const a = await JobApplication.findByPk(id, {
      include: [
        { model: Candidate },
        { model: JobOpening, attributes: ['id', 'title', 'status', 'requisitionId'] },
        { model: ApplicationEvent },
        {
          model: Interview,
          include: [{ model: InterviewPanelist, include: [{ model: Employee, attributes: ['id', 'firstName', 'lastName'], include: [{ model: Designation, attributes: ['id', 'name'] }] }] }],
        },
        { model: Offer },
      ],
    });
    if (!a) throw AppError.notFound('Application');
    const userIds = [...new Set((a.events ?? []).map((e) => e.createdById).filter((x): x is string => !!x))];
    const users = new Map((userIds.length ? await User.findAll({ where: { id: userIds }, attributes: ['id', 'firstName', 'lastName'] }) : []).map((u) => [u.id, fullName(u)]));
    const canSeeOffer = auth.permissions.has('recruitment.offer.manage');
    const offer = [...(a.offers ?? [])].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0];
    return {
      id: a.id,
      stage: a.stage,
      stageChangedAt: a.stageChangedAt,
      source: a.source,
      rejectionReason: a.rejectionReason,
      hiredEmployeeId: a.hiredEmployeeId,
      createdAt: a.createdAt,
      job: { id: a.job!.id, title: a.job!.title, status: a.job!.status },
      candidate: presentCandidate(a.candidate!),
      events: [...(a.events ?? [])]
        .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())
        .map((e) => ({ id: e.id, fromStage: e.fromStage, toStage: e.toStage, note: e.note, createdAt: e.createdAt, createdBy: e.createdById ? (users.get(e.createdById) ?? null) : null })),
      interviews: [...(a.interviews ?? [])].sort((x, y) => x.scheduledAt.getTime() - y.scheduledAt.getTime()).map((i) => this.presentInterview(i, true)),
      offer: offer
        ? {
            id: offer.id,
            status: offer.status,
            joiningDate: offer.joiningDate,
            expiresOn: offer.expiresOn,
            releasedAt: offer.releasedAt,
            respondedAt: offer.respondedAt,
            declineReason: offer.declineReason,
            ...(canSeeOffer ? { annualCtc: Number(offer.annualCtc), designationId: offer.designationId, departmentId: offer.departmentId, locationId: offer.locationId, notes: offer.notes } : {}),
          }
        : null,
    };
  }

  async move(auth: AuthContext, id: string, dto: MoveStageDto) {
    const a = await JobApplication.findByPk(id, {
      include: [
        { model: Candidate, attributes: ['id', 'firstName', 'lastName'] },
        { model: Offer, attributes: ['id', 'status'] },
      ],
    });
    if (!a) throw AppError.notFound('Application');
    if (dto.stage === a.stage) throw AppError.validation([{ field: 'stage', message: 'The application is already at this stage' }]);
    if (dto.stage === 'HIRED') throw AppError.validation([{ field: 'stage', message: 'Candidates are hired by converting an accepted offer' }]);
    if (a.stage === 'HIRED') throw AppError.conflict('This candidate has been hired');
    if (dto.stage === 'REJECTED' && !dto.note) throw AppError.validation([{ field: 'note', message: 'Record why the candidate is rejected' }]);
    const openOffer = (a.offers ?? []).find((o) => o.status === 'RELEASED' || o.status === 'ACCEPTED');
    if (openOffer && dto.stage !== 'OFFER') throw AppError.conflict('Withdraw the offer before moving this candidate');
    const from = a.stage;
    await this.db.transaction(async (transaction) => {
      await a.update({ stage: dto.stage, stageChangedAt: new Date(), rejectionReason: dto.stage === 'REJECTED' ? dto.note! : isActive(dto.stage) ? null : a.rejectionReason }, { transaction });
      await ApplicationEvent.create(
        { organizationId: auth.organizationId!, applicationId: id, fromStage: from, toStage: dto.stage, note: dto.note ?? null, createdById: auth.userId },
        { transaction },
      );
      await this.audit.record(
        { action: 'application.stage_changed', entityType: 'JobApplication', entityId: id, summary: `${fullName(a.candidate!)} moved to ${dto.stage.toLowerCase()}` },
        transaction,
      );
    });
    return this.get(auth, id);
  }

  // ---- Interviews ------------------------------------------------------------------------------

  async schedule(auth: AuthContext, applicationId: string, dto: InterviewDto) {
    const a = await JobApplication.findByPk(applicationId, {
      include: [
        { model: Candidate, attributes: ['id', 'firstName', 'lastName'] },
        { model: JobOpening, attributes: ['id', 'title'] },
      ],
    });
    if (!a) throw AppError.notFound('Application');
    if (!isActive(a.stage)) throw AppError.conflict(`The application is ${a.stage.toLowerCase()}`);
    const panel = await this.panel(dto.panelistIds);
    const from = a.stage;
    await this.db.transaction(async (transaction) => {
      const created = await Interview.create(
        {
          organizationId: auth.organizationId!,
          applicationId,
          roundName: dto.roundName,
          scheduledAt: new Date(dto.scheduledAt),
          durationMinutes: dto.durationMinutes ?? 60,
          mode: dto.mode ?? 'VIDEO',
          location: dto.location ?? null,
          createdById: auth.userId,
        },
        { transaction },
      );
      await InterviewPanelist.bulkCreate(
        panel.map((p) => ({ organizationId: auth.organizationId!, interviewId: created.id, employeeId: p.id })),
        { transaction },
      );
      if (a.stage === 'APPLIED' || a.stage === 'SCREENING') {
        await a.update({ stage: 'INTERVIEW', stageChangedAt: new Date() }, { transaction });
        await ApplicationEvent.create(
          { organizationId: auth.organizationId!, applicationId, fromStage: from, toStage: 'INTERVIEW', note: `${dto.roundName} scheduled`, createdById: auth.userId },
          { transaction },
        );
      }
      await this.audit.record(
        { action: 'interview.scheduled', entityType: 'JobApplication', entityId: applicationId, summary: `${dto.roundName} scheduled for ${fullName(a.candidate!)}` },
        transaction,
      );
    });
    await this.notifyPanel(
      auth,
      panel.map((p) => p.membershipId),
      `Interview: ${fullName(a.candidate!)} for ${a.job!.title}`,
      `${dto.roundName} on ${new Date(dto.scheduledAt).toUTCString()}`,
    );
    return this.get(auth, applicationId);
  }

  async updateInterview(auth: AuthContext, id: string, dto: UpdateInterviewDto) {
    const i = await Interview.findByPk(id, { include: [{ model: InterviewPanelist }] });
    if (!i) throw AppError.notFound('Interview');
    if (i.status !== 'SCHEDULED') throw AppError.conflict(`This interview is ${i.status.toLowerCase()}`);
    const panel = dto.panelistIds ? await this.panel(dto.panelistIds) : null;
    await this.db.transaction(async (transaction) => {
      const { panelistIds: _p, scheduledAt, ...rest } = dto;
      await i.update({ ...rest, ...(scheduledAt ? { scheduledAt: new Date(scheduledAt) } : {}) }, { transaction });
      if (panel) {
        const keep = new Set(panel.map((p) => p.id));
        const existing = new Set((i.panelists ?? []).map((p) => p.employeeId));
        const removed = (i.panelists ?? []).filter((p) => !keep.has(p.employeeId));
        if (removed.some((p) => p.submittedAt)) throw AppError.conflict('Panelists who already gave feedback cannot be removed');
        if (removed.length) await InterviewPanelist.destroy({ where: { id: removed.map((p) => p.id) }, transaction });
        const added = panel.filter((p) => !existing.has(p.id));
        if (added.length)
          await InterviewPanelist.bulkCreate(
            added.map((p) => ({ organizationId: auth.organizationId!, interviewId: id, employeeId: p.id })),
            { transaction },
          );
      }
      await this.audit.record({ action: 'interview.updated', entityType: 'JobApplication', entityId: i.applicationId, summary: `${i.roundName} updated` }, transaction);
    });
    return this.get(auth, i.applicationId);
  }

  async setInterviewStatus(auth: AuthContext, id: string, status: 'COMPLETED' | 'CANCELLED') {
    const i = await Interview.findByPk(id);
    if (!i) throw AppError.notFound('Interview');
    if (i.status !== 'SCHEDULED') throw AppError.conflict(`This interview is already ${i.status.toLowerCase()}`);
    await this.db.transaction(async (transaction) => {
      await i.update({ status }, { transaction });
      await this.audit.record({ action: `interview.${status.toLowerCase()}`, entityType: 'JobApplication', entityId: i.applicationId, summary: `${i.roundName} ${status.toLowerCase()}` }, transaction);
    });
    return this.get(auth, i.applicationId);
  }

  /** Interviews where the caller is on the panel (upcoming first, then ones waiting for feedback). */
  async mine(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return [];
    const rows = await Interview.findAll({
      where: { status: { [Op.ne]: 'CANCELLED' } },
      include: [
        { model: InterviewPanelist, where: { employeeId: self.id }, required: true },
        {
          model: JobApplication,
          attributes: ['id', 'stage'],
          include: [
            { model: Candidate, attributes: ['id', 'firstName', 'lastName', 'currentTitle', 'currentCompany', 'experienceYears', 'resumeKey'] },
            { model: JobOpening, attributes: ['id', 'title'] },
          ],
        },
      ],
      order: [['scheduledAt', 'DESC']],
      limit: 200,
    });
    return rows.map((i) => {
      const mine = i.panelists![0]!;
      return {
        id: i.id,
        roundName: i.roundName,
        scheduledAt: i.scheduledAt,
        durationMinutes: i.durationMinutes,
        mode: i.mode,
        location: i.location,
        status: i.status,
        candidate: {
          name: fullName(i.application!.candidate!),
          currentTitle: i.application!.candidate!.currentTitle,
          currentCompany: i.application!.candidate!.currentCompany,
          experienceYears: i.application!.candidate!.experienceYears === null ? null : Number(i.application!.candidate!.experienceYears),
          hasResume: !!i.application!.candidate!.resumeKey,
        },
        job: { id: i.application!.job!.id, title: i.application!.job!.title },
        myFeedback: mine.submittedAt ? { rating: mine.rating, recommendation: mine.recommendation, feedback: mine.feedback, submittedAt: mine.submittedAt } : null,
      };
    });
  }

  async submitFeedback(auth: AuthContext, interviewId: string, dto: FeedbackDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only interview panelists can give feedback');
    const i = await Interview.findByPk(interviewId);
    if (!i) throw AppError.notFound('Interview');
    const mine = await InterviewPanelist.findOne({ where: { interviewId, employeeId: self.id } });
    if (!mine) throw AppError.notFound('Interview');
    if (i.status === 'CANCELLED') throw AppError.conflict('This interview was cancelled');
    if (i.scheduledAt > new Date()) throw AppError.conflict('Feedback can be given once the interview has started');
    if (mine.submittedAt) throw AppError.conflict('You already gave feedback for this interview');
    await this.db.transaction(async (transaction) => {
      await mine.update({ rating: dto.rating, recommendation: dto.recommendation, feedback: dto.feedback, submittedAt: new Date() }, { transaction });
      const open = await InterviewPanelist.count({ where: { interviewId, submittedAt: null }, transaction });
      if (!open && i.status === 'SCHEDULED') await i.update({ status: 'COMPLETED' }, { transaction });
      await this.audit.record({ action: 'interview.feedback_submitted', entityType: 'JobApplication', entityId: i.applicationId, summary: `Feedback submitted for ${i.roundName}` }, transaction);
    });
    if (i.createdById && i.createdById !== auth.userId) {
      await this.notifications.notify(i.createdById, {
        organizationId: auth.organizationId,
        type: 'recruitment.interview',
        title: `Interview feedback received (${i.roundName})`,
        link: `/hr/recruitment/applications/${i.applicationId}`,
      });
    }
    return (await this.mine(auth)).find((x) => x.id === interviewId)!;
  }

  /** Resume for an interview panelist (or anyone with recruitment.view). */
  async interviewResume(auth: AuthContext, interviewId: string) {
    const i = await Interview.findByPk(interviewId, { include: [{ model: JobApplication, attributes: ['candidateId'] }] });
    if (!i) throw AppError.notFound('Interview');
    if (!auth.permissions.has('recruitment.view')) {
      const self = await this.scope.self(auth);
      if (!self || !(await InterviewPanelist.count({ where: { interviewId, employeeId: self.id } }))) throw AppError.notFound('Interview');
    }
    return this.candidates.resume(i.application!.candidateId);
  }

  // ---------------------------------------------------------------------------------------------

  private async panel(ids: string[]) {
    const rows = await Employee.findAll({ where: { id: ids, status: ['ACTIVE', 'ON_NOTICE'] }, attributes: ['id', 'membershipId'] });
    if (rows.length !== ids.length) throw AppError.validation([{ field: 'panelistIds', message: 'Every interviewer must be an active employee' }]);
    return rows;
  }

  private async notifyPanel(auth: AuthContext, membershipIds: (string | null)[], title: string, body: string) {
    const ids = membershipIds.filter((x): x is string => !!x);
    if (!ids.length) return;
    const members = await OrganizationMembership.findAll({ where: { id: ids, status: 'ACTIVE' }, attributes: ['userId'] });
    for (const m of members)
      if (m.userId !== auth.userId) await this.notifications.notify(m.userId, { organizationId: auth.organizationId, type: 'recruitment.interview', title, body, link: '/me/interviews' });
  }

  private summary(a: JobApplication) {
    const feedback = (a.interviews ?? []).flatMap((i) => i.panelists ?? []).filter((p) => p.submittedAt);
    const next = (a.interviews ?? []).filter((i) => i.status === 'SCHEDULED').sort((x, y) => x.scheduledAt.getTime() - y.scheduledAt.getTime())[0];
    return {
      id: a.id,
      stage: a.stage,
      stageChangedAt: a.stageChangedAt,
      source: a.source,
      job: { id: a.job!.id, title: a.job!.title },
      candidate: {
        id: a.candidate!.id,
        name: fullName(a.candidate!),
        email: a.candidate!.email,
        phone: a.candidate!.phone,
        currentTitle: a.candidate!.currentTitle,
        currentCompany: a.candidate!.currentCompany,
        experienceYears: a.candidate!.experienceYears === null ? null : Number(a.candidate!.experienceYears),
        hasResume: !!a.candidate!.resumeKey,
      },
      interviews: (a.interviews ?? []).length,
      nextInterviewAt: next?.scheduledAt ?? null,
      averageRating: feedback.length ? Math.round((feedback.reduce((n, p) => n + (p.rating ?? 0), 0) / feedback.length) * 10) / 10 : null,
      feedbackCount: feedback.length,
    };
  }

  private presentInterview(i: Interview, includeFeedback: boolean) {
    return {
      id: i.id,
      roundName: i.roundName,
      scheduledAt: i.scheduledAt,
      durationMinutes: i.durationMinutes,
      mode: i.mode,
      location: i.location,
      status: i.status,
      panel: (i.panelists ?? []).map((p) => ({
        employee: p.employee ? { id: p.employee.id, name: fullName(p.employee), designation: p.employee.designation?.name ?? null } : null,
        submittedAt: p.submittedAt,
        ...(includeFeedback && p.submittedAt ? { rating: p.rating, recommendation: p.recommendation, feedback: p.feedback } : {}),
      })),
    };
  }
}
