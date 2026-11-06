import { Injectable } from '@nestjs/common';
import { MODULES, type OrganizationStatus } from '../../contracts';
import { Op, col, fn, type Order, type Transaction, type WhereOptions } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta, resolveSort } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { DatabaseService } from '../../database/database.service';
import {
  AuditLog,
  Feature,
  MembershipRole,
  Organization,
  OrganizationFeature,
  OrganizationMembership,
  Plan,
  PlanFeature,
  Role,
  User,
  UserSession,
} from '../../database/models';
import { AuditService, diff } from '../../infrastructure/audit/audit.service';
import { SessionService } from '../auth/session.service';
import { AUDIT_QUERY, auditWhere } from '../audit/audit-logs.service';
import { OrganizationProvisioningService } from '../organizations/organization-provisioning.service';
import { ORGANIZATION_PROFILE_QUERY, pickProfile, type ProfileUpdate } from '../organizations/organizations.service';
import { AccessService } from '../rbac/access.service';
import { InvitationService } from '../users/invitation.service';
import {
  CreatePlanDto,
  CreatePlatformOrganizationDto,
  PlatformAuditQueryDto,
  PlatformOrganizationQueryDto,
  SetFeatureOverridesDto,
  UpdatePlanDto,
  UpdatePlatformOrganizationDto,
} from './dto/platform.dto';

/** Super Admin operations span tenants by design; every endpoint is protected by platform permissions. */
const PLATFORM = { skipTenantScope: true } as const;

const PLAN_ATTRIBUTES = ['id', 'code', 'name', 'description', 'isActive', 'maxUsers', 'monthlyPrice', 'currency', 'sortOrder', 'createdAt', 'updatedAt'];

function toPlan(plan: Plan, organizationCount: number) {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    isActive: plan.isActive,
    maxUsers: plan.maxUsers,
    monthlyPrice: plan.monthlyPrice === null || plan.monthlyPrice === undefined ? null : Number(plan.monthlyPrice),
    currency: plan.currency,
    sortOrder: plan.sortOrder,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    featureKeys: (plan.features ?? []).map((f) => f.feature!.key),
    organizationCount,
  };
}

async function countGrouped<K extends string>(rows: Promise<unknown>, key: K): Promise<Map<string, number>> {
  const list = (await rows) as (Record<K, string> & { count: string })[];
  return new Map(list.map((r) => [r[key], Number(r.count)]));
}

