import { Injectable } from '@nestjs/common';
import { col, fn, Op, UniqueConstraintError, type Transaction, type WhereOptions } from 'sequelize';
import { MAX_FEEDBACK_REQUESTS_PER_REVIEW, MAX_GOALS_PER_REVIEW } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { DatabaseService } from '../../database/database.service';
import {
  Department,
  Designation,
  Employee,
  PerformanceCycle,
  PerformanceFeedback,
  PerformanceGoal,
  PerformanceReview,
  type CompetencyRating,
} from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  AcknowledgeDto,
  AssessmentDto,
  CalibrateDto,
  FeedbackRequestDto,
  GiveFeedbackDto,
  GoalDto,
  GoalProgressDto,
  ManagerAssessmentDto,
  ReassignReviewerDto,
  ReturnGoalsDto,
  ReviewQueryDto,
  UpdateGoalDto,
} from './dto/performance.dto';
import { fullName, personRef, userIdsOf } from './performance-people';
import { competencyScore, goalScore, goalWeightProblem, overallScore, suggestedRating } from './performance-scoring';

interface Access {
  review: PerformanceReview;
  cycle: PerformanceCycle;
  selfId: string | null;
  isSubject: boolean;
  isReviewer: boolean;
  /** Configures performance (HR): sees everything, calibrates, reassigns. */
  isHr: boolean;
  /** Can see the review (subject, reviewer, HR or `performance.view` covering the employee). */
  canView: boolean;
}

const REVIEW_INCLUDES = [
  { model: PerformanceCycle },
  { model: Employee, as: 'employee', attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'managerId', 'departmentId', 'designationId'], include: [{ model: Department, attributes: ['id', 'name'] }, { model: Designation, attributes: ['id', 'name'] }] },
  { model: Employee, as: 'reviewer', attributes: ['id', 'employeeCode', 'firstName', 'lastName'] },
];
const DONE = ['COMPLETED', 'ACKNOWLEDGED'];

