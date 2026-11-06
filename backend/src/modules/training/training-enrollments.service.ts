import { Injectable } from '@nestjs/common';
import { Op, UniqueConstraintError, type Transaction, type WhereOptions } from 'sequelize';
import { CERTIFICATION_WARNING_DAYS, OPEN_ENROLLMENT_STATUSES } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { addDays } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { Department, Employee, TrainingAttempt, TrainingCourse, TrainingEnrollment, TrainingQuestion, TrainingSession } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { fullName, organizationToday, personRef, userIdsOf } from '../employees/employee-people';
import { NotificationsService } from '../notifications/notifications.service';
import type { AssignDto, AttemptDto, CancelEnrollmentDto, CertificationQueryDto, CourseFeedbackDto, EnrollDto, EnrollmentQueryDto } from './dto/training.dto';
import { completeIfDone, isSessionBased, requirementsLeft } from './training-completion';
import { presentCourse, presentSession, TrainingCoursesService } from './training-courses.service';
import { certificationState, scoreAttempt } from './training-rules';

const OPEN = OPEN_ENROLLMENT_STATUSES as string[];
const INCLUDES = [
  { model: TrainingCourse },
  { model: TrainingSession },
  { model: Employee, attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'managerId', 'departmentId', 'status'], include: [{ model: Department, attributes: ['id', 'name'] }] },
];

/**
 * Enrolments: self-enrolment from the catalog (`training.enroll`), assignment within `training.assign` scope, the
 * learner's progress (start, mark done, assessment attempts, feedback) and certificates.
 */
