import { Injectable } from '@nestjs/common';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { OKR_MAX_KEY_RESULTS, type OkrLevel, type OkrMetric } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { Department, Employee, OkrCheckIn, OkrKeyResult, OkrObjective, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { KeyResultDto, ObjectiveDto, OkrCheckInDto, OkrQueryDto, UpdateKeyResultDto, UpdateObjectiveDto } from './dto/performance.dto';
import { fullName, organizationToday, personRef, userIdsOf } from './performance-people';

const LEVEL_RANK: Record<OkrLevel, number> = { COMPANY: 0, DEPARTMENT: 1, INDIVIDUAL: 2 };
const OWNER_ATTRS = ['id', 'employeeCode', 'firstName', 'lastName', 'managerId', 'departmentId'];
const MAX_LISTED = 500;

/** Progress (0–100) of a key result from start towards target; milestones are done or not. */
export function keyResultProgress(kr: { metric: OkrMetric; startValue: number; targetValue: number; currentValue: number }): number {
  if (kr.metric === 'MILESTONE') return kr.currentValue >= kr.targetValue ? 100 : 0;
  const span = kr.targetValue - kr.startValue;
  if (span === 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((kr.currentValue - kr.startValue) / span) * 100)));
}

/** Weighted progress of an objective's key results. */
export function objectiveProgress(krs: { metric: OkrMetric; startValue: number; targetValue: number; currentValue: number; weight: number }[]): number {
  const total = krs.reduce((s, k) => s + k.weight, 0);
  if (!total) return 0;
  return Math.round(krs.reduce((s, k) => s + keyResultProgress(k) * k.weight, 0) / total);
}

const num = (v: string | number | null | undefined) => Number(v ?? 0);

/**
 * OKRs: company objectives (organization-wide `performance.okr.manage`), department objectives (that permission for
 * the department) and individual ones (the owner, or whoever reviews them). Objectives align to a parent, key
 * results carry the measurable targets, and check-ins move them, keeping the objective's progress and health current.
 * Everyone in the organization can see the OKRs.
 */
