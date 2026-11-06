import { Injectable } from '@nestjs/common';
import { col, fn, Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import { OPEN_ENROLLMENT_STATUSES } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { DatabaseService } from '../../database/database.service';
import { Department, Employee, TrainingCourse, TrainingEnrollment, TrainingQuestion, TrainingSession } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { organizationToday, personRef, userIdsOf } from '../employees/employee-people';
import { NotificationsService } from '../notifications/notifications.service';
import type { AttendanceDto, CourseDto, CourseQueryDto, QuestionsDto, SessionDto, UpdateCourseDto, UpdateSessionDto } from './dto/training.dto';
import { completeIfDone, isSessionBased } from './training-completion';

/** Fields that can't change once a course is published (they decide how enrolments complete). */
const LOCKED_WHEN_PUBLISHED = ['delivery', 'hasAssessment'] as const;

export function presentCourse(c: TrainingCourse, questionCount?: number) {
  return {
    id: c.id,
    code: c.code,
    title: c.title,
    description: c.description,
    category: c.category,
    delivery: c.delivery,
    durationHours: c.durationHours === null ? null : Number(c.durationHours),
    provider: c.provider,
    contentUrl: c.contentUrl,
    status: c.status,
    selfEnrollment: c.selfEnrollment,
    mandatory: c.mandatory,
    hasAssessment: c.hasAssessment,
    passMark: c.passMark,
    maxAttempts: c.maxAttempts,
    validityMonths: c.validityMonths,
    ...(questionCount !== undefined ? { questionCount } : {}),
  };
}

export function presentSession(s: TrainingSession, enrolled?: number) {
  return {
    id: s.id,
    courseId: s.courseId,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    location: s.location,
    trainer: s.trainer,
    capacity: s.capacity,
    status: s.status,
    ...(enrolled !== undefined ? { enrolled, seatsLeft: s.capacity === null ? null : Math.max(0, s.capacity - enrolled) } : {}),
  };
}

/** Course catalog and administration (`training.manage`): courses, assessment questions, sessions, rosters and attendance. */
@Injectable()
export class TrainingCoursesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Catalog ---------------------------------------------------------------------------------

  async list(auth: AuthContext, query: CourseQueryDto) {
    const manage = !!query.manage && auth.permissions.has('training.manage');
    const conditions: WhereOptions[] = [manage ? (query.status ? { status: query.status } : {}) : { status: 'PUBLISHED' }];
    if (query.category) conditions.push({ category: query.category });
    if (query.delivery) conditions.push({ delivery: query.delivery });
    if (query.search) {
      const like = containsPattern(query.search);
      conditions.push({ [Op.or]: [{ title: { [Op.iLike]: like } }, { code: { [Op.iLike]: like } }, { provider: { [Op.iLike]: like } }] });
    }
    const { rows, count } = await TrainingCourse.findAndCountAll({ where: { [Op.and]: conditions }, order: [['mandatory', 'DESC'], ['title', 'ASC']], ...paginationArgs(query) });
    const ids = rows.map((r) => r.id);
    const self = await this.scope.self(auth);
    const [mine, upcoming, stats] = await Promise.all([
      self && ids.length ? TrainingEnrollment.findAll({ where: { employeeId: self.id, courseId: ids }, order: [['createdAt', 'DESC']] }) : Promise.resolve([] as TrainingEnrollment[]),
      ids.length
        ? (TrainingSession.findAll({ where: { courseId: ids, status: 'SCHEDULED', startsAt: { [Op.gt]: new Date() } }, attributes: ['courseId', [fn('COUNT', col('id')), 'count']], group: ['courseId'], raw: true }) as unknown as Promise<{ courseId: string; count: string }[]>)
        : Promise.resolve([]),
      manage && ids.length
        ? (TrainingEnrollment.findAll({ where: { courseId: ids }, attributes: ['courseId', 'status', [fn('COUNT', col('id')), 'count']], group: ['courseId', 'status'], raw: true }) as unknown as Promise<{ courseId: string; status: string; count: string }[]>)
        : Promise.resolve([]),
    ]);
    const upcomingBy = new Map(upcoming.map((u) => [u.courseId, Number(u.count)]));
    return new PaginatedResult(
      rows.map((c) => {
        const my = mine.find((e) => e.courseId === c.id);
        const s = stats.filter((x) => x.courseId === c.id);
        return {
          ...presentCourse(c),
          upcomingSessions: upcomingBy.get(c.id) ?? 0,
          myEnrollment: my ? { id: my.id, status: my.status, expiresOn: my.expiresOn, dueDate: my.dueDate } : null,
          ...(manage
            ? { enrolled: s.filter((x) => (OPEN_ENROLLMENT_STATUSES as readonly string[]).includes(x.status)).reduce((n, x) => n + Number(x.count), 0), completed: Number(s.find((x) => x.status === 'COMPLETED')?.count ?? 0) }
            : {}),
        };
      }),
      paginationMeta(query, count),
    );
  }

  async get(auth: AuthContext, id: string) {
    const manage = auth.permissions.has('training.manage');
    const c = await TrainingCourse.findByPk(id);
    if (!c || (!manage && c.status !== 'PUBLISHED')) throw AppError.notFound('Course');
    const self = await this.scope.self(auth);
    const sessions = await TrainingSession.findAll({
      where: { courseId: id, ...(manage ? {} : { status: 'SCHEDULED', startsAt: { [Op.gt]: new Date() } }) },
      order: [['startsAt', manage ? 'DESC' : 'ASC']],
    });
    const seats = await this.enrolledPerSession(sessions.map((s) => s.id));
    const [questions, myEnrollment, feedback] = await Promise.all([
      manage ? TrainingQuestion.findAll({ where: { courseId: id }, order: [['sortOrder', 'ASC']] }) : TrainingQuestion.count({ where: { courseId: id } }),
      self ? TrainingEnrollment.findOne({ where: { courseId: id, employeeId: self.id }, order: [['createdAt', 'DESC']] }) : null,
      TrainingEnrollment.findOne({ where: { courseId: id, feedbackRating: { [Op.ne]: null } }, attributes: [[fn('AVG', col('feedback_rating')), 'avg'], [fn('COUNT', col('id')), 'count']], raw: true }) as unknown as Promise<{ avg: string | null; count: string } | null>,
    ]);
    return {
      ...presentCourse(c, Array.isArray(questions) ? questions.length : questions),
      sessions: sessions.map((s) => presentSession(s, seats.get(s.id) ?? 0)),
      questions: Array.isArray(questions) ? questions.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options, correctIndex: q.correctIndex })) : undefined,
      myEnrollment: myEnrollment ? { id: myEnrollment.id, status: myEnrollment.status, expiresOn: myEnrollment.expiresOn, sessionId: myEnrollment.sessionId } : null,
      feedback: { average: feedback?.avg ? Math.round(Number(feedback.avg) * 10) / 10 : null, count: Number(feedback?.count ?? 0) },
      permissions: { manage, enroll: auth.permissions.has('training.enroll') && !!self && c.status === 'PUBLISHED' && c.selfEnrollment, assign: auth.permissions.has('training.assign') && c.status === 'PUBLISHED' },
    };
  }

  // ---- Courses ---------------------------------------------------------------------------------

  async create(auth: AuthContext, dto: CourseDto) {
    try {
      const c = await this.db.transaction(async (transaction) => {
        const created = await TrainingCourse.create(
          { organizationId: auth.organizationId!, ...dto, durationHours: dto.durationHours === undefined || dto.durationHours === null ? null : String(dto.durationHours), createdById: auth.userId, updatedById: auth.userId },
          { transaction },
        );
        await this.audit.record({ action: 'training.course_created', entityType: 'TrainingCourse', entityId: created.id, summary: `Course ${created.code} – ${created.title} created` }, transaction);
        return created;
      });
      return this.get(auth, c.id);
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict('A course with this code already exists');
      throw e;
    }
  }

  async update(auth: AuthContext, id: string, dto: UpdateCourseDto) {
    const c = await this.find(id);
    if (c.status === 'ARCHIVED') throw AppError.conflict('An archived course can no longer be changed');
    if (c.status === 'PUBLISHED') {
      const locked = LOCKED_WHEN_PUBLISHED.filter((k) => dto[k] !== undefined && dto[k] !== c[k]);
      if (locked.length) throw AppError.conflict('The delivery and the assessment setting are fixed once a course is published');
    }
    try {
      await this.db.transaction(async (transaction) => {
        const { durationHours, ...rest } = dto;
        await c.update({ ...rest, ...(durationHours !== undefined ? { durationHours: durationHours === null ? null : String(durationHours) } : {}), updatedById: auth.userId }, { transaction });
        await this.audit.record({ action: 'training.course_updated', entityType: 'TrainingCourse', entityId: id, summary: `Course ${c.code} updated` }, transaction);
      });
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict('A course with this code already exists');
      throw e;
    }
    return this.get(auth, id);
  }

  async setStatus(auth: AuthContext, id: string, status: 'PUBLISHED' | 'ARCHIVED') {
    const c = await this.find(id);
    if (status === 'PUBLISHED') {
      if (c.status !== 'DRAFT') throw AppError.conflict('Only a draft course can be published');
      if (c.hasAssessment && !(await TrainingQuestion.count({ where: { courseId: id } }))) throw AppError.conflict('Add the assessment questions before publishing');
    } else if (c.status !== 'PUBLISHED') {
      throw AppError.conflict('Only a published course can be archived');
    }
    await this.db.transaction(async (transaction) => {
      await c.update({ status, updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: status === 'PUBLISHED' ? 'training.course_published' : 'training.course_archived', entityType: 'TrainingCourse', entityId: id, summary: `Course ${c.code} ${status.toLowerCase()}` }, transaction);
    });
    return this.get(auth, id);
  }

  async remove(auth: AuthContext, id: string) {
    const c = await this.find(id);
    if (c.status !== 'DRAFT') throw AppError.conflict('Only a draft course can be deleted; archive it instead');
    if (await TrainingEnrollment.count({ where: { courseId: id } })) throw AppError.conflict('This course has enrolments; archive it instead');
    await this.db.transaction(async (transaction) => {
      await c.destroy({ transaction });
      await this.audit.record({ action: 'training.course_deleted', entityType: 'TrainingCourse', entityId: id, summary: `Course ${c.code} deleted` }, transaction);
    });
  }

  /** Replaces the assessment questions (earlier attempts keep their scores). */
  async setQuestions(auth: AuthContext, id: string, dto: QuestionsDto) {
    const c = await this.find(id);
    if (!c.hasAssessment) throw AppError.conflict('Turn on the assessment for this course first');
    if (c.status === 'ARCHIVED') throw AppError.conflict('An archived course can no longer be changed');
    const issues = dto.questions.flatMap((q, i) => (q.correctIndex >= q.options.length ? [{ field: `questions.${i}.correctIndex`, message: `Question ${i + 1}: choose one of its options as the answer` }] : []));
    if (issues.length) throw AppError.validation(issues);
    if (c.status === 'PUBLISHED' && !dto.questions.length) throw AppError.validation([{ field: 'questions', message: 'A published assessment needs at least one question' }]);
    await this.db.transaction(async (transaction) => {
      await TrainingQuestion.destroy({ where: { courseId: id }, transaction });
      await TrainingQuestion.bulkCreate(dto.questions.map((q, i) => ({ organizationId: auth.organizationId!, courseId: id, prompt: q.prompt, options: q.options.map((o) => o.trim()), correctIndex: q.correctIndex, sortOrder: i })), { transaction });
      await this.audit.record({ action: 'training.questions_updated', entityType: 'TrainingCourse', entityId: id, summary: `Assessment of ${c.code} updated (${dto.questions.length} questions)` }, transaction);
    });
    return this.get(auth, id);
  }

  // ---- Sessions --------------------------------------------------------------------------------

  async createSession(auth: AuthContext, courseId: string, dto: SessionDto) {
    const c = await this.find(courseId);
    if (!isSessionBased(c)) throw AppError.conflict('Self-paced courses have no sessions');
    if (c.status === 'ARCHIVED') throw AppError.conflict('This course is archived');
    this.assertTimes(dto.startsAt, dto.endsAt);
    await this.db.transaction(async (transaction) => {
      const s = await TrainingSession.create({ organizationId: auth.organizationId!, courseId, startsAt: new Date(dto.startsAt), endsAt: new Date(dto.endsAt), location: dto.location ?? null, trainer: dto.trainer ?? null, capacity: dto.capacity ?? null, createdById: auth.userId }, { transaction });
      await this.audit.record({ action: 'training.session_created', entityType: 'TrainingSession', entityId: s.id, summary: `Session of ${c.code} scheduled for ${dto.startsAt}` }, transaction);
    });
    return this.get(auth, courseId);
  }

  async updateSession(auth: AuthContext, sessionId: string, dto: UpdateSessionDto) {
    const s = await this.session(sessionId);
    if (s.status !== 'SCHEDULED') throw AppError.conflict('Only a scheduled session can be changed');
    const startsAt = dto.startsAt ?? s.startsAt.toISOString();
    const endsAt = dto.endsAt ?? s.endsAt.toISOString();
    this.assertTimes(startsAt, endsAt);
    if (dto.capacity) {
      const enrolled = (await this.enrolledPerSession([s.id])).get(s.id) ?? 0;
      if (dto.capacity < enrolled) throw AppError.validation([{ field: 'capacity', message: `${enrolled} people are already enrolled` }]);
    }
    await this.db.transaction(async (transaction) => {
      await s.update({ ...dto, startsAt: new Date(startsAt), endsAt: new Date(endsAt) }, { transaction });
      await this.audit.record({ action: 'training.session_updated', entityType: 'TrainingSession', entityId: s.id, summary: 'Training session updated' }, transaction);
    });
    return this.get(auth, s.courseId);
  }

  /** Cancels a session; enrolled people keep their enrolment and are asked to pick another session. */
  async cancelSession(auth: AuthContext, sessionId: string) {
    const s = await this.session(sessionId);
    if (s.status !== 'SCHEDULED') throw AppError.conflict('Only a scheduled session can be cancelled');
    await this.db.transaction(async (transaction) => {
      await s.update({ status: 'CANCELLED' }, { transaction });
      const affected = await TrainingEnrollment.findAll({ where: { sessionId: s.id, status: OPEN_ENROLLMENT_STATUSES as string[] }, transaction });
      await TrainingEnrollment.update({ sessionId: null }, { where: { id: affected.map((e) => e.id) }, transaction });
      const users = await userIdsOf(affected.map((e) => e.employeeId), transaction);
      for (const e of affected) {
        const userId = users.get(e.employeeId);
        if (userId) await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'training.session', title: `A ${s.course!.title} session was cancelled`, body: 'Choose another session.', link: `/me/training/enrollments/${e.id}` }, transaction);
      }
      await this.audit.record({ action: 'training.session_cancelled', entityType: 'TrainingSession', entityId: s.id, summary: `Session of ${s.course!.code} cancelled (${affected.length} enrolled)` }, transaction);
    });
    return this.get(auth, s.courseId);
  }

  async roster(auth: AuthContext, courseId: string, sessionId?: string) {
    await this.find(courseId);
    const rows = await TrainingEnrollment.findAll({
      where: { courseId, ...(sessionId ? { sessionId } : {}) },
      include: [{ model: Employee, attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'departmentId'], include: [{ model: Department, attributes: ['id', 'name'] }] }, { model: TrainingSession }],
      order: [['createdAt', 'DESC']],
    });
    return rows.map((e) => ({
      id: e.id,
      employee: { ...personRef(e.employee)!, department: e.employee?.department?.name ?? null },
      session: e.session ? presentSession(e.session) : null,
      source: e.source,
      dueDate: e.dueDate,
      status: e.status,
      attended: e.attended,
      attempts: e.attempts,
      bestScore: e.bestScore,
      completedOn: e.completedOn,
      certificateNumber: e.certificateNumber,
      expiresOn: e.expiresOn,
      feedbackRating: e.feedbackRating,
    }));
  }

  /** Records attendance; attending completes the enrolment when nothing else is required, missing an ended session is a no-show. */
  async attendance(auth: AuthContext, sessionId: string, dto: AttendanceDto) {
    const s = await this.session(sessionId);
    if (s.status === 'CANCELLED') throw AppError.conflict('This session was cancelled');
    if (s.startsAt > new Date()) throw AppError.conflict("Attendance can be recorded once the session has started");
    const enrollments = await TrainingEnrollment.findAll({ where: { id: dto.entries.map((x) => x.enrollmentId), sessionId } });
    if (enrollments.length !== new Set(dto.entries.map((x) => x.enrollmentId)).size) throw AppError.validation([{ field: 'entries', message: 'Some people are not enrolled in this session' }]);
    const today = await organizationToday(auth.organizationId!);
    const ended = s.endsAt <= new Date();
    const completed: TrainingEnrollment[] = [];
    await this.db.transaction(async (transaction) => {
      for (const entry of dto.entries) {
        const e = enrollments.find((x) => x.id === entry.enrollmentId)!;
        if (e.status === 'COMPLETED' || e.status === 'CANCELLED' || e.status === 'FAILED') continue;
        if (entry.attended) {
          await e.update({ attended: true, status: e.status === 'NO_SHOW' || e.status === 'ENROLLED' ? 'IN_PROGRESS' : e.status, startedAt: e.startedAt ?? new Date() }, { transaction });
          if (await completeIfDone(e, s.course!, today, transaction)) completed.push(e);
        } else {
          await e.update({ attended: false, ...(ended ? { status: 'NO_SHOW' as const } : {}) }, { transaction });
        }
      }
      if (ended) await s.update({ status: 'COMPLETED' }, { transaction });
      const users = await userIdsOf(completed.map((e) => e.employeeId), transaction);
      for (const e of completed) {
        const userId = users.get(e.employeeId);
        if (userId) await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'training.completed', title: `You completed ${s.course!.title}`, link: `/me/training/enrollments/${e.id}` }, transaction);
      }
      await this.audit.record({ action: 'training.attendance_recorded', entityType: 'TrainingSession', entityId: s.id, summary: `Attendance recorded for ${s.course!.code} (${dto.entries.filter((x) => x.attended).length} of ${dto.entries.length} attended)` }, transaction);
    });
    return this.roster(auth, s.courseId, s.id);
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  async find(id: string): Promise<TrainingCourse> {
    const c = await TrainingCourse.findByPk(id);
    if (!c) throw AppError.notFound('Course');
    return c;
  }

  private async session(id: string): Promise<TrainingSession> {
    const s = await TrainingSession.findByPk(id, { include: [{ model: TrainingCourse }] });
    if (!s) throw AppError.notFound('Session');
    return s;
  }

  async enrolledPerSession(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = (await TrainingEnrollment.findAll({
      where: { sessionId: ids, status: { [Op.notIn]: ['CANCELLED'] } },
      attributes: ['sessionId', [fn('COUNT', col('id')), 'count']],
      group: ['sessionId'],
      raw: true,
    })) as unknown as { sessionId: string; count: string }[];
    return new Map(rows.map((r) => [r.sessionId, Number(r.count)]));
  }

  private assertTimes(startsAt: string, endsAt: string) {
    if (new Date(endsAt) <= new Date(startsAt)) throw AppError.validation([{ field: 'endsAt', message: 'The session must end after it starts' }]);
    if (new Date(endsAt).getTime() - new Date(startsAt).getTime() > 14 * 86_400_000) throw AppError.validation([{ field: 'endsAt', message: 'A session can last at most two weeks' }]);
  }
}