@Injectable()
export class TrainingEnrollmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
    private readonly courses: TrainingCoursesService,
  ) {}

  async enroll(auth: AuthContext, courseId: string, dto: EnrollDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees can enrol in training');
    if (self.status === 'EXITED') throw AppError.forbidden('You have exited the organization');
    const c = await this.courses.find(courseId);
    if (c.status !== 'PUBLISHED') throw AppError.notFound('Course');
    if (!c.selfEnrollment) throw AppError.forbidden('This course is by assignment only');
    const sessionId = await this.checkSession(c, dto.sessionId ?? null, 1);
    try {
      const e = await this.db.transaction(async (transaction) => {
        const created = await TrainingEnrollment.create({ organizationId: auth.organizationId!, courseId, employeeId: self.id, sessionId, source: 'SELF' }, { transaction });
        await this.audit.record({ action: 'training.enrolled', entityType: 'TrainingEnrollment', entityId: created.id, summary: `${self.employeeCode} enrolled in ${c.code}` }, transaction);
        return created;
      });
      return this.get(auth, e.id);
    } catch (err) {
      if (err instanceof UniqueConstraintError) throw AppError.conflict('You are already enrolled in this course');
      throw err;
    }
  }

  /** Assigns a published course to employees (and/or everyone active in departments) within the caller's scope. */
  async assign(auth: AuthContext, dto: AssignDto) {
    const c = await this.courses.find(dto.courseId);
    if (c.status !== 'PUBLISHED') throw AppError.conflict('Only published courses can be assigned');
    if (!dto.employeeIds?.length && !dto.departmentIds?.length) throw AppError.validation([{ field: 'employeeIds', message: 'Choose employees or departments' }]);
    const today = await organizationToday(auth.organizationId!);
    if (dto.dueDate && dto.dueDate < today) throw AppError.validation([{ field: 'dueDate', message: "The due date can't be in the past" }]);
    const scoped = await this.scope.where(auth, 'training.assign');
    if (!scoped) throw AppError.forbidden();
    const candidates = await Employee.findAll({
      where: { [Op.and]: [scoped, { status: ['ACTIVE', 'ON_NOTICE'] }, { [Op.or]: [...(dto.employeeIds?.length ? [{ id: dto.employeeIds }] : []), ...(dto.departmentIds?.length ? [{ departmentId: dto.departmentIds }] : [])] }] },
      attributes: ['id', 'employeeCode', 'firstName', 'lastName'],
    });
    const outOfScope = (dto.employeeIds ?? []).filter((id) => !candidates.some((e) => e.id === id));
    const existing = candidates.length ? await TrainingEnrollment.findAll({ where: { courseId: c.id, employeeId: candidates.map((e) => e.id), [Op.or]: [{ status: OPEN }, { status: 'COMPLETED' }] } }) : [];
    const skipped: { employeeId: string; name: string; reason: string }[] = outOfScope.map((id) => ({ employeeId: id, name: '', reason: 'Not an active employee in your scope' }));
    const targets = candidates.filter((e) => {
      const open = existing.find((x) => x.employeeId === e.id && OPEN.includes(x.status));
      const valid = existing.find((x) => x.employeeId === e.id && x.status === 'COMPLETED' && (!x.expiresOn || x.expiresOn >= today));
      if (open) skipped.push({ employeeId: e.id, name: fullName(e), reason: 'Already enrolled' });
      else if (valid) skipped.push({ employeeId: e.id, name: fullName(e), reason: valid.expiresOn ? `Certified until ${valid.expiresOn}` : 'Already completed' });
      return !open && !valid;
    });
    const sessionId = targets.length ? await this.checkSession(c, dto.sessionId ?? null, targets.length, true) : null;
    await this.db.transaction(async (transaction) => {
      const created = await TrainingEnrollment.bulkCreate(
        targets.map((e) => ({ organizationId: auth.organizationId!, courseId: c.id, employeeId: e.id, sessionId, source: 'ASSIGNED' as const, assignedById: auth.userId, dueDate: dto.dueDate ?? null })),
        { transaction, returning: true },
      );
      const users = await userIdsOf(targets.map((e) => e.id), transaction);
      for (const e of created) {
        const userId = users.get(e.employeeId);
        if (userId && userId !== auth.userId) {
          await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'training.assigned', title: `You have been assigned ${c.title}`, body: dto.dueDate ? `Complete it by ${dto.dueDate}.` : undefined, link: `/me/training/enrollments/${e.id}` }, transaction);
        }
      }
      if (created.length) await this.audit.record({ action: 'training.assigned', entityType: 'TrainingCourse', entityId: c.id, summary: `${c.code} assigned to ${created.length} employee(s)${dto.dueDate ? `, due ${dto.dueDate}` : ''}` }, transaction);
    });
    return { assigned: targets.length, skipped };
  }

  async cancel(auth: AuthContext, id: string, dto: CancelEnrollmentDto) {
    const { e, isLearner, canManage } = await this.access(auth, id);
    if (!OPEN.includes(e.status)) throw AppError.conflict('Only an open enrolment can be cancelled');
    if (isLearner && !canManage && e.source === 'ASSIGNED') throw AppError.forbidden('Assigned training can only be cancelled by whoever assigned it or HR');
    if (!isLearner && !canManage) throw AppError.forbidden();
    await this.db.transaction(async (transaction) => {
      await e.update({ status: 'CANCELLED', cancelledAt: new Date(), cancelReason: dto.reason ?? null }, { transaction });
      await this.audit.record({ action: 'training.enrollment_cancelled', entityType: 'TrainingEnrollment', entityId: id, summary: `Enrolment of ${e.employee!.employeeCode} in ${e.course!.code} cancelled` }, transaction);
    });
    return this.get(auth, id);
  }

  async changeSession(auth: AuthContext, id: string, sessionId: string) {
    const { e, isLearner, canManage } = await this.access(auth, id);
    if (!isLearner && !canManage) throw AppError.forbidden();
    if (!OPEN.includes(e.status) || e.attended) throw AppError.conflict('The session can be changed until attendance is recorded');
    const checked = await this.checkSession(e.course!, sessionId, 1);
    await e.update({ sessionId: checked });
    return this.get(auth, id);
  }

  async start(auth: AuthContext, id: string) {
    const { e } = await this.learner(auth, id);
    if (e.status !== 'ENROLLED') throw AppError.conflict('This course is already started or closed');
    await e.update({ status: 'IN_PROGRESS', startedAt: new Date() });
    return this.get(auth, id);
  }

  /** Self-paced courses without an assessment complete when the learner confirms they finished. */
  async markDone(auth: AuthContext, id: string) {
    const { e } = await this.learner(auth, id);
    const c = e.course!;
    if (isSessionBased(c) || c.hasAssessment) throw AppError.conflict(isSessionBased(c) ? 'This course completes when your attendance is recorded' : 'Pass the assessment to complete this course');
    if (!OPEN.includes(e.status)) throw AppError.conflict('This enrolment is closed');
    await this.finish(auth, e, async (transaction) => {
      await e.update({ markedDone: true, startedAt: e.startedAt ?? new Date() }, { transaction });
    });
    return this.get(auth, id);
  }

  /** The assessment as the learner sees it (no answers). */
  async assessment(auth: AuthContext, id: string) {
    const { e } = await this.learner(auth, id);
    this.assertCanAttempt(e);
    const questions = await TrainingQuestion.findAll({ where: { courseId: e.courseId }, order: [['sortOrder', 'ASC']] });
    return { passMark: e.course!.passMark, attemptsLeft: e.course!.maxAttempts - e.attempts, questions: questions.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options })) };
  }

  async attempt(auth: AuthContext, id: string, dto: AttemptDto) {
    const { e } = await this.learner(auth, id);
    this.assertCanAttempt(e);
    const c = e.course!;
    const questions = await TrainingQuestion.findAll({ where: { courseId: c.id } });
    const answers = Object.fromEntries(Object.entries(dto.answers ?? {}).filter(([k, v]) => questions.some((q) => q.id === k) && Number.isInteger(v)));
    const result = scoreAttempt(questions.map((q) => ({ id: q.id, correctIndex: q.correctIndex, optionCount: q.options.length })), answers, c.passMark);
    await this.finish(auth, e, async (transaction) => {
      await TrainingAttempt.create({ organizationId: auth.organizationId!, enrollmentId: e.id, answers, ...result }, { transaction });
      const attempts = e.attempts + 1;
      const failed = !result.passed && !e.passed && attempts >= c.maxAttempts;
      await e.update(
        {
          attempts,
          bestScore: Math.max(e.bestScore ?? 0, result.score),
          passed: e.passed || result.passed,
          status: failed ? 'FAILED' : e.status === 'ENROLLED' ? 'IN_PROGRESS' : e.status,
          startedAt: e.startedAt ?? new Date(),
        },
        { transaction },
      );
      await this.audit.record({ action: 'training.assessment_attempted', entityType: 'TrainingEnrollment', entityId: e.id, summary: `Assessment of ${c.code}: ${result.score}% (${result.passed ? 'passed' : 'not passed'})` }, transaction);
    });
    return { result, enrollment: await this.get(auth, id) };
  }

  async feedback(auth: AuthContext, id: string, dto: CourseFeedbackDto) {
    const { e } = await this.learner(auth, id);
    if (e.status !== 'COMPLETED') throw AppError.conflict('Feedback can be given once the course is completed');
    if (e.feedbackRating) throw AppError.conflict('You already gave feedback on this course');
    await e.update({ feedbackRating: dto.rating, feedbackComment: dto.comment ?? null });
    return this.get(auth, id);
  }

  // ---- Reading ---------------------------------------------------------------------------------

  async list(auth: AuthContext, query: EnrollmentQueryDto) {
    const self = await this.scope.self(auth);
    const conditions: WhereOptions[] = [];
    if ((query.view ?? 'mine') === 'mine') {
      if (!self) return new PaginatedResult([], paginationMeta(query, 0));
      conditions.push({ employeeId: self.id });
    } else {
      const scoped = auth.permissions.has('training.manage') ? {} : await this.scope.where(auth, 'training.assign', 'employeeId');
      if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
      conditions.push(scoped);
    }
    if (query.courseId) conditions.push({ courseId: query.courseId });
    if (query.status) conditions.push({ status: query.status });
    const today = await organizationToday(auth.organizationId!);
    if (query.overdue) conditions.push({ status: OPEN, dueDate: { [Op.lt]: today } });
    const { rows, count } = await TrainingEnrollment.findAndCountAll({ where: { [Op.and]: conditions }, include: INCLUDES, order: [['createdAt', 'DESC']], ...paginationArgs(query) });
    return new PaginatedResult(rows.map((e) => this.summary(e, today)), paginationMeta(query, count));
  }

  async get(auth: AuthContext, id: string) {
    const { e, isLearner, canManage } = await this.access(auth, id);
    const today = await organizationToday(auth.organizationId!);
    const c = e.course!;
    const [attempts, sessions] = await Promise.all([
      TrainingAttempt.findAll({ where: { enrollmentId: id }, attributes: ['id', 'score', 'passed', 'correct', 'total', 'createdAt'], order: [['createdAt', 'ASC']] }),
      isSessionBased(c) && OPEN.includes(e.status) && !e.attended ? TrainingSession.findAll({ where: { courseId: c.id, status: 'SCHEDULED', startsAt: { [Op.gt]: new Date() } }, order: [['startsAt', 'ASC']] }) : Promise.resolve([] as TrainingSession[]),
    ]);
    const seats = await this.courses.enrolledPerSession(sessions.map((s) => s.id));
    const open = OPEN.includes(e.status);
    return {
      ...this.summary(e, today),
      course: presentCourse(c),
      requirementsLeft: open ? requirementsLeft(e, c) : [],
      attemptHistory: attempts.map((a) => ({ id: a.id, score: a.score, passed: a.passed, correct: a.correct, total: a.total, createdAt: a.createdAt })),
      availableSessions: sessions.map((s) => presentSession(s, seats.get(s.id) ?? 0)),
      feedback: e.feedbackRating ? { rating: e.feedbackRating, comment: e.feedbackComment } : null,
      cancelReason: e.cancelReason,
      permissions: {
        start: isLearner && e.status === 'ENROLLED',
        markDone: isLearner && open && !isSessionBased(c) && !c.hasAssessment,
        attempt: isLearner && open && c.hasAssessment && !e.passed && e.attempts < c.maxAttempts,
        changeSession: (isLearner || canManage) && open && isSessionBased(c) && !e.attended,
        cancel: open && (canManage || (isLearner && e.source === 'SELF')),
        feedback: isLearner && e.status === 'COMPLETED' && !e.feedbackRating,
      },
    };
  }

  /** Certifications expiring soon (or expired) within scope, not yet renewed by a later completion. */
  async certifications(auth: AuthContext, query: CertificationQueryDto) {
    const scoped = auth.permissions.has('training.manage') ? {} : await this.scope.where(auth, 'training.assign', 'employeeId');
    if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
    const today = await organizationToday(auth.organizationId!);
    const state = query.state ?? 'EXPIRING';
    const range = state === 'EXPIRED' ? { [Op.lt]: today } : { [Op.between]: [today, addDays(today, CERTIFICATION_WARNING_DAYS)] };
    const rows = await TrainingEnrollment.findAll({ where: { [Op.and]: [scoped, { status: 'COMPLETED', expiresOn: range }] }, include: INCLUDES, order: [['expiresOn', 'ASC']] });
    const renewed = rows.length
      ? await TrainingEnrollment.findAll({ where: { [Op.or]: rows.map((r) => ({ courseId: r.courseId, employeeId: r.employeeId })), [Op.and]: [{ [Op.or]: [{ status: OPEN }, { status: 'COMPLETED' }] }] }, attributes: ['id', 'courseId', 'employeeId', 'status', 'completedOn'] })
      : [];
    const pending = rows.filter((r) => !renewed.some((x) => x.id !== r.id && x.courseId === r.courseId && x.employeeId === r.employeeId && (OPEN.includes(x.status) || (x.completedOn ?? '') > (r.completedOn ?? ''))));
    const page = pending.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    return new PaginatedResult(page.map((e) => this.summary(e, today)), paginationMeta(query, pending.length));
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  private summary(e: TrainingEnrollment, today: string) {
    const open = OPEN.includes(e.status);
    return {
      id: e.id,
      course: { id: e.course!.id, code: e.course!.code, title: e.course!.title, category: e.course!.category, delivery: e.course!.delivery, durationHours: e.course!.durationHours === null ? null : Number(e.course!.durationHours), mandatory: e.course!.mandatory },
      employee: { ...personRef(e.employee)!, department: e.employee?.department?.name ?? null },
      session: e.session ? presentSession(e.session) : null,
      source: e.source,
      dueDate: e.dueDate,
      overdue: open && !!e.dueDate && e.dueDate < today,
      status: e.status,
      attended: e.attended,
      attempts: e.attempts,
      bestScore: e.bestScore,
      passed: e.passed,
      startedAt: e.startedAt,
      completedOn: e.completedOn,
      certificateNumber: e.certificateNumber,
      expiresOn: e.expiresOn,
      certification: e.status === 'COMPLETED' ? certificationState(e.expiresOn, today, CERTIFICATION_WARNING_DAYS) : null,
      createdAt: e.createdAt,
    };
  }

  /** The learner, someone with `training.assign` covering them, or `training.manage`. */
  private async access(auth: AuthContext, id: string) {
    const e = await TrainingEnrollment.findByPk(id, { include: INCLUDES });
    if (!e) throw AppError.notFound('Enrolment');
    const self = await this.scope.self(auth);
    const isLearner = self?.id === e.employeeId;
    const canManage = auth.permissions.has('training.manage') || (!isLearner && (await this.scope.covers(auth, 'training.assign', e.employee!)));
    if (!isLearner && !canManage) throw AppError.notFound('Enrolment');
    return { e, isLearner, canManage };
  }

  private async learner(auth: AuthContext, id: string) {
    const a = await this.access(auth, id);
    if (!a.isLearner) throw AppError.forbidden('Only the learner can do this');
    return a;
  }

  private assertCanAttempt(e: TrainingEnrollment) {
    const c = e.course!;
    if (!c.hasAssessment) throw AppError.conflict('This course has no assessment');
    if (!OPEN.includes(e.status)) throw AppError.conflict('This enrolment is closed');
    if (e.passed) throw AppError.conflict('You have already passed the assessment');
    if (e.attempts >= c.maxAttempts) throw AppError.conflict('No attempts left');
  }

  /** Runs the change, then completes the enrolment if everything is done (notifying the learner). */
  private async finish(auth: AuthContext, e: TrainingEnrollment, change: (t: Transaction) => Promise<void>) {
    const today = await organizationToday(auth.organizationId!);
    await this.db.transaction(async (transaction) => {
      await change(transaction);
      if (await completeIfDone(e, e.course!, today, transaction)) {
        await this.audit.record({ action: 'training.completed', entityType: 'TrainingEnrollment', entityId: e.id, summary: `${e.employee!.employeeCode} completed ${e.course!.code} (certificate ${e.certificateNumber})` }, transaction);
      }
    });
  }

  /** Validates the session for (classroom / virtual) courses: scheduled, in the future, with enough seats. */
  private async checkSession(c: TrainingCourse, sessionId: string | null, seats: number, optional = false): Promise<string | null> {
    if (!isSessionBased(c)) {
      if (sessionId) throw AppError.validation([{ field: 'sessionId', message: 'Self-paced courses have no sessions' }]);
      return null;
    }
    if (!sessionId) {
      if (optional) return null;
      throw AppError.validation([{ field: 'sessionId', message: 'Choose a session' }]);
    }
    const s = await TrainingSession.findOne({ where: { id: sessionId, courseId: c.id } });
    if (!s || s.status !== 'SCHEDULED' || s.startsAt <= new Date()) throw AppError.validation([{ field: 'sessionId', message: 'Choose an upcoming session of this course' }]);
    if (s.capacity !== null) {
      const taken = (await this.courses.enrolledPerSession([s.id])).get(s.id) ?? 0;
      if (taken + seats > s.capacity) throw AppError.conflict(`Not enough seats in this session (${Math.max(0, s.capacity - taken)} left)`);
    }
    return s.id;
  }
}