@Injectable()
export class OkrsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(auth: AuthContext, query: OkrQueryDto) {
    const date = query.date ?? (await organizationToday(auth.organizationId!));
    const where: WhereOptions = {
      periodStart: { [Op.lte]: date },
      periodEnd: { [Op.gte]: date },
      ...(query.level ? { level: query.level } : {}),
      ...(query.ownerEmployeeId ? { ownerEmployeeId: query.ownerEmployeeId } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.status ? { status: query.status } : { status: { [Op.ne]: 'DROPPED' } }),
    };
    const rows = await OkrObjective.findAll({
      where,
      include: [{ model: Employee, as: 'owner', attributes: OWNER_ATTRS }, { model: OkrKeyResult }],
      order: [['level', 'ASC'], ['createdAt', 'ASC'], [{ model: OkrKeyResult, as: 'keyResults' }, 'sortOrder', 'ASC']],
      limit: MAX_LISTED,
    });
    const ctx = await this.context(auth, rows);
    const objectives = await Promise.all(rows.map(async (o) => ({ ...this.present(o, ctx), canEdit: await this.canEdit(auth, o, ctx.self) })));
    const active = objectives.filter((o) => o.status === 'ACTIVE');
    return {
      date,
      selfEmployeeId: ctx.self?.id ?? null,
      objectives,
      summary: {
        total: objectives.length,
        averageProgress: active.length ? Math.round(active.reduce((s, o) => s + o.progress, 0) / active.length) : 0,
        onTrack: active.filter((o) => o.health === 'ON_TRACK').length,
        atRisk: active.filter((o) => o.health === 'AT_RISK').length,
        offTrack: active.filter((o) => o.health === 'OFF_TRACK').length,
        noCheckIn: active.filter((o) => !o.health).length,
      },
      can: await this.creatable(auth),
    };
  }

  async get(auth: AuthContext, id: string) {
    const o = await this.find(id);
    const [children, checkIns] = await Promise.all([
      OkrObjective.findAll({ where: { parentId: id, status: { [Op.ne]: 'DROPPED' } }, include: [{ model: Employee, as: 'owner', attributes: OWNER_ATTRS }], order: [['createdAt', 'ASC']] }),
      o.keyResults!.length
        ? OkrCheckIn.findAll({ where: { keyResultId: o.keyResults!.map((k) => k.id) }, order: [['createdAt', 'DESC']], limit: 200 })
        : Promise.resolve([] as OkrCheckIn[]),
    ]);
    const parent = o.parentId ? await OkrObjective.findByPk(o.parentId, { attributes: ['id', 'title', 'level', 'progress', 'health', 'status'] }) : null;
    const ctx = await this.context(auth, [o, ...children]);
    const names = await this.userNames(checkIns.map((c) => c.createdById));
    const byKr = new Map<string, OkrCheckIn[]>();
    for (const c of checkIns) byKr.set(c.keyResultId, [...(byKr.get(c.keyResultId) ?? []), c]);
    const base = this.present(o, ctx);
    return {
      ...base,
      keyResults: base.keyResults.map((k) => ({
        ...k,
        checkIns: (byKr.get(k.id) ?? []).slice(0, 20).map((c) => ({ id: c.id, value: num(c.value), health: c.health, note: c.note, by: c.createdById ? (names.get(c.createdById) ?? null) : null, createdAt: c.createdAt })),
      })),
      parent: parent ? { id: parent.id, title: parent.title, level: parent.level, progress: parent.progress, health: parent.health, status: parent.status } : null,
      children: children.map((c) => this.present(c, ctx)),
      canEdit: await this.canEdit(auth, o, ctx.self),
    };
  }

  async create(auth: AuthContext, dto: ObjectiveDto) {
    const self = await this.scope.self(auth);
    let ownerEmployeeId: string | null = null;
    let departmentId: string | null = null;
    if (dto.level === 'INDIVIDUAL') {
      ownerEmployeeId = dto.ownerEmployeeId ?? self?.id ?? null;
      if (!ownerEmployeeId) throw AppError.validation([{ field: 'ownerEmployeeId', message: 'Choose whose objective this is' }]);
    } else if (dto.level === 'DEPARTMENT') {
      departmentId = dto.departmentId ?? null;
      if (!departmentId) throw AppError.validation([{ field: 'departmentId', message: 'Choose the department' }]);
      if (!(await Department.count({ where: { id: departmentId } }))) throw AppError.validation([{ field: 'departmentId', message: 'Department not found' }]);
      ownerEmployeeId = dto.ownerEmployeeId ?? null;
    } else {
      ownerEmployeeId = dto.ownerEmployeeId ?? null;
    }
    const owner = ownerEmployeeId ? await Employee.findOne({ where: { id: ownerEmployeeId, status: ['ACTIVE', 'ON_NOTICE'] }, attributes: OWNER_ATTRS }) : null;
    if (ownerEmployeeId && !owner) throw AppError.validation([{ field: 'ownerEmployeeId', message: 'Choose an active employee' }]);
    const draft = { level: dto.level, ownerEmployeeId, departmentId, owner } as unknown as OkrObjective;
    if (!(await this.canEdit(auth, draft, self))) {
      throw AppError.forbidden(
        dto.level === 'COMPANY' ? 'Only people who manage OKRs for the organization can set company objectives' : dto.level === 'DEPARTMENT' ? "You can't set objectives for this department" : "You can't set objectives for this person",
      );
    }
    this.validatePeriod(dto.periodStart, dto.periodEnd);
    if (dto.parentId) await this.validateParent(null, dto.level, dto.parentId, dto.periodStart, dto.periodEnd);
    const krs = (dto.keyResults ?? []).map((k, i) => this.keyResultValues(k, i));
    const created = await this.db.transaction(async (transaction) => {
      const o = await OkrObjective.create(
        {
          organizationId: auth.organizationId!,
          title: dto.title,
          description: dto.description ?? null,
          level: dto.level,
          ownerEmployeeId,
          departmentId,
          parentId: dto.parentId ?? null,
          periodStart: dto.periodStart,
          periodEnd: dto.periodEnd,
          createdById: auth.userId,
          updatedById: auth.userId,
        },
        { transaction },
      );
      if (krs.length) await OkrKeyResult.bulkCreate(krs.map((k) => ({ ...k, organizationId: auth.organizationId!, objectiveId: o.id })), { transaction });
      await this.recompute(o.id, transaction);
      await this.audit.record({ action: 'performance.okr_created', entityType: 'OkrObjective', entityId: o.id, summary: `${this.levelName(dto.level)} objective "${dto.title}" set (${dto.periodStart} to ${dto.periodEnd})` }, transaction);
      if (owner && owner.id !== self?.id) {
        const userId = (await userIdsOf([owner.id], transaction)).get(owner.id);
        if (userId) await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'performance.okr', title: `A new objective was set for you: ${dto.title}`, link: `/me/performance/okrs?objective=${o.id}` }, transaction);
      }
      return o;
    });
    return this.get(auth, created.id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateObjectiveDto) {
    const o = await this.editable(auth, id, false);
    const periodStart = dto.periodStart ?? o.periodStart;
    const periodEnd = dto.periodEnd ?? o.periodEnd;
    this.validatePeriod(periodStart, periodEnd);
    const parentId = dto.parentId !== undefined ? dto.parentId : o.parentId;
    if (parentId && (dto.parentId !== undefined || dto.periodStart || dto.periodEnd)) await this.validateParent(id, o.level, parentId, periodStart, periodEnd);
    await this.db.transaction(async (transaction) => {
      await o.update(
        {
          ...(dto.title ? { title: dto.title } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
          periodStart,
          periodEnd,
          ...(dto.status ? { status: dto.status } : {}),
          updatedById: auth.userId,
        },
        { transaction },
      );
      await this.audit.record(
        { action: 'performance.okr_updated', entityType: 'OkrObjective', entityId: id, summary: dto.status && dto.status !== 'ACTIVE' ? `Objective "${o.title}" ${dto.status === 'CLOSED' ? 'closed' : 'dropped'}` : `Objective "${o.title}" updated` },
        transaction,
      );
    });
    return this.get(auth, id);
  }

  async remove(auth: AuthContext, id: string) {
    const o = await this.editable(auth, id, false);
    await this.db.transaction(async (transaction) => {
      await OkrObjective.update({ parentId: null }, { where: { parentId: id }, transaction });
      await o.destroy({ transaction });
      await this.audit.record({ action: 'performance.okr_deleted', entityType: 'OkrObjective', entityId: id, summary: `Objective "${o.title}" deleted` }, transaction);
    });
    return { deleted: true };
  }

  async addKeyResult(auth: AuthContext, id: string, dto: KeyResultDto) {
    const o = await this.editable(auth, id);
    if (o.keyResults!.length >= OKR_MAX_KEY_RESULTS) throw AppError.conflict(`An objective can have up to ${OKR_MAX_KEY_RESULTS} key results`);
    const values = this.keyResultValues(dto, o.keyResults!.length ? Math.max(...o.keyResults!.map((k) => k.sortOrder)) + 1 : 0);
    await this.db.transaction(async (transaction) => {
      await OkrKeyResult.create({ ...values, organizationId: auth.organizationId!, objectiveId: id }, { transaction });
      await this.recompute(id, transaction);
      await this.audit.record({ action: 'performance.okr_key_result_added', entityType: 'OkrObjective', entityId: id, summary: `Key result "${dto.title}" added to "${o.title}"` }, transaction);
    });
    return this.get(auth, id);
  }

  async updateKeyResult(auth: AuthContext, krId: string, dto: UpdateKeyResultDto) {
    const kr = await this.keyResult(krId);
    const o = await this.editable(auth, kr.objectiveId);
    const metric = dto.metric ?? kr.metric;
    const merged: KeyResultDto = {
      title: dto.title ?? kr.title,
      metric,
      startValue: dto.startValue ?? num(kr.startValue),
      targetValue: dto.targetValue ?? num(kr.targetValue),
      unit: dto.unit !== undefined ? dto.unit : kr.unit,
      weight: dto.weight ?? kr.weight,
    };
    const values = this.keyResultValues(merged, kr.sortOrder);
    await this.db.transaction(async (transaction) => {
      await kr.update({ title: values.title, metric: values.metric, startValue: values.startValue, targetValue: values.targetValue, unit: values.unit, weight: values.weight }, { transaction });
      await this.recompute(o.id, transaction);
      await this.audit.record({ action: 'performance.okr_key_result_updated', entityType: 'OkrObjective', entityId: o.id, summary: `Key result "${values.title}" updated` }, transaction);
    });
    return this.get(auth, o.id);
  }

  async removeKeyResult(auth: AuthContext, krId: string) {
    const kr = await this.keyResult(krId);
    const o = await this.editable(auth, kr.objectiveId);
    await this.db.transaction(async (transaction) => {
      await kr.destroy({ transaction });
      await this.recompute(o.id, transaction);
      await this.audit.record({ action: 'performance.okr_key_result_removed', entityType: 'OkrObjective', entityId: o.id, summary: `Key result "${kr.title}" removed from "${o.title}"` }, transaction);
    });
    return this.get(auth, o.id);
  }

  async checkIn(auth: AuthContext, krId: string, dto: OkrCheckInDto) {
    const kr = await this.keyResult(krId);
    const o = await this.editable(auth, kr.objectiveId);
    if (kr.metric === 'MILESTONE' && dto.value !== 0 && dto.value !== 1) throw AppError.validation([{ field: 'value', message: 'A milestone is either done (1) or not yet (0)' }]);
    await this.db.transaction(async (transaction) => {
      await OkrCheckIn.create({ organizationId: auth.organizationId!, keyResultId: kr.id, value: String(dto.value), health: dto.health, note: dto.note ?? null, createdById: auth.userId }, { transaction });
      await kr.update({ currentValue: String(dto.value), lastCheckInAt: new Date() }, { transaction });
      await this.recompute(o.id, transaction, dto.health);
      await this.audit.record(
        { action: 'performance.okr_check_in', entityType: 'OkrObjective', entityId: o.id, summary: `Check-in on "${kr.title}": ${dto.value}${kr.unit ? ` ${kr.unit}` : ''} (${dto.health.toLowerCase().replace('_', ' ')})` },
        transaction,
      );
      const self = await this.scope.self(auth);
      if (o.ownerEmployeeId && o.ownerEmployeeId !== self?.id) {
        const userId = (await userIdsOf([o.ownerEmployeeId], transaction)).get(o.ownerEmployeeId);
        if (userId) await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'performance.okr', title: `Check-in on "${kr.title}" (${o.title})`, body: dto.note ?? undefined, link: `/me/performance/okrs?objective=${o.id}` }, transaction);
      }
    });
    return this.get(auth, o.id);
  }

  /** Objectives the caller could align a new objective to (active, overlapping the period). */
  async parents(auth: AuthContext, level: OkrLevel, periodStart: string, periodEnd: string) {
    const rows = await OkrObjective.findAll({
      where: { status: 'ACTIVE', level: Object.keys(LEVEL_RANK).filter((l) => LEVEL_RANK[l as OkrLevel] <= LEVEL_RANK[level]), periodStart: { [Op.lte]: periodEnd }, periodEnd: { [Op.gte]: periodStart } },
      attributes: ['id', 'title', 'level', 'departmentId', 'ownerEmployeeId'],
      order: [['level', 'ASC'], ['title', 'ASC']],
      limit: 200,
    });
    return rows.map((r) => ({ id: r.id, title: r.title, level: r.level }));
  }

  // ---- internals -------------------------------------------------------------------------------

  /** Keeps the objective's progress (weighted key results) and health (latest check-in) current. */
  private async recompute(id: string, transaction: Transaction, health?: OkrObjective['health']) {
    const o = await OkrObjective.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!o) return;
    const krs = await OkrKeyResult.findAll({ where: { objectiveId: id }, transaction });
    const progress = objectiveProgress(krs.map((k) => ({ metric: k.metric, startValue: num(k.startValue), targetValue: num(k.targetValue), currentValue: num(k.currentValue), weight: k.weight })));
    await o.update({ progress, ...(health ? { health } : {}) }, { transaction });
  }

  private keyResultValues(dto: KeyResultDto, sortOrder: number) {
    const milestone = dto.metric === 'MILESTONE';
    const startValue = milestone ? 0 : (dto.startValue ?? 0);
    const targetValue = milestone ? 1 : dto.targetValue;
    if (targetValue === undefined || targetValue === null) throw AppError.validation([{ field: 'targetValue', message: 'Set the target' }]);
    if (targetValue === startValue) throw AppError.validation([{ field: 'targetValue', message: 'The target must differ from the starting value' }]);
    return {
      title: dto.title,
      metric: dto.metric,
      startValue: String(startValue),
      targetValue: String(targetValue),
      currentValue: String(startValue),
      unit: milestone ? null : dto.metric === 'PERCENT' ? '%' : (dto.unit ?? null),
      weight: dto.weight ?? 1,
      sortOrder,
    };
  }

  private validatePeriod(start: string, end: string) {
    if (end < start) throw AppError.validation([{ field: 'periodEnd', message: 'The period must end after it starts' }]);
  }

  private async validateParent(selfId: string | null, level: OkrLevel, parentId: string, start: string, end: string) {
    if (parentId === selfId) throw AppError.validation([{ field: 'parentId', message: "An objective can't support itself" }]);
    const parent = await OkrObjective.findByPk(parentId, { attributes: ['id', 'level', 'status', 'periodStart', 'periodEnd', 'parentId'] });
    if (!parent) throw AppError.validation([{ field: 'parentId', message: 'The parent objective was not found' }]);
    if (parent.status === 'DROPPED') throw AppError.validation([{ field: 'parentId', message: 'The parent objective was dropped' }]);
    if (LEVEL_RANK[parent.level] > LEVEL_RANK[level]) throw AppError.validation([{ field: 'parentId', message: `A ${level.toLowerCase()} objective can't support an ${parent.level.toLowerCase()} one` }]);
    if (parent.periodStart > end || parent.periodEnd < start) throw AppError.validation([{ field: 'parentId', message: "The parent objective's period doesn't overlap this one" }]);
    if (selfId) {
      let cursor: string | null = parent.parentId;
      for (let depth = 0; cursor && depth < 50; depth++) {
        if (cursor === selfId) throw AppError.validation([{ field: 'parentId', message: 'That would make the objectives support each other in a loop' }]);
        cursor = (await OkrObjective.findByPk(cursor, { attributes: ['parentId'] }))?.parentId ?? null;
      }
    }
  }

  private async find(id: string) {
    const o = await OkrObjective.findByPk(id, {
      include: [{ model: Employee, as: 'owner', attributes: OWNER_ATTRS }, { model: OkrKeyResult }],
      order: [[{ model: OkrKeyResult, as: 'keyResults' }, 'sortOrder', 'ASC']],
    });
    if (!o) throw AppError.notFound('Objective');
    return o;
  }

  private async keyResult(id: string) {
    const kr = await OkrKeyResult.findByPk(id);
    if (!kr) throw AppError.notFound('Key result');
    return kr;
  }

  private async editable(auth: AuthContext, id: string, requireActive = true) {
    const o = await this.find(id);
    if (!(await this.canEdit(auth, o, await this.scope.self(auth)))) throw AppError.forbidden("You can't change this objective");
    if (requireActive && o.status !== 'ACTIVE') throw AppError.conflict(`This objective is ${o.status.toLowerCase()}`);
    return o;
  }

  private async canEdit(auth: AuthContext, o: Pick<OkrObjective, 'level' | 'departmentId' | 'ownerEmployeeId' | 'owner'>, self: Employee | null): Promise<boolean> {
    const scope = this.scope.scopeOf(auth, 'performance.okr.manage');
    if (scope === 'ORGANIZATION') return true;
    if (o.level === 'COMPANY') return false;
    if (o.level === 'DEPARTMENT') return !!scope && !!self && self.departmentId === o.departmentId;
    if (!o.ownerEmployeeId) return false;
    if (self?.id === o.ownerEmployeeId) return true;
    const owner = o.owner ?? (await Employee.findByPk(o.ownerEmployeeId, { attributes: OWNER_ATTRS }));
    return !!owner && (await this.scope.covers(auth, 'performance.review', owner));
  }

  private async creatable(auth: AuthContext) {
    const scope = this.scope.scopeOf(auth, 'performance.okr.manage');
    const self = await this.scope.self(auth);
    return {
      company: scope === 'ORGANIZATION',
      department: scope === 'ORGANIZATION' || (!!scope && !!self?.departmentId),
      departmentId: scope && scope !== 'ORGANIZATION' ? (self?.departmentId ?? null) : null,
      individual: !!self || auth.permissions.has('performance.review'),
      forOthers: auth.permissions.has('performance.review') || scope === 'ORGANIZATION',
    };
  }

  private async context(auth: AuthContext, rows: OkrObjective[]) {
    const deptIds = [...new Set(rows.map((r) => r.departmentId ?? r.owner?.departmentId).filter((x): x is string => !!x))];
    const departments = new Map(deptIds.length ? (await Department.findAll({ where: { id: deptIds }, attributes: ['id', 'name'] })).map((d) => [d.id, d.name]) : []);
    return { departments, self: await this.scope.self(auth) };
  }

  private present(o: OkrObjective, ctx: { departments: Map<string, string> }) {
    return {
      id: o.id,
      title: o.title,
      description: o.description,
      level: o.level,
      owner: personRef(o.owner),
      department: o.departmentId ? { id: o.departmentId, name: ctx.departments.get(o.departmentId) ?? null } : null,
      ownerDepartment: o.owner?.departmentId ? (ctx.departments.get(o.owner.departmentId) ?? null) : null,
      parentId: o.parentId,
      periodStart: o.periodStart,
      periodEnd: o.periodEnd,
      status: o.status,
      progress: o.progress,
      health: o.health,
      keyResults: (o.keyResults ?? []).map((k) => {
        const values = { metric: k.metric, startValue: num(k.startValue), targetValue: num(k.targetValue), currentValue: num(k.currentValue) };
        return { id: k.id, title: k.title, ...values, unit: k.unit, weight: k.weight, progress: keyResultProgress(values), lastCheckInAt: k.lastCheckInAt };
      }),
      updatedAt: o.updatedAt,
    };
  }

  private levelName(level: OkrLevel) {
    return level === 'COMPANY' ? 'Company' : level === 'DEPARTMENT' ? 'Department' : 'Individual';
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }
}
