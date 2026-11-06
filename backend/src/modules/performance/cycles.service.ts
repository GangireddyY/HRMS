import { Injectable } from '@nestjs/common';
import { col, fn, Op, type Transaction, type WhereOptions } from 'sequelize';
import { DEFAULT_RATING_LABELS, REVIEW_STAGES, type ReviewStage } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { DatabaseService } from '../../database/database.service';
import { Department, Employee, PerformanceCycle, PerformanceReview } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AddParticipantsDto, CycleDto, CycleQueryDto, UpdateCycleDto } from './dto/performance.dto';
import { userIdsOf } from './performance-people';
import { distribution } from './performance-scoring';

/** Fields that can still change once a cycle is running. */
const ACTIVE_EDITABLE = ['name', 'description', 'goalsDue', 'selfReviewDue', 'managerReviewDue'] as const;

export function presentCycle(c: PerformanceCycle) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    periodStart: c.periodStart,
    periodEnd: c.periodEnd,
    goalsDue: c.goalsDue,
    selfReviewDue: c.selfReviewDue,
    managerReviewDue: c.managerReviewDue,
    goalsWeight: c.goalsWeight,
    competencies: c.competencies,
    ratingLabels: c.ratingLabels,
    eligibilityCutoff: c.eligibilityCutoff,
    departmentIds: c.departmentIds,
    status: c.status,
    launchedAt: c.launchedAt,
    resultsReleasedAt: c.resultsReleasedAt,
    closedAt: c.closedAt,
    createdAt: c.createdAt,
  };
}