/** Reviews: goals, self and manager assessments, scoring, calibration, acknowledgement and 360 feedback requests. */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Reading ---------------------------------------------------------------------------------

  async list(auth: AuthContext, query: ReviewQueryDto) {
    const self = await this.scope.self(auth);
    const view = query.view ?? 'team';
    const conditions: WhereOptions[] = [];
    if (view === 'mine' || view === 'team') {
      if (!self) return new PaginatedResult([], paginationMeta(query, 0));
      conditions.push(view === 'mine' ? { employeeId: self.id } : { reviewerId: self.id });
    } else {
      const scoped = auth.permissions.has('performance.configure') ? {} : await this.scope.where(auth, 'performance.view', 'employeeId');
      if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
      conditions.push(scoped);
    }
    if (query.cycleId) conditions.push({ cycleId: query.cycleId });
    if (query.stage) conditions.push({ stage: query.stage });
    if (query.search) {
      const like = containsPattern(query.search);
      conditions.push({ [Op.or]: [{ '$employee.first_name$': { [Op.iLike]: like } }, { '$employee.last_name$': { [Op.iLike]: like } }, { '$employee.employee_code$': { [Op.iLike]: like } }] });
    }
    const { rows, count } = await PerformanceReview.findAndCountAll({
      where: { [Op.and]: conditions },
      include: REVIEW_INCLUDES,
      order: [[{ model: PerformanceCycle, as: 'cycle' }, 'periodStart', 'DESC'], [{ model: Employee, as: 'employee' }, 'firstName', 'ASC']],
      ...paginationArgs(query),
    });
    const goalCounts = new Map(
      rows.length
        ? ((await PerformanceGoal.findAll({ where: { reviewId: rows.map((r) => r.id) }, attributes: ['reviewId', [fn('COUNT', col('id')), 'count']], group: ['reviewId'], raw: true })) as unknown as { reviewId: string; count: string }[]).map((g) => [g.reviewId, Number(g.count)])
        : [],
    );
    return new PaginatedResult(
      rows.map((r) => {
        const isSubject = r.employeeId === self?.id;
        const showResults = !isSubject || this.resultsVisible(r, r.cycle!);
        return {
          id: r.id,
          cycle: { id: r.cycle!.id, name: r.cycle!.name, status: r.cycle!.status, resultsReleased: !!r.cycle!.resultsReleasedAt },
          employee: { ...personRef(r.employee)!, department: r.employee?.department?.name ?? null, designation: r.employee?.designation?.name ?? null },
          reviewer: personRef(r.reviewer),
          stage: r.stage,
          goals: goalCounts.get(r.id) ?? 0,
          overallScore: showResults && r.overallScore !== null ? Number(r.overallScore) : null,
          finalRating: showResults ? (r.calibratedRating ?? r.finalRating) : null,
          calibrated: showResults && r.calibratedRating !== null,
          due: this.dueFor(r, r.cycle!),
        };
      }),
      paginationMeta(query, count),
    );
  }

  async get(auth: AuthContext, id: string) {
    return this.present(auth, await this.access(auth, id));
  }

  // ---- Goals -----------------------------------------------------------------------------------

  async addGoal(auth: AuthContext, id: string, dto: GoalDto) {
    const a = await this.access(auth, id);
    this.assertCanEditGoals(auth, a);
    const count = await PerformanceGoal.count({ where: { reviewId: id } });
    if (count >= MAX_GOALS_PER_REVIEW) throw AppError.conflict(`A review can have at most ${MAX_GOALS_PER_REVIEW} goals`);
    this.assertGoalDate(a, dto.dueDate);
    await PerformanceGoal.create({ organizationId: auth.organizationId!, reviewId: id, title: dto.title, description: dto.description ?? null, measure: dto.measure ?? null, weight: dto.weight, dueDate: dto.dueDate ?? null, sortOrder: count, createdById: auth.userId });
    return this.get(auth, id);
  }

  async updateGoal(auth: AuthContext, id: string, goalId: string, dto: UpdateGoalDto) {
    const a = await this.access(auth, id);
    this.assertCanEditGoals(auth, a);
    const goal = await this.goal(id, goalId);
    this.assertGoalDate(a, dto.dueDate);
    await goal.update(dto);
    return this.get(auth, id);
  }

  async removeGoal(auth: AuthContext, id: string, goalId: string) {
    const a = await this.access(auth, id);
    this.assertCanEditGoals(auth, a);
    await (await this.goal(id, goalId)).destroy();
    return this.get(auth, id);
  }

  async submitGoals(auth: AuthContext, id: string) {
    const a = await this.access(auth, id);
    this.assertActive(a);
    if (!a.isSubject || !auth.permissions.has('performance.self_assess')) throw AppError.forbidden();
    if (a.review.stage !== 'GOAL_SETTING') throw AppError.conflict('Goals have already been submitted');
    if (!a.review.reviewerId) throw AppError.conflict('No reviewer is assigned to your review yet. Ask your HR team.');
    await this.assertWeights(id);
    await this.transition(auth, a, { stage: 'GOAL_APPROVAL', goalsSubmittedAt: new Date(), goalsReturnNote: null }, 'performance.goals_submitted', 'Goals submitted for approval', {
      to: a.review.reviewerId,
      title: `${fullName(a.review.employee!)} submitted goals for ${a.cycle.name}`,
    });
    return this.get(auth, id);
  }

  /** The reviewer approves goals (also directly from goal setting, e.g. goals set by the manager). */
  async approveGoals(auth: AuthContext, id: string) {
    const a = await this.access(auth, id);
    this.assertReviewer(auth, a);
    if (a.review.stage !== 'GOAL_SETTING' && a.review.stage !== 'GOAL_APPROVAL') throw AppError.conflict('Goals are already approved');
    await this.assertWeights(id);
    await this.transition(auth, a, { stage: 'SELF_REVIEW', goalsApprovedAt: new Date(), goalsReturnNote: null }, 'performance.goals_approved', 'Goals approved', {
      to: a.review.employeeId,
      title: `Your goals for ${a.cycle.name} were approved`,
    });
    return this.get(auth, id);
  }

  async returnGoals(auth: AuthContext, id: string, dto: ReturnGoalsDto) {
    const a = await this.access(auth, id);
    this.assertReviewer(auth, a);
    if (a.review.stage !== 'GOAL_APPROVAL') throw AppError.conflict('Only submitted goals can be sent back');
    await this.transition(auth, a, { stage: 'GOAL_SETTING', goalsReturnNote: dto.note }, 'performance.goals_returned', `Goals sent back: ${dto.note}`, {
      to: a.review.employeeId,
      title: `Your goals for ${a.cycle.name} need changes`,
      body: dto.note,
    });
    return this.get(auth, id);
  }

  async updateProgress(auth: AuthContext, id: string, goalId: string, dto: GoalProgressDto) {
    const a = await this.access(auth, id);
    this.assertActive(a);
    if (!a.isSubject && !(a.isReviewer && auth.permissions.has('performance.review'))) throw AppError.forbidden();
    if (a.review.stage !== 'SELF_REVIEW' && a.review.stage !== 'MANAGER_REVIEW') throw AppError.conflict('Progress is tracked once goals are approved and until the review is completed');
    await (await this.goal(id, goalId)).update({ progress: dto.progress, progressNote: dto.progressNote ?? null });
    return this.get(auth, id);
  }

  // ---- Assessments -----------------------------------------------------------------------------

  async selfAssessment(auth: AuthContext, id: string, dto: AssessmentDto) {
    const a = await this.access(auth, id);
    this.assertActive(a);
    if (!a.isSubject || !auth.permissions.has('performance.self_assess')) throw AppError.forbidden();
    if (a.review.stage !== 'SELF_REVIEW') throw AppError.conflict(a.review.stage === 'GOAL_SETTING' || a.review.stage === 'GOAL_APPROVAL' ? 'Your goals need to be approved first' : 'Your self-assessment has already been submitted');
    const goals = await PerformanceGoal.findAll({ where: { reviewId: id } });
    const competencies = this.mergeCompetencies(a.cycle, a.review.selfCompetencies, dto.competencies);
    if (dto.submit) this.assertComplete(goals, dto.goals, competencies, 'your self-assessment');
    await this.db.transaction(async (transaction) => {
      await this.saveGoalRatings(goals, dto.goals, 'self', transaction);
      await a.review.update({ selfCompetencies: competencies, selfComment: dto.comment ?? null, ...(dto.submit ? { stage: 'MANAGER_REVIEW', selfSubmittedAt: new Date() } : {}) }, { transaction });
      if (dto.submit) {
        await this.audit.record({ action: 'performance.self_review_submitted', entityType: 'PerformanceReview', entityId: id, summary: `Self-assessment submitted (${a.cycle.name})` }, transaction);
        await this.notify(auth, a.review.reviewerId, { title: `${fullName(a.review.employee!)} submitted a self-assessment`, link: `/hr/performance/reviews/${id}` }, transaction);
      }
    });
    return this.get(auth, id);
  }

  /** The assigned reviewer rates goals and competencies; submitting computes the scores and completes the review. */
  async managerAssessment(auth: AuthContext, id: string, dto: ManagerAssessmentDto) {
    const a = await this.access(auth, id);
    this.assertReviewer(auth, a);
    if (a.review.stage !== 'SELF_REVIEW' && a.review.stage !== 'MANAGER_REVIEW') {
      throw AppError.conflict(DONE.includes(a.review.stage) ? 'This review is already completed' : 'Goals need to be approved first');
    }
    if (dto.submit && a.review.stage !== 'MANAGER_REVIEW') throw AppError.conflict('Wait for the self-assessment before submitting your review');
    const goals = await PerformanceGoal.findAll({ where: { reviewId: id }, order: [['sortOrder', 'ASC']] });
    const competencies = this.mergeCompetencies(a.cycle, a.review.managerCompetencies, dto.competencies);
    let scores: Partial<PerformanceReview> = {};
    if (dto.submit) {
      this.assertComplete(goals, dto.goals, competencies, 'the review');
      const ratings = new Map(dto.goals.map((g) => [g.goalId, g.rating ?? null]));
      const gs = goalScore(goals.map((g) => ({ weight: g.weight, rating: ratings.has(g.id) ? ratings.get(g.id)! : g.managerRating })));
      const cs = competencyScore(competencies.map((c) => c.rating));
      const overall = overallScore(gs, cs, a.cycle.goalsWeight, a.cycle.competencies.length > 0);
      scores = {
        goalScore: gs === null ? null : String(gs),
        competencyScore: cs === null ? null : String(cs),
        overallScore: overall === null ? null : String(overall),
        finalRating: dto.finalRating ?? suggestedRating(overall),
        stage: 'COMPLETED',
        managerSubmittedAt: new Date(),
      };
    }
    await this.db.transaction(async (transaction) => {
      await this.saveGoalRatings(goals, dto.goals, 'manager', transaction);
      await a.review.update({ managerCompetencies: competencies, managerComment: dto.comment ?? null, strengths: dto.strengths ?? null, improvements: dto.improvements ?? null, ...scores }, { transaction });
      if (dto.submit) {
        await this.audit.record({ action: 'performance.manager_review_submitted', entityType: 'PerformanceReview', entityId: id, summary: `Manager review of ${a.review.employee!.employeeCode} submitted (${a.cycle.name})`, metadata: { finalRating: scores.finalRating } }, transaction);
        await PerformanceFeedback.update({ status: 'DECLINED' }, { where: { reviewId: id, status: 'REQUESTED' }, transaction });
        if (a.cycle.resultsReleasedAt) {
          await this.notify(auth, a.review.employeeId, { title: `Your ${a.cycle.name} review is ready`, link: `/me/performance/reviews/${id}` }, transaction);
        }
      }
    });
    return this.get(auth, id);
  }

  /** HR adjusts the final rating of a completed review before results are released. */
  async calibrate(auth: AuthContext, id: string, dto: CalibrateDto) {
    const a = await this.access(auth, id);
    this.assertActive(a);
    if (!a.isHr) throw AppError.forbidden();
    if (a.isSubject) throw AppError.forbidden("You can't calibrate your own review");
    if (a.review.stage !== 'COMPLETED') throw AppError.conflict('Only completed reviews can be calibrated');
    if (a.cycle.resultsReleasedAt) throw AppError.conflict('Results are already released; ratings can no longer be calibrated');
    await this.db.transaction(async (transaction) => {
      await a.review.update({ calibratedRating: dto.rating, calibrationNote: dto.note, calibratedById: auth.userId, calibratedAt: new Date() }, { transaction });
      await this.audit.record(
        { action: 'performance.review_calibrated', entityType: 'PerformanceReview', entityId: id, summary: `Rating of ${a.review.employee!.employeeCode} calibrated from ${a.review.finalRating} to ${dto.rating}`, metadata: { from: a.review.finalRating, to: dto.rating } },
        transaction,
      );
    });
    return this.get(auth, id);
  }

  async acknowledge(auth: AuthContext, id: string, dto: AcknowledgeDto) {
    const a = await this.access(auth, id);
    if (!a.isSubject) throw AppError.forbidden();
    if (a.review.stage !== 'COMPLETED' || !a.cycle.resultsReleasedAt) throw AppError.conflict('There is no released review to acknowledge');
    await this.transition(auth, a, { stage: 'ACKNOWLEDGED', acknowledgedAt: new Date(), employeeResponse: dto.comment ?? null }, 'performance.review_acknowledged', 'Review acknowledged', {
      to: a.review.reviewerId,
      title: `${fullName(a.review.employee!)} acknowledged their ${a.cycle.name} review`,
      body: dto.comment ?? undefined,
    });
    return this.get(auth, id);
  }

  async reassign(auth: AuthContext, id: string, dto: ReassignReviewerDto) {
    const a = await this.access(auth, id);
    this.assertActive(a);
    if (!a.isHr) throw AppError.forbidden();
    if (DONE.includes(a.review.stage)) throw AppError.conflict('The review is already completed');
    if (dto.reviewerId === a.review.employeeId) throw AppError.validation([{ field: 'reviewerId', message: "Employees can't review themselves" }]);
    const reviewer = await Employee.findOne({ where: { id: dto.reviewerId, status: ['ACTIVE', 'ON_NOTICE'] } });
    if (!reviewer) throw AppError.validation([{ field: 'reviewerId', message: 'Choose an active employee' }]);
    await this.transition(auth, a, { reviewerId: reviewer.id }, 'performance.reviewer_assigned', `Reviewer set to ${fullName(reviewer)}`, {
      to: reviewer.id,
      title: `You are now reviewing ${fullName(a.review.employee!)} (${a.cycle.name})`,
    });
    return this.get(auth, id);
  }

  // ---- 360 feedback ----------------------------------------------------------------------------

  async requestFeedback(auth: AuthContext, id: string, dto: FeedbackRequestDto) {
    const a = await this.access(auth, id);
    this.assertActive(a);
    if (!a.isSubject && !(a.isReviewer && auth.permissions.has('performance.review'))) throw AppError.forbidden();
    if (DONE.includes(a.review.stage)) throw AppError.conflict('Feedback can be requested until the review is completed');
    if (dto.employeeIds.includes(a.review.employeeId)) throw AppError.validation([{ field: 'employeeIds', message: "Someone can't give feedback on their own review" }]);
    const existing = await PerformanceFeedback.findAll({ where: { reviewId: id }, attributes: ['giverId'] });
    const fresh = dto.employeeIds.filter((e) => !existing.some((x) => x.giverId === e));
    if (existing.length + fresh.length > MAX_FEEDBACK_REQUESTS_PER_REVIEW) throw AppError.conflict(`A review can have at most ${MAX_FEEDBACK_REQUESTS_PER_REVIEW} feedback requests`);
    const givers = await Employee.findAll({ where: { id: fresh, status: ['ACTIVE', 'ON_NOTICE'] }, attributes: ['id'] });
    if (givers.length !== fresh.length) throw AppError.validation([{ field: 'employeeIds', message: 'Choose active employees' }]);
    try {
      await this.db.transaction(async (transaction) => {
        await PerformanceFeedback.bulkCreate(givers.map((g) => ({ organizationId: auth.organizationId!, reviewId: id, giverId: g.id, requestedById: auth.userId })), { transaction });
        const users = await userIdsOf(givers.map((g) => g.id), transaction);
        for (const userId of users.values()) {
          if (userId === auth.userId) continue;
          await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'performance.feedback', title: `Feedback requested on ${fullName(a.review.employee!)}`, body: a.cycle.name, link: '/me/performance/feedback' }, transaction);
        }
        await this.audit.record({ action: 'performance.feedback_requested', entityType: 'PerformanceReview', entityId: id, summary: `Feedback requested from ${givers.length} colleague(s)` }, transaction);
      });
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict('Feedback was already requested from someone selected');
      throw e;
    }
    return this.get(auth, id);
  }

  /** Feedback requests addressed to the caller. */
  async myFeedbackRequests(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return [];
    const rows = await PerformanceFeedback.findAll({
      where: { giverId: self.id },
      include: [{ model: PerformanceReview, attributes: ['id', 'stage', 'employeeId', 'cycleId'], include: [{ model: PerformanceCycle, attributes: ['id', 'name', 'status'] }, { model: Employee, as: 'employee', attributes: ['id', 'employeeCode', 'firstName', 'lastName'] }] }],
      order: [['createdAt', 'DESC']],
    });
    return rows.map((f) => ({
      id: f.id,
      status: f.status,
      open: f.status === 'REQUESTED' && !DONE.includes(f.review!.stage) && f.review!.cycle!.status === 'ACTIVE',
      subject: personRef(f.review!.employee),
      cycle: { id: f.review!.cycle!.id, name: f.review!.cycle!.name },
      rating: f.rating,
      strengths: f.strengths,
      improvements: f.improvements,
      submittedAt: f.submittedAt,
      createdAt: f.createdAt,
    }));
  }

  async giveFeedback(auth: AuthContext, feedbackId: string, dto: GiveFeedbackDto | null) {
    const self = await this.scope.self(auth);
    const f = await PerformanceFeedback.findByPk(feedbackId, { include: [{ model: PerformanceReview, include: [{ model: PerformanceCycle }] }] });
    if (!f || !self || f.giverId !== self.id) throw AppError.notFound('Feedback request');
    if (f.status !== 'REQUESTED') throw AppError.conflict(`This request is already ${f.status === 'SUBMITTED' ? 'answered' : 'declined'}`);
    if (DONE.includes(f.review!.stage) || f.review!.cycle!.status !== 'ACTIVE') throw AppError.conflict('This review is already completed');
    await this.db.transaction(async (transaction) => {
      if (dto) await f.update({ status: 'SUBMITTED', rating: dto.rating ?? null, strengths: dto.strengths, improvements: dto.improvements, submittedAt: new Date() }, { transaction });
      else await f.update({ status: 'DECLINED' }, { transaction });
      await this.audit.record({ action: dto ? 'performance.feedback_given' : 'performance.feedback_declined', entityType: 'PerformanceReview', entityId: f.reviewId, summary: dto ? 'Peer feedback submitted' : 'Feedback request declined' }, transaction);
    });
    return (await this.myFeedbackRequests(auth)).find((r) => r.id === feedbackId)!;
  }

  /** Active colleagues to ask for feedback or assign as reviewer: names and roles only (no other employee data). */
  async colleagues(auth: AuthContext, search?: string) {
    const self = await this.scope.self(auth);
    const like = search ? containsPattern(search) : null;
    const rows = await Employee.findAll({
      where: {
        status: ['ACTIVE', 'ON_NOTICE'],
        ...(self ? { id: { [Op.ne]: self.id } } : {}),
        ...(like ? { [Op.or]: [{ firstName: { [Op.iLike]: like } }, { lastName: { [Op.iLike]: like } }, { employeeCode: { [Op.iLike]: like } }] } : {}),
      },
      attributes: ['id', 'employeeCode', 'firstName', 'lastName'],
      include: [{ model: Department, attributes: ['id', 'name'] }, { model: Designation, attributes: ['id', 'name'] }],
      order: [['firstName', 'ASC'], ['lastName', 'ASC']],
      limit: 20,
    });
    return rows.map((e) => ({ ...personRef(e)!, department: e.department?.name ?? null, designation: e.designation?.name ?? null }));
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  private async access(auth: AuthContext, id: string): Promise<Access> {
    const review = await PerformanceReview.findByPk(id, { include: REVIEW_INCLUDES });
    if (!review) throw AppError.notFound('Review');
    const self = await this.scope.self(auth);
    const isSubject = !!self && review.employeeId === self.id;
    const isReviewer = !!self && review.reviewerId === self.id;
    const isHr = auth.permissions.has('performance.configure');
    const canView = isSubject || isReviewer || isHr || (await this.scope.covers(auth, 'performance.view', review.employee!));
    if (!canView) throw AppError.notFound('Review');
    return { review, cycle: review.cycle!, selfId: self?.id ?? null, isSubject, isReviewer, isHr, canView };
  }

  private resultsVisible(r: PerformanceReview, c: PerformanceCycle) {
    return !!c.resultsReleasedAt && DONE.includes(r.stage);
  }

  private dueFor(r: PerformanceReview, c: PerformanceCycle): string | null {
    if (c.status !== 'ACTIVE') return null;
    if (r.stage === 'GOAL_SETTING' || r.stage === 'GOAL_APPROVAL') return c.goalsDue;
    if (r.stage === 'SELF_REVIEW') return c.selfReviewDue;
    if (r.stage === 'MANAGER_REVIEW') return c.managerReviewDue;
    return null;
  }

  private async present(auth: AuthContext, a: Access) {
    const { review: r, cycle: c } = a;
    const [goals, feedback] = await Promise.all([
      PerformanceGoal.findAll({ where: { reviewId: r.id }, order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']] }),
      PerformanceFeedback.findAll({ where: { reviewId: r.id }, include: [{ model: Employee, as: 'giver', attributes: ['id', 'employeeCode', 'firstName', 'lastName'] }], order: [['createdAt', 'ASC']] }),
    ]);
    const others = !a.isSubject;
    const managerVisible = (others && (a.isReviewer || DONE.includes(r.stage))) || this.resultsVisible(r, c);
    const selfVisible = a.isSubject || !!r.selfSubmittedAt;
    const namedFeedback = !a.isSubject && (a.isReviewer || a.isHr);
    const active = c.status === 'ACTIVE';
    const reviewerActs = active && a.isReviewer && auth.permissions.has('performance.review');
    const subjectActs = active && a.isSubject && auth.permissions.has('performance.self_assess');
    return {
      id: r.id,
      cycle: { id: c.id, name: c.name, status: c.status, periodStart: c.periodStart, periodEnd: c.periodEnd, goalsDue: c.goalsDue, selfReviewDue: c.selfReviewDue, managerReviewDue: c.managerReviewDue, goalsWeight: c.goalsWeight, competencies: c.competencies, ratingLabels: c.ratingLabels, resultsReleased: !!c.resultsReleasedAt },
      employee: { ...personRef(r.employee)!, department: r.employee?.department?.name ?? null, designation: r.employee?.designation?.name ?? null },
      reviewer: personRef(r.reviewer),
      stage: r.stage,
      goalsSubmittedAt: r.goalsSubmittedAt,
      goalsApprovedAt: r.goalsApprovedAt,
      goalsReturnNote: r.goalsReturnNote,
      goals: goals.map((g) => ({
        id: g.id,
        title: g.title,
        description: g.description,
        measure: g.measure,
        weight: g.weight,
        dueDate: g.dueDate,
        progress: g.progress,
        progressNote: g.progressNote,
        selfRating: selfVisible ? g.selfRating : null,
        selfComment: selfVisible ? g.selfComment : null,
        managerRating: managerVisible ? g.managerRating : null,
        managerComment: managerVisible ? g.managerComment : null,
      })),
      self: selfVisible ? { competencies: r.selfCompetencies, comment: r.selfComment, submittedAt: r.selfSubmittedAt } : { competencies: [], comment: null, submittedAt: r.selfSubmittedAt },
      manager: managerVisible
        ? {
            competencies: r.managerCompetencies,
            comment: r.managerComment,
            strengths: r.strengths,
            improvements: r.improvements,
            submittedAt: r.managerSubmittedAt,
            goalScore: r.goalScore === null ? null : Number(r.goalScore),
            competencyScore: r.competencyScore === null ? null : Number(r.competencyScore),
            overallScore: r.overallScore === null ? null : Number(r.overallScore),
            finalRating: r.finalRating,
            calibratedRating: r.calibratedRating,
            calibrationNote: others ? r.calibrationNote : null,
            rating: r.calibratedRating ?? r.finalRating,
          }
        : null,
      acknowledgedAt: r.acknowledgedAt,
      employeeResponse: r.employeeResponse,
      feedback: namedFeedback
        ? feedback.map((f) => ({ id: f.id, giver: personRef(f.giver), status: f.status, rating: f.rating, strengths: f.strengths, improvements: f.improvements, submittedAt: f.submittedAt }))
        : others || this.resultsVisible(r, c)
          ? feedback.filter((f) => f.status === 'SUBMITTED').map((f) => ({ id: f.id, giver: null, status: f.status, rating: f.rating, strengths: f.strengths, improvements: f.improvements, submittedAt: f.submittedAt }))
          : [],
      feedbackRequested: feedback.length,
      viewer: { isSubject: a.isSubject, isReviewer: a.isReviewer, isHr: a.isHr },
      permissions: {
        editGoals: (subjectActs && r.stage === 'GOAL_SETTING') || (reviewerActs && (r.stage === 'GOAL_SETTING' || r.stage === 'GOAL_APPROVAL')),
        submitGoals: subjectActs && r.stage === 'GOAL_SETTING' && !!r.reviewerId,
        approveGoals: reviewerActs && (r.stage === 'GOAL_SETTING' || r.stage === 'GOAL_APPROVAL'),
        returnGoals: reviewerActs && r.stage === 'GOAL_APPROVAL',
        updateProgress: (active && (a.isSubject || reviewerActs)) && (r.stage === 'SELF_REVIEW' || r.stage === 'MANAGER_REVIEW'),
        selfAssess: subjectActs && r.stage === 'SELF_REVIEW',
        managerAssess: reviewerActs && (r.stage === 'SELF_REVIEW' || r.stage === 'MANAGER_REVIEW'),
        submitManagerReview: reviewerActs && r.stage === 'MANAGER_REVIEW',
        requestFeedback: active && (a.isSubject || reviewerActs) && !DONE.includes(r.stage),
        calibrate: active && a.isHr && !a.isSubject && r.stage === 'COMPLETED' && !c.resultsReleasedAt,
        acknowledge: a.isSubject && r.stage === 'COMPLETED' && !!c.resultsReleasedAt,
        reassign: active && a.isHr && !DONE.includes(r.stage),
      },
    };
  }

  private assertActive(a: Access) {
    if (a.cycle.status !== 'ACTIVE') throw AppError.conflict(a.cycle.status === 'CLOSED' ? 'This cycle is closed' : 'This cycle has not started');
  }

  private assertReviewer(auth: AuthContext, a: Access) {
    this.assertActive(a);
    if (!a.isReviewer || !auth.permissions.has('performance.review')) throw AppError.forbidden('Only the assigned reviewer can do this');
  }

  private assertCanEditGoals(auth: AuthContext, a: Access) {
    this.assertActive(a);
    const subject = a.isSubject && auth.permissions.has('performance.self_assess') && a.review.stage === 'GOAL_SETTING';
    const reviewer = a.isReviewer && auth.permissions.has('performance.review') && (a.review.stage === 'GOAL_SETTING' || a.review.stage === 'GOAL_APPROVAL');
    if (subject || reviewer) return;
    if (a.isSubject || a.isReviewer) throw AppError.conflict('Goals can no longer be changed at this stage');
    throw AppError.forbidden();
  }

  private assertGoalDate(a: Access, dueDate: string | null | undefined) {
    if (dueDate && (dueDate < a.cycle.periodStart || dueDate > a.cycle.periodEnd)) {
      throw AppError.validation([{ field: 'dueDate', message: `The due date must be within the cycle (${a.cycle.periodStart} to ${a.cycle.periodEnd})` }]);
    }
  }

  private async assertWeights(reviewId: string) {
    const problem = goalWeightProblem((await PerformanceGoal.findAll({ where: { reviewId }, attributes: ['weight'] })).map((g) => g.weight));
    if (problem) throw AppError.validation([{ field: 'goals', message: problem }]);
  }

  private async goal(reviewId: string, goalId: string): Promise<PerformanceGoal> {
    const g = await PerformanceGoal.findOne({ where: { id: goalId, reviewId } });
    if (!g) throw AppError.notFound('Goal');
    return g;
  }

  /** Saved competency ratings updated with the submitted ones, for the cycle's competencies only. */
  private mergeCompetencies(c: PerformanceCycle, saved: CompetencyRating[], incoming: AssessmentDto['competencies']): CompetencyRating[] {
    const unknown = (incoming ?? []).filter((i) => !c.competencies.some((k) => k.key === i.key));
    if (unknown.length) throw AppError.validation([{ field: 'competencies', message: `Unknown competency: ${unknown.map((u) => u.key).join(', ')}` }]);
    return c.competencies.map((k) => {
      const next = incoming?.find((i) => i.key === k.key);
      const prev = saved.find((s) => s.key === k.key);
      return { key: k.key, rating: next ? (next.rating ?? null) : (prev?.rating ?? null), comment: next ? (next.comment ?? null) : (prev?.comment ?? null) };
    });
  }

  private assertComplete(goals: PerformanceGoal[], incoming: AssessmentDto['goals'], competencies: CompetencyRating[], what: string) {
    const rated = new Map(incoming.map((g) => [g.goalId, g.rating]));
    const missingGoals = goals.filter((g) => !rated.get(g.id));
    const missingCompetencies = competencies.filter((c) => !c.rating);
    if (missingGoals.length || missingCompetencies.length) {
      throw AppError.validation([
        ...(missingGoals.length ? [{ field: 'goals', message: `Rate every goal before submitting ${what} (${missingGoals.length} left)` }] : []),
        ...(missingCompetencies.length ? [{ field: 'competencies', message: `Rate every competency before submitting ${what} (${missingCompetencies.length} left)` }] : []),
      ]);
    }
  }

  private async saveGoalRatings(goals: PerformanceGoal[], incoming: AssessmentDto['goals'], who: 'self' | 'manager', transaction: Transaction) {
    const byId = new Map(goals.map((g) => [g.id, g]));
    for (const g of incoming) {
      const goal = byId.get(g.goalId);
      if (!goal) throw AppError.validation([{ field: 'goals', message: 'A rated goal is not part of this review' }]);
      await goal.update(who === 'self' ? { selfRating: g.rating ?? null, selfComment: g.comment ?? null } : { managerRating: g.rating ?? null, managerComment: g.comment ?? null }, { transaction });
    }
  }

  private async transition(
    auth: AuthContext,
    a: Access,
    changes: Partial<PerformanceReview>,
    action: string,
    summary: string,
    notify: { to: string | null; title: string; body?: string },
  ) {
    await this.db.transaction(async (transaction) => {
      await a.review.update(changes, { transaction });
      await this.audit.record({ action, entityType: 'PerformanceReview', entityId: a.review.id, summary: `${a.review.employee!.employeeCode} · ${a.cycle.name}: ${summary}` }, transaction);
      const link = notify.to === a.review.employeeId ? `/me/performance/reviews/${a.review.id}` : `/hr/performance/reviews/${a.review.id}`;
      await this.notify(auth, notify.to, { title: notify.title, body: notify.body, link }, transaction);
    });
  }

  private async notify(auth: AuthContext, employeeId: string | null, n: { title: string; body?: string; link: string }, transaction: Transaction) {
    if (!employeeId) return;
    const userId = (await userIdsOf([employeeId], transaction)).get(employeeId);
    if (userId && userId !== auth.userId) await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'performance.review', ...n }, transaction);
  }
}
