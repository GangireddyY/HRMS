import { Injectable } from '@nestjs/common';
import { UniqueConstraintError, type Transaction, type WhereOptions } from 'sequelize';
import { ANONYMITY_THRESHOLD } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { DatabaseService } from '../../database/database.service';
import { Employee, Survey, SurveyParticipant, SurveyQuestionRecord, SurveyResponse } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { organizationToday, userIdsOf } from '../employees/employee-people';
import { NotificationsService } from '../notifications/notifications.service';
import { audienceEmployees } from './announcements.service';
import type { SurveyAnswersDto, SurveyDto, SurveyQueryDto, SurveyQuestionDto, UpdateSurveyDto } from './dto/engagement.dto';
import { inAudience, surveyResults, validateAnswers, type SurveyQuestion } from './engagement-rules';

const toQuestion = (q: SurveyQuestionRecord): SurveyQuestion => ({ id: q.id, type: q.type, prompt: q.prompt, options: q.options, required: q.required });

/**
 * Surveys (`engagement.survey.manage` builds, opens and analyses; `engagement.survey.respond` answers once).
 * For anonymous surveys the answers carry no employee and only a day, and results need at least ANONYMITY_THRESHOLD responses.
 */
@Injectable()
export class SurveysService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(auth: AuthContext, query: SurveyQueryDto) {
    const manage = !!query.manage && auth.permissions.has('engagement.survey.manage');
    const self = await this.scope.self(auth);
    const where: WhereOptions = manage ? (query.status ? { status: query.status } : {}) : { status: 'OPEN' };
    let rows: Survey[];
    let total: number;
    if (manage) {
      const r = await Survey.findAndCountAll({ where, order: [['createdAt', 'DESC']], ...paginationArgs(query) });
      rows = r.rows;
      total = r.count;
    } else {
      const visible = (await Survey.findAll({ where, order: [['openedAt', 'DESC']], limit: 200 })).filter((s) => this.isOpen(s) && this.canTake(s, self));
      total = visible.length;
      rows = visible.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    }
    const ids = rows.map((r) => r.id);
    const [responded, counts, questionCounts] = await Promise.all([
      self && ids.length ? SurveyParticipant.findAll({ where: { surveyId: ids, employeeId: self.id }, attributes: ['surveyId'] }) : Promise.resolve([] as SurveyParticipant[]),
      manage && ids.length ? SurveyParticipant.findAll({ where: { surveyId: ids }, attributes: ['surveyId'] }) : Promise.resolve([] as SurveyParticipant[]),
      ids.length ? SurveyQuestionRecord.findAll({ where: { surveyId: ids }, attributes: ['surveyId'] }) : Promise.resolve([] as SurveyQuestionRecord[]),
    ]);
    return new PaginatedResult(
      rows.map((s) => ({
        ...this.summary(s),
        questions: questionCounts.filter((q) => q.surveyId === s.id).length,
        responded: responded.some((r) => r.surveyId === s.id),
        ...(manage ? { responses: counts.filter((c) => c.surveyId === s.id).length } : {}),
      })),
      paginationMeta(query, total),
    );
  }

  async get(auth: AuthContext, id: string) {
    const s = await this.find(id);
    const manage = auth.permissions.has('engagement.survey.manage');
    const self = await this.scope.self(auth);
    if (!manage && !(s.status !== 'DRAFT' && this.canTake(s, self))) throw AppError.notFound('Survey');
    const responded = self ? (await SurveyParticipant.count({ where: { surveyId: id, employeeId: self.id } })) > 0 : false;
    return {
      ...this.summary(s),
      questions: (s.questions ?? []).sort((a, b) => a.sortOrder - b.sortOrder).map((q) => ({ id: q.id, type: q.type, prompt: q.prompt, options: q.options, required: q.required })),
      responded,
      permissions: { respond: auth.permissions.has('engagement.survey.respond') && !!self && this.isOpen(s) && this.canTake(s, self) && !responded, manage },
    };
  }

  async create(auth: AuthContext, dto: SurveyDto) {
    this.validateQuestions(dto.questions);
    const s = await this.db.transaction(async (transaction) => {
      const created = await Survey.create(
        { organizationId: auth.organizationId!, title: dto.title, description: dto.description ?? null, anonymous: dto.anonymous ?? true, departmentIds: dto.departmentIds?.length ? dto.departmentIds : null, closesAt: dto.closesAt ? new Date(dto.closesAt) : null, createdById: auth.userId },
        { transaction },
      );
      await this.writeQuestions(auth, created.id, dto.questions, transaction);
      await this.audit.record({ action: 'engagement.survey_created', entityType: 'Survey', entityId: created.id, summary: `Survey "${created.title}" drafted` }, transaction);
      return created;
    });
    return this.get(auth, s.id);
  }

  /** Drafts can change completely; once open only the title, description and closing time can. */
  async update(auth: AuthContext, id: string, dto: UpdateSurveyDto) {
    const s = await this.find(id);
    if (s.status === 'CLOSED') throw AppError.conflict('A closed survey can no longer be changed');
    if (s.status === 'OPEN' && (dto.questions || dto.anonymous !== undefined || dto.departmentIds !== undefined)) {
      throw AppError.conflict('Questions, anonymity and audience are fixed once the survey is open');
    }
    if (dto.questions) this.validateQuestions(dto.questions);
    await this.db.transaction(async (transaction) => {
      await s.update(
        {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.anonymous !== undefined ? { anonymous: dto.anonymous } : {}),
          ...(dto.departmentIds !== undefined ? { departmentIds: dto.departmentIds?.length ? dto.departmentIds : null } : {}),
          ...(dto.closesAt !== undefined ? { closesAt: dto.closesAt ? new Date(dto.closesAt) : null } : {}),
        },
        { transaction },
      );
      if (dto.questions) {
        await SurveyQuestionRecord.destroy({ where: { surveyId: id }, transaction });
        await this.writeQuestions(auth, id, dto.questions, transaction);
      }
      await this.audit.record({ action: 'engagement.survey_updated', entityType: 'Survey', entityId: id, summary: `Survey "${s.title}" updated` }, transaction);
    });
    return this.get(auth, id);
  }

  async remove(auth: AuthContext, id: string) {
    const s = await this.find(id);
    if (s.status !== 'DRAFT') throw AppError.conflict('Only a draft survey can be deleted');
    await this.db.transaction(async (transaction) => {
      await s.destroy({ transaction });
      await this.audit.record({ action: 'engagement.survey_deleted', entityType: 'Survey', entityId: id, summary: `Draft survey "${s.title}" deleted` }, transaction);
    });
  }

  async open(auth: AuthContext, id: string) {
    const s = await this.find(id);
    if (s.status !== 'DRAFT') throw AppError.conflict('Only a draft survey can be opened');
    if (s.closesAt && s.closesAt <= new Date()) throw AppError.validation([{ field: 'closesAt', message: 'The closing time has already passed' }]);
    await this.db.transaction(async (transaction) => {
      await s.update({ status: 'OPEN', openedAt: new Date() }, { transaction });
      const people = await audienceEmployees({ departmentIds: s.departmentIds, locationIds: null }, transaction);
      const users = await userIdsOf(people.map((p) => p.id), transaction);
      for (const userId of users.values()) {
        if (userId !== auth.userId) await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'engagement.survey', title: `Have your say: ${s.title}`, body: s.anonymous ? 'Your answers are anonymous.' : undefined, link: `/me/engagement/surveys/${s.id}` }, transaction);
      }
      await this.audit.record({ action: 'engagement.survey_opened', entityType: 'Survey', entityId: id, summary: `Survey "${s.title}" opened for ${people.length} employees` }, transaction);
    });
    return this.get(auth, id);
  }

  async close(auth: AuthContext, id: string) {
    const s = await this.find(id);
    if (s.status !== 'OPEN') throw AppError.conflict('Only an open survey can be closed');
    await this.db.transaction(async (transaction) => {
      await s.update({ status: 'CLOSED', closedAt: new Date() }, { transaction });
      await this.audit.record({ action: 'engagement.survey_closed', entityType: 'Survey', entityId: id, summary: `Survey "${s.title}" closed` }, transaction);
    });
    return this.get(auth, id);
  }

  async respond(auth: AuthContext, id: string, dto: SurveyAnswersDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees can answer surveys');
    const s = await this.find(id);
    if (!this.canTake(s, self) || s.status === 'DRAFT') throw AppError.notFound('Survey');
    if (!this.isOpen(s)) throw AppError.conflict('This survey is closed');
    const { answers, problems } = validateAnswers((s.questions ?? []).map(toQuestion), dto.answers ?? {});
    if (problems.length) throw AppError.validation(problems.map((message) => ({ field: 'answers', message })));
    const today = await organizationToday(auth.organizationId!);
    try {
      await this.db.transaction(async (transaction) => {
        await SurveyParticipant.create({ organizationId: auth.organizationId!, surveyId: id, employeeId: self.id, respondedOn: today }, { transaction });
        await SurveyResponse.create({ organizationId: auth.organizationId!, surveyId: id, employeeId: s.anonymous ? null : self.id, answers, submittedOn: today }, { transaction });
      });
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict('You have already answered this survey');
      throw e;
    }
    return this.get(auth, id);
  }

  async results(id: string) {
    const s = await this.find(id);
    const questions = (s.questions ?? []).sort((a, b) => a.sortOrder - b.sortOrder).map(toQuestion);
    const [responses, audience] = await Promise.all([SurveyResponse.findAll({ where: { surveyId: id }, attributes: ['answers', 'employeeId'] }), audienceEmployees({ departmentIds: s.departmentIds, locationIds: null })]);
    const count = responses.length;
    const hidden = s.anonymous && count < ANONYMITY_THRESHOLD;
    const names = !s.anonymous && count ? new Map((await Employee.findAll({ where: { id: responses.map((r) => r.employeeId).filter((x): x is string => !!x) }, attributes: ['id', 'firstName', 'lastName'] })).map((e) => [e.id, `${e.firstName} ${e.lastName}`])) : null;
    return {
      survey: this.summary(s),
      responses: count,
      audience: audience.length,
      responseRate: audience.length ? Math.round((count / audience.length) * 100) : null,
      hidden,
      threshold: ANONYMITY_THRESHOLD,
      questions: hidden ? [] : surveyResults(questions, responses.map((r) => r.answers)),
      respondents: names ? [...new Set(responses.map((r) => (r.employeeId ? names.get(r.employeeId) : null)).filter((x): x is string => !!x))].sort() : null,
    };
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  private async find(id: string): Promise<Survey> {
    const s = await Survey.findByPk(id, { include: [{ model: SurveyQuestionRecord }] });
    if (!s) throw AppError.notFound('Survey');
    return s;
  }

  private isOpen(s: Survey) {
    return s.status === 'OPEN' && (!s.closesAt || s.closesAt > new Date());
  }

  private canTake(s: Survey, self: Employee | null) {
    return !!self && inAudience({ departmentIds: s.departmentIds, locationIds: null }, self);
  }

  private summary(s: Survey) {
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      anonymous: s.anonymous,
      departmentIds: s.departmentIds,
      status: s.status,
      open: this.isOpen(s),
      openedAt: s.openedAt,
      closesAt: s.closesAt,
      closedAt: s.closedAt,
      createdAt: s.createdAt,
    };
  }

  private validateQuestions(questions: SurveyQuestionDto[]) {
    const issues = questions.flatMap((q, i) => {
      const opts = (q.options ?? []).map((o) => o.trim()).filter(Boolean);
      if (q.type === 'CHOICE' && opts.length < 2) return [{ field: `questions.${i}.options`, message: `Question ${i + 1}: give at least two options` }];
      return [];
    });
    if (issues.length) throw AppError.validation(issues);
  }

  private async writeQuestions(auth: AuthContext, surveyId: string, questions: SurveyQuestionDto[], transaction: Transaction) {
    await SurveyQuestionRecord.bulkCreate(
      questions.map((q, i) => ({
        organizationId: auth.organizationId!,
        surveyId,
        type: q.type,
        prompt: q.prompt,
        options: q.type === 'CHOICE' ? (q.options ?? []).map((o) => o.trim()).filter(Boolean) : [],
        required: q.required ?? true,
        sortOrder: i,
      })),
      { transaction },
    );
  }
}