/** Review cycles (`performance.configure`): set up, launch for eligible employees, release results, close. */
@Injectable()
export class CyclesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: CycleQueryDto) {
    const where: WhereOptions = query.status ? { status: query.status } : {};
    const { rows, count } = await PerformanceCycle.findAndCountAll({ where, order: [['periodStart', 'DESC'], ['createdAt', 'DESC']], ...paginationArgs(query) });
    const stats = await this.stageCounts(rows.map((r) => r.id));
    return new PaginatedResult(rows.map((c) => ({ ...presentCycle(c), stages: stats.get(c.id) ?? this.emptyStages() })), paginationMeta(query, count));
  }

  async get(id: string) {
    const c = await this.find(id);
    const [stages, reviews, departments] = await Promise.all([
      this.stageCounts([id]),
      PerformanceReview.findAll({ where: { cycleId: id }, attributes: ['finalRating', 'calibratedRating', 'reviewerId', 'stage'] }),
      c.departmentIds?.length ? Department.findAll({ where: { id: c.departmentIds }, attributes: ['id', 'name'] }) : Promise.resolve([] as Department[]),
    ]);
    const done = reviews.filter((r) => r.stage === 'COMPLETED' || r.stage === 'ACKNOWLEDGED');
    return {
      ...presentCycle(c),
      departments: departments.map((d) => ({ id: d.id, name: d.name })),
      stages: stages.get(id) ?? this.emptyStages(),
      participants: reviews.length,
      withoutReviewer: reviews.filter((r) => !r.reviewerId && r.stage !== 'COMPLETED' && r.stage !== 'ACKNOWLEDGED').length,
      distribution: distribution(done.map((r) => r.calibratedRating ?? r.finalRating)),
      calibrated: done.filter((r) => r.calibratedRating !== null).length,
    };
  }

  async create(auth: AuthContext, dto: CycleDto) {
    this.validate(dto);
    const c = await this.db.transaction(async (transaction) => {
      const created = await PerformanceCycle.create(
        {
          organizationId: auth.organizationId!,
          name: dto.name,
          description: dto.description ?? null,
          periodStart: dto.periodStart,
          periodEnd: dto.periodEnd,
          goalsDue: dto.goalsDue ?? null,
          selfReviewDue: dto.selfReviewDue ?? null,
          managerReviewDue: dto.managerReviewDue ?? null,
          goalsWeight: dto.goalsWeight ?? 70,
          competencies: (dto.competencies ?? []).map((k) => ({ key: k.key, name: k.name, description: k.description ?? null })),
          ratingLabels: dto.ratingLabels ?? DEFAULT_RATING_LABELS,
          eligibilityCutoff: dto.eligibilityCutoff ?? null,
          departmentIds: dto.departmentIds?.length ? dto.departmentIds : null,
          createdById: auth.userId,
          updatedById: auth.userId,
        },
        { transaction },
      );
      await this.audit.record({ action: 'performance.cycle_created', entityType: 'PerformanceCycle', entityId: created.id, summary: `Review cycle "${created.name}" created` }, transaction);
      return created;
    });
    return this.get(c.id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateCycleDto) {
    const c = await this.find(id);
    if (c.status === 'CLOSED') throw AppError.conflict('A closed cycle can no longer be changed');
    if (c.status === 'ACTIVE') {
      const locked = Object.keys(dto).filter((k) => dto[k as keyof UpdateCycleDto] !== undefined && !(ACTIVE_EDITABLE as readonly string[]).includes(k));
      if (locked.length) throw AppError.conflict(`Once a cycle is running only its name, description and due dates can change (not ${locked.join(', ')})`);
    }
    const next = { ...presentCycle(c), ...Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) } as CycleDto;
    this.validate(next);
    const { competencies: _ignored, ...rest } = dto;
    await this.db.transaction(async (transaction) => {
      await c.update(
        {
          ...rest,
          ...(dto.competencies ? { competencies: dto.competencies.map((k) => ({ key: k.key, name: k.name, description: k.description ?? null })) } : {}),
          ...(dto.departmentIds !== undefined ? { departmentIds: dto.departmentIds?.length ? dto.departmentIds : null } : {}),
          updatedById: auth.userId,
        },
        { transaction },
      );
      await this.audit.record({ action: 'performance.cycle_updated', entityType: 'PerformanceCycle', entityId: id, summary: `Review cycle "${c.name}" updated` }, transaction);
    });
    return this.get(id);
  }

  async remove(auth: AuthContext, id: string) {
    const c = await this.find(id);
    if (c.status !== 'DRAFT') throw AppError.conflict('Only a draft cycle can be deleted');
    await this.db.transaction(async (transaction) => {
      await c.destroy({ transaction });
      await this.audit.record({ action: 'performance.cycle_deleted', entityType: 'PerformanceCycle', entityId: id, summary: `Review cycle "${c.name}" deleted` }, transaction);
    });
  }

  /** Starts the cycle: a review for every eligible active employee, with their manager as reviewer. */
  async launch(auth: AuthContext, id: string) {
    const c = await this.find(id);
    if (c.status !== 'DRAFT') throw AppError.conflict('This cycle has already been launched');
    this.validate(presentCycle(c) as CycleDto, true);
    const employees = await this.eligible(c);
    if (!employees.length) throw AppError.conflict('No active employees match this cycle (check the joining cutoff and departments)');
    const count = await this.db.transaction(async (transaction) => {
      const locked = await PerformanceCycle.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (locked!.status !== 'DRAFT') throw AppError.conflict('This cycle has already been launched');
      await this.createReviews(auth, c, employees, transaction);
      await locked!.update({ status: 'ACTIVE', launchedAt: new Date(), updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'performance.cycle_launched', entityType: 'PerformanceCycle', entityId: id, summary: `Review cycle "${c.name}" launched for ${employees.length} employees` }, transaction);
      return employees.length;
    });
    return { ...(await this.get(id)), launchedFor: count };
  }

  async addParticipants(auth: AuthContext, id: string, dto: AddParticipantsDto) {
    const c = await this.find(id);
    if (c.status !== 'ACTIVE') throw AppError.conflict('Participants can be added while the cycle is running');
    const existing = new Set((await PerformanceReview.findAll({ where: { cycleId: id, employeeId: dto.employeeIds }, attributes: ['employeeId'] })).map((r) => r.employeeId));
    const employees = await Employee.findAll({ where: { id: dto.employeeIds.filter((e) => !existing.has(e)), status: 'ACTIVE' } });
    if (!employees.length) throw AppError.conflict('Everyone selected is already in this cycle (or not active)');
    await this.db.transaction(async (transaction) => {
      await this.createReviews(auth, c, employees, transaction);
      await this.audit.record({ action: 'performance.participants_added', entityType: 'PerformanceCycle', entityId: id, summary: `${employees.length} employee(s) added to "${c.name}"` }, transaction);
    });
    return this.get(id);
  }

  /** Completed reviews become visible to employees (ratings, manager comments and anonymous feedback). */
  async release(auth: AuthContext, id: string) {
    const c = await this.find(id);
    if (c.status !== 'ACTIVE') throw AppError.conflict('Results can be released while the cycle is running');
    if (c.resultsReleasedAt) throw AppError.conflict('Results are already released');
    await this.db.transaction(async (transaction) => {
      await c.update({ resultsReleasedAt: new Date(), updatedById: auth.userId }, { transaction });
      const done = await PerformanceReview.findAll({ where: { cycleId: id, stage: 'COMPLETED' }, attributes: ['id', 'employeeId'], transaction });
      const users = await userIdsOf(done.map((r) => r.employeeId), transaction);
      for (const r of done) {
        const userId = users.get(r.employeeId);
        if (userId) await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'performance.review', title: `Your ${c.name} review is ready`, link: `/me/performance/reviews/${r.id}` }, transaction);
      }
      await this.audit.record({ action: 'performance.results_released', entityType: 'PerformanceCycle', entityId: id, summary: `Results of "${c.name}" released (${done.length} completed reviews)` }, transaction);
    });
    return this.get(id);
  }

  async close(auth: AuthContext, id: string) {
    const c = await this.find(id);
    if (c.status !== 'ACTIVE') throw AppError.conflict('Only a running cycle can be closed');
    await this.db.transaction(async (transaction) => {
      await c.update({ status: 'CLOSED', closedAt: new Date(), updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'performance.cycle_closed', entityType: 'PerformanceCycle', entityId: id, summary: `Review cycle "${c.name}" closed` }, transaction);
    });
    return this.get(id);
  }

  async find(id: string): Promise<PerformanceCycle> {
    const c = await PerformanceCycle.findByPk(id);
    if (!c) throw AppError.notFound('Review cycle');
    return c;
  }

  private async eligible(c: PerformanceCycle): Promise<Employee[]> {
    return Employee.findAll({
      where: {
        status: 'ACTIVE',
        ...(c.eligibilityCutoff ? { dateOfJoining: { [Op.lte]: c.eligibilityCutoff } } : {}),
        ...(c.departmentIds?.length ? { departmentId: c.departmentIds } : {}),
      },
    });
  }

  private async createReviews(auth: AuthContext, c: PerformanceCycle, employees: Employee[], transaction: Transaction) {
    const managers = new Map((await Employee.findAll({ where: { id: employees.map((e) => e.managerId).filter((x): x is string => !!x), status: ['ACTIVE', 'ON_NOTICE'] }, attributes: ['id'], transaction })).map((m) => [m.id, m]));
    await PerformanceReview.bulkCreate(
      employees.map((e) => ({ organizationId: auth.organizationId!, cycleId: c.id, employeeId: e.id, reviewerId: e.managerId && managers.has(e.managerId) && e.managerId !== e.id ? e.managerId : null })),
      { transaction },
    );
    const reviews = await PerformanceReview.findAll({ where: { cycleId: c.id, employeeId: employees.map((e) => e.id) }, attributes: ['id', 'employeeId'], transaction });
    const users = await userIdsOf(employees.map((e) => e.id), transaction);
    for (const r of reviews) {
      const userId = users.get(r.employeeId);
      if (userId) {
        await this.notifications.notify(
          userId,
          { organizationId: auth.organizationId, type: 'performance.review', title: `${c.name} has started: set your goals`, body: c.goalsDue ? `Goals are due by ${c.goalsDue}.` : undefined, link: `/me/performance/reviews/${r.id}` },
          transaction,
        );
      }
    }
  }

  private validate(dto: CycleDto, forLaunch = false) {
    const issues: { field: string; message: string }[] = [];
    if (dto.periodEnd <= dto.periodStart) issues.push({ field: 'periodEnd', message: 'The period must end after it starts' });
    for (const f of ['goalsDue', 'selfReviewDue', 'managerReviewDue'] as const) {
      if (dto[f] && dto[f]! < dto.periodStart) issues.push({ field: f, message: "Due dates can't be before the period starts" });
    }
    if (dto.selfReviewDue && dto.managerReviewDue && dto.managerReviewDue < dto.selfReviewDue) issues.push({ field: 'managerReviewDue', message: 'Manager reviews are due after self-reviews' });
    const keys = (dto.competencies ?? []).map((k) => k.key);
    if (new Set(keys).size !== keys.length) issues.push({ field: 'competencies', message: 'Each competency needs a different key' });
    const weight = dto.goalsWeight ?? 70;
    if (forLaunch && weight < 100 && !keys.length) issues.push({ field: 'competencies', message: `Add competencies, or count goals for 100% of the score (they count for ${weight}% now)` });
    if (issues.length) throw AppError.validation(issues);
  }

  private emptyStages(): Record<ReviewStage, number> {
    return Object.fromEntries(REVIEW_STAGES.map((s) => [s, 0])) as Record<ReviewStage, number>;
  }

  private async stageCounts(cycleIds: string[]): Promise<Map<string, Record<ReviewStage, number>>> {
    const out = new Map<string, Record<ReviewStage, number>>();
    if (!cycleIds.length) return out;
    const rows = (await PerformanceReview.findAll({
      where: { cycleId: cycleIds },
      attributes: ['cycleId', 'stage', [fn('COUNT', col('id')), 'count']],
      group: ['cycleId', 'stage'],
      raw: true,
    })) as unknown as { cycleId: string; stage: ReviewStage; count: string }[];
    for (const r of rows) {
      const m = out.get(r.cycleId) ?? this.emptyStages();
      m[r.stage] = Number(r.count);
      out.set(r.cycleId, m);
    }
    return out;
  }
}