@Injectable()
export class PlatformService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly provisioning: OrganizationProvisioningService,
    private readonly invitations: InvitationService,
    private readonly sessions: SessionService,
    private readonly access: AccessService,
  ) {}

  // ── Dashboard ────────────────────────────────────────────────────────────

  async dashboard() {
    const since = new Date(Date.now() - 13 * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const [byStatus, plans, orgsByPlan, users, activeSessions, recent, logins] = await Promise.all([
      countGrouped(Organization.findAll({ attributes: ['status', [fn('COUNT', col('id')), 'count']], group: ['status'], raw: true }), 'status'),
      Plan.findAll({ order: [['sortOrder', 'ASC']], attributes: ['id', 'code', 'name'] }),
      countGrouped(Organization.findAll({ attributes: ['planId', [fn('COUNT', col('id')), 'count']], group: ['planId'], raw: true }), 'planId'),
      User.count({ where: { status: 'ACTIVE' } }),
      UserSession.count({ where: { revokedAt: null, expiresAt: { [Op.gt]: new Date() } } }),
      Organization.findAll({
        order: [['createdAt', 'DESC']],
        limit: 5,
        attributes: ['id', 'name', 'status', 'createdAt'],
        include: [{ model: Plan, attributes: ['name'] }],
      }),
      this.db.select<{ day: string; outcome: string; count: number }>(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, outcome::text AS outcome, count(*)::int AS count
         FROM login_events WHERE created_at >= :since GROUP BY 1, 2 ORDER BY 1`,
        { since },
      ),
    ]);
    const total = [...byStatus.values()].reduce((a, b) => a + b, 0);
    return {
      organizations: {
        total,
        active: byStatus.get('ACTIVE') ?? 0,
        pending: byStatus.get('PENDING') ?? 0,
        suspended: byStatus.get('SUSPENDED') ?? 0,
        deactivated: byStatus.get('DEACTIVATED') ?? 0,
      },
      plans: plans.map((p) => ({ code: p.code, name: p.name, organizations: orgsByPlan.get(p.id) ?? 0 })),
      activeUsers: users,
      activeSessions,
      recentOrganizations: recent,
      loginActivity: logins,
    };
  }

  // ── Organizations ────────────────────────────────────────────────────────

  async listOrganizations(q: PlatformOrganizationQueryDto) {
    const where: WhereOptions<Organization> = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.planId ? { planId: q.planId } : {}),
      ...(q.search
        ? { [Op.or]: ['name', 'slug', 'email'].map((f) => ({ [f]: { [Op.iLike]: containsPattern(q.search!) } })) }
        : {}),
    };
    const order = resolveSort<Order>(
      q.sort,
      { name: (d) => [['name', d]], createdAt: (d) => [['createdAt', d]], status: (d) => [['status', d]] },
      [['createdAt', 'DESC']],
    );
    const { rows, count } = await Organization.findAndCountAll({
      where,
      order,
      ...paginationArgs(q),
      attributes: ['id', 'name', 'slug', 'status', 'country', 'createdAt', 'suspendedAt'],
      include: [{ model: Plan, attributes: ['id', 'code', 'name'] }],
    });
    const userCounts = await countGrouped(
      OrganizationMembership.findAll({
        attributes: ['organizationId', [fn('COUNT', col('id')), 'count']],
        where: { organizationId: { [Op.in]: rows.map((r) => r.id) }, status: { [Op.in]: ['ACTIVE', 'INVITED'] } },
        group: ['organizationId'],
        raw: true,
        ...PLATFORM,
      }),
      'organizationId',
    );
    return new PaginatedResult(
      rows.map((o) => ({ ...o.get({ plain: true }), userCount: userCounts.get(o.id) ?? 0 })),
      paginationMeta(q, count),
    );
  }

  async getOrganization(id: string) {
    const org = await Organization.findByPk(id, ORGANIZATION_PROFILE_QUERY);
    if (!org) throw AppError.notFound('Organization');
    const [overrides, members, admins, entitled] = await Promise.all([
      OrganizationFeature.findAll({
        where: { organizationId: id },
        attributes: ['enabled', 'reason', 'updatedAt'],
        include: [{ model: Feature, attributes: ['key'] }],
        ...PLATFORM,
      }),
      countGrouped(
        OrganizationMembership.findAll({
          attributes: ['status', [fn('COUNT', col('id')), 'count']],
          where: { organizationId: id },
          group: ['status'],
          raw: true,
          ...PLATFORM,
        }),
        'status',
      ),
      OrganizationMembership.findAll({
        where: { organizationId: id },
        attributes: ['id', 'status'],
        include: [
          { model: User, attributes: ['email', 'firstName', 'lastName', 'lastLoginAt'] },
          { model: MembershipRole, attributes: [], required: true, include: [{ model: Role, attributes: [], where: { key: 'org_admin' }, required: true }] },
        ],
        ...PLATFORM,
      }),
      this.access.entitlements(id),
    ]);
    return {
      ...org.get({ plain: true }),
      members: Object.fromEntries(members),
      admins: admins.map((a) => ({
        membershipId: a.id,
        status: a.status,
        email: a.user!.email,
        firstName: a.user!.firstName,
        lastName: a.user!.lastName,
        lastLoginAt: a.user!.lastLoginAt,
      })),
      featureOverrides: overrides.map((o) => ({ featureKey: o.feature!.key, enabled: o.enabled, reason: o.reason, updatedAt: o.updatedAt })),
      modules: MODULES.map((m) => ({ key: m.key, name: m.name, core: m.core, entitled: entitled.has(m.key) })),
    };
  }

  async createOrganization(auth: AuthContext, dto: CreatePlatformOrganizationDto) {
    const existingUser = await User.findOne({ where: { email: dto.admin.email } });
    if (existingUser && existingUser.status !== 'ACTIVE') throw AppError.conflict('The admin account is disabled');

    const { organizationId, membershipId, raw } = await this.db.transaction(async (transaction) => {
      const { organization, roleIdsByKey } = await this.provisioning.provision(transaction, {
        name: dto.name,
        planId: dto.planId,
        status: 'ACTIVE',
        createdById: auth.userId,
      });
      const profile = pickProfile(dto);
      delete profile.name;
      if (Object.keys(profile).length) await organization.update(profile, { transaction });

      const admin =
        existingUser ??
        (await User.create(
          { email: dto.admin.email, firstName: dto.admin.firstName, lastName: dto.admin.lastName, createdById: auth.userId, updatedById: auth.userId },
          { transaction },
        ));
      const membership = await OrganizationMembership.create(
        { organizationId: organization.id, userId: admin.id, status: 'INVITED', invitedAt: new Date(), createdById: auth.userId, updatedById: auth.userId },
        { transaction, ...PLATFORM },
      );
      await MembershipRole.create(
        { organizationId: organization.id, membershipId: membership.id, roleId: roleIdsByKey.get('org_admin')!, assignedById: auth.userId },
        { transaction, ...PLATFORM },
      );
      const token = await this.invitations.issueToken(admin.id, organization.id, auth.userId, transaction);
      await this.audit.record(
        { action: 'platform.organization_created', entityType: 'Organization', entityId: organization.id, organizationId: organization.id, summary: `Organization "${organization.name}" created; admin ${dto.admin.email} invited` },
        transaction,
      );
      return { organizationId: organization.id, membershipId: membership.id, raw: token };
    });

    const inviter = await User.findByPk(auth.userId, { attributes: ['firstName', 'lastName'], rejectOnEmpty: true });
    await this.invitations.send({
      email: dto.admin.email,
      firstName: existingUser?.firstName ?? dto.admin.firstName,
      organizationName: dto.name,
      inviterName: `${inviter.firstName} ${inviter.lastName}`,
      rawToken: raw,
    });
    return { ...(await this.getOrganization(organizationId)), initialAdminMembershipId: membershipId };
  }

  async resendAdminInvitation(auth: AuthContext, organizationId: string, membershipId: string) {
    const membership = await OrganizationMembership.findOne({
      where: { id: membershipId, organizationId, status: 'INVITED' },
      include: [{ model: User }, { model: Organization, attributes: ['name'] }],
      ...PLATFORM,
    });
    if (!membership) throw AppError.notFound('Pending invitation');
    const raw = await this.invitations.issueToken(membership.userId, organizationId, auth.userId);
    const inviter = await User.findByPk(auth.userId, { attributes: ['firstName', 'lastName'], rejectOnEmpty: true });
    await this.invitations.send({
      email: membership.user!.email,
      firstName: membership.user!.firstName,
      organizationName: membership.organization!.name,
      inviterName: `${inviter.firstName} ${inviter.lastName}`,
      rawToken: raw,
    });
    await this.audit.record({ action: 'platform.admin_invitation_resent', entityType: 'OrganizationMembership', entityId: membershipId, organizationId });
    return { resent: true };
  }

  async updateOrganization(auth: AuthContext, id: string, dto: UpdatePlatformOrganizationDto) {
    const org = await Organization.findByPk(id);
    if (!org) throw AppError.notFound('Organization');
    if (dto.planId && !(await Plan.findByPk(dto.planId))) {
      throw AppError.validation([{ field: 'planId', message: 'Plan does not exist' }]);
    }
    const before = org.get({ plain: true, clone: true });
    const data: ProfileUpdate & { planId?: string } = { ...pickProfile(dto), ...(dto.planId ? { planId: dto.planId } : {}) };
    await this.db.transaction(async (transaction) => {
      await org.update({ ...data, updatedById: auth.userId }, { transaction });
      await this.audit.record(
        { action: 'platform.organization_updated', entityType: 'Organization', entityId: id, organizationId: id, changes: diff(before, data as Record<string, unknown>) },
        transaction,
      );
    });
    return this.getOrganization(id);
  }

  async changeStatus(auth: AuthContext, id: string, status: OrganizationStatus, reason?: string) {
    const org = await Organization.findByPk(id);
    if (!org) throw AppError.notFound('Organization');
    if (org.status === status) throw AppError.conflict(`Organization is already ${status.toLowerCase()}`);
    const allowed: Record<OrganizationStatus, OrganizationStatus[]> = {
      PENDING: ['ACTIVE', 'DEACTIVATED'],
      ACTIVE: ['SUSPENDED', 'DEACTIVATED'],
      SUSPENDED: ['ACTIVE', 'DEACTIVATED'],
      DEACTIVATED: ['ACTIVE'],
    };
    const previous = org.status as OrganizationStatus;
    if (!allowed[previous].includes(status)) throw AppError.conflict(`Cannot change status from ${previous} to ${status}`);

    const now = new Date();
    await this.db.transaction(async (transaction) => {
      await org.update(
        {
          status,
          updatedById: auth.userId,
          ...(status === 'ACTIVE' ? { activatedAt: org.activatedAt ?? now, suspendedAt: null, suspensionReason: null } : {}),
          ...(status === 'SUSPENDED' || status === 'DEACTIVATED' ? { suspendedAt: now, suspensionReason: reason ?? null } : {}),
        },
        { transaction },
      );
      await this.audit.record(
        {
          action: `platform.organization_${status.toLowerCase()}`,
          entityType: 'Organization',
          entityId: id,
          organizationId: id,
          summary: reason ? `${status}: ${reason}` : status,
          changes: { status: { from: previous, to: status } },
        },
        transaction,
      );
    });
    if (status !== 'ACTIVE') await this.sessions.revokeAllInOrganization(id, `organization_${status.toLowerCase()}`);
    return this.getOrganization(id);
  }

  async setFeatureOverrides(auth: AuthContext, id: string, dto: SetFeatureOverridesDto) {
    await this.getOrganization(id);
    const featureIds = new Map((await Feature.findAll({ attributes: ['id', 'key'] })).map((f) => [f.key, f.id]));
    await this.db.transaction(async (transaction) => {
      for (const o of dto.overrides) {
        const featureId = featureIds.get(o.featureKey)!;
        const existing = await OrganizationFeature.findOne({ where: { organizationId: id, featureId }, transaction, ...PLATFORM });
        if (o.enabled === null) {
          if (existing) await existing.destroy({ transaction, ...PLATFORM });
        } else if (existing) {
          await existing.update({ enabled: o.enabled, reason: o.reason ?? null, updatedById: auth.userId }, { transaction, ...PLATFORM });
        } else {
          await OrganizationFeature.create(
            { organizationId: id, featureId, enabled: o.enabled, reason: o.reason ?? null, updatedById: auth.userId },
            { transaction, ...PLATFORM },
          );
        }
      }
      await this.audit.record(
        { action: 'platform.organization_features_updated', entityType: 'Organization', entityId: id, organizationId: id, metadata: { overrides: dto.overrides } },
        transaction,
      );
    });
    return this.getOrganization(id);
  }

  // ── Plans ────────────────────────────────────────────────────────────────

  private planQuery() {
    return {
      attributes: PLAN_ATTRIBUTES,
      include: [{ model: PlanFeature, attributes: ['id'], include: [{ model: Feature, attributes: ['key'] }] }],
    };
  }

  private async organizationCounts(): Promise<Map<string, number>> {
    return countGrouped(Organization.findAll({ attributes: ['planId', [fn('COUNT', col('id')), 'count']], group: ['planId'], raw: true }), 'planId');
  }

  async listPlans() {
    const [plans, counts] = await Promise.all([
      Plan.findAll({ ...this.planQuery(), order: [['sortOrder', 'ASC'], ['name', 'ASC']] }),
      this.organizationCounts(),
    ]);
    return plans.map((p) => toPlan(p, counts.get(p.id) ?? 0));
  }

  async getPlan(id: string) {
    const plan = await Plan.findByPk(id, this.planQuery());
    if (!plan) throw AppError.notFound('Plan');
    return toPlan(plan, (await this.organizationCounts()).get(id) ?? 0);
  }

  async createPlan(auth: AuthContext, dto: CreatePlanDto) {
    const { featureKeys = [], ...data } = dto;
    const plan = await this.db.transaction(async (transaction) => {
      const created = await Plan.create({ ...data, createdById: auth.userId, updatedById: auth.userId }, { transaction });
      await this.replacePlanFeatures(created.id, featureKeys, transaction);
      await this.audit.record(
        { action: 'platform.plan_created', entityType: 'Plan', entityId: created.id, organizationId: null, summary: `Plan "${created.name}" created`, metadata: { featureKeys } },
        transaction,
      );
      return created;
    });
    return this.getPlan(plan.id);
  }

  async updatePlan(auth: AuthContext, id: string, dto: UpdatePlanDto) {
    const plan = await Plan.findByPk(id);
    if (!plan) throw AppError.notFound('Plan');
    const before = { ...plan.get({ plain: true, clone: true }), monthlyPrice: plan.monthlyPrice === null ? null : Number(plan.monthlyPrice) };
    const { featureKeys, ...data } = dto;
    await this.db.transaction(async (transaction) => {
      await plan.update({ ...data, updatedById: auth.userId }, { transaction });
      if (featureKeys) await this.replacePlanFeatures(id, featureKeys, transaction);
      await this.audit.record(
        {
          action: 'platform.plan_updated',
          entityType: 'Plan',
          entityId: id,
          organizationId: null,
          changes: diff(before, data),
          metadata: featureKeys ? { featureKeys } : undefined,
        },
        transaction,
      );
    });
    return this.getPlan(id);
  }

  listFeatures() {
    return Feature.findAll({ order: [['name', 'ASC']], attributes: ['key', 'name', 'description', 'isCore'] });
  }

  // ── Audit ────────────────────────────────────────────────────────────────

  async auditLogs(q: PlatformAuditQueryDto) {
    const { rows, count } = await AuditLog.findAndCountAll({
      attributes: AUDIT_QUERY.attributes,
      include: [...(AUDIT_QUERY.include as []), { model: Organization, attributes: ['id', 'name'] }],
      where: { ...auditWhere(q), ...(q.organizationId ? { organizationId: q.organizationId } : {}) },
      order: [['createdAt', 'DESC']],
      ...paginationArgs(q),
      ...PLATFORM,
    });
    return new PaginatedResult(rows, paginationMeta(q, count));
  }

  private async replacePlanFeatures(planId: string, keys: string[], transaction: Transaction): Promise<void> {
    const features = await Feature.findAll({ where: { key: { [Op.in]: keys } }, attributes: ['id'], transaction });
    await PlanFeature.destroy({ where: { planId }, transaction });
    if (features.length) await PlanFeature.bulkCreate(features.map((f) => ({ planId, featureId: f.id })), { transaction });
  }
}
