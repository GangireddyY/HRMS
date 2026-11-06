import { Injectable } from '@nestjs/common';
import { MODULES } from '../../contracts';
import { Op, fn, col, type FindOptions, type InferAttributes } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { AuditLog, Organization, OrganizationMembership, OrganizationSecurityPolicy, Plan, Role, User, UserSession } from '../../database/models';
import { AuditService, diff } from '../../infrastructure/audit/audit.service';
import { OrganizationProfileDto, UpdateSecurityPolicyDto } from './dto/organization.dto';

const PROFILE_ATTRIBUTES = [
  'id', 'name', 'legalName', 'slug', 'status', 'industry', 'companySize', 'email', 'phone', 'website',
  'registrationNumber', 'taxId', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country',
  'timezone', 'currency', 'locale', 'dateFormat', 'fiscalYearStartMonth', 'logoUrl', 'activatedAt',
  'suspendedAt', 'suspensionReason', 'createdAt', 'updatedAt',
];

/** Organization profile with its plan summary. */
export const ORGANIZATION_PROFILE_QUERY: FindOptions<Organization> = {
  attributes: PROFILE_ATTRIBUTES,
  include: [{ model: Plan, attributes: ['id', 'code', 'name'] }],
};

const PROFILE_FIELDS = [
  'name', 'legalName', 'industry', 'companySize', 'email', 'phone', 'website', 'registrationNumber', 'taxId',
  'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country', 'timezone', 'currency', 'locale',
  'dateFormat', 'fiscalYearStartMonth',
] as const;

export type ProfileUpdate = Partial<Pick<InferAttributes<Organization>, (typeof PROFILE_FIELDS)[number]>>;

export function pickProfile(dto: OrganizationProfileDto): ProfileUpdate {
  const out: Record<string, unknown> = {};
  for (const f of PROFILE_FIELDS) if (dto[f] !== undefined) out[f] = dto[f];
  return out as ProfileUpdate;
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async getCurrent(organizationId: string): Promise<Organization> {
    const org = await Organization.findByPk(organizationId, ORGANIZATION_PROFILE_QUERY);
    if (!org) throw AppError.notFound('Organization');
    return org;
  }

  async updateCurrent(auth: AuthContext, dto: OrganizationProfileDto) {
    const organizationId = auth.organizationId!;
    const org = await this.getCurrent(organizationId);
    const before = org.get({ plain: true, clone: true });
    const data = pickProfile(dto);
    await this.db.transaction(async (transaction) => {
      await Organization.update({ ...data, updatedById: auth.userId }, { where: { id: organizationId }, transaction });
      await this.audit.record({ action: 'organization.updated', entityType: 'Organization', entityId: organizationId, changes: diff(before, data as Record<string, unknown>) }, transaction);
    });
    return this.getCurrent(organizationId);
  }

  async getSecurityPolicy(): Promise<OrganizationSecurityPolicy> {
    const policy = await OrganizationSecurityPolicy.findOne();
    if (!policy) throw AppError.notFound('Security policy');
    return policy;
  }

  async updateSecurityPolicy(auth: AuthContext, dto: UpdateSecurityPolicyDto) {
    const policy = await this.getSecurityPolicy();
    const before = policy.get({ plain: true, clone: true });
    const merged = { ...before, ...dto };
    if (merged.sessionIdleTimeoutMinutes > merged.sessionMaxLifetimeHours * 60) {
      throw AppError.validation([{ field: 'sessionIdleTimeoutMinutes', message: 'Idle timeout cannot exceed the maximum session lifetime' }]);
    }
    await this.db.transaction(async (transaction) => {
      await policy.update({ ...dto, updatedById: auth.userId }, { transaction });
      await this.audit.record(
        { action: 'organization.security_policy_updated', entityType: 'OrganizationSecurityPolicy', entityId: policy.id, changes: diff(before, dto as Record<string, unknown>) },
        transaction,
      );
    });
    return this.getSecurityPolicy();
  }

  async subscription(auth: AuthContext) {
    const org = await Organization.findByPk(auth.organizationId!, {
      attributes: ['id'],
      include: [{ model: Plan, attributes: ['id', 'code', 'name', 'description', 'maxUsers'] }],
      rejectOnEmpty: true,
    });
    const userCount = await OrganizationMembership.count({ where: { status: { [Op.in]: ['ACTIVE', 'INVITED'] } } });
    return {
      plan: org.plan,
      userCount,
      modules: MODULES.map((m) => ({ key: m.key, name: m.name, description: m.description, core: m.core, entitled: auth.features.has(m.key) })),
    };
  }

  async overview(auth: AuthContext) {
    const organizationId = auth.organizationId!;
    const since = new Date(Date.now() - 13 * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);

    const [membersByStatus, roleCount, activeSessions, mfaEnabled, recentActivity, org] = await Promise.all([
      OrganizationMembership.findAll({
        attributes: ['status', [fn('COUNT', col('id')), 'count']],
        group: ['status'],
        raw: true,
      }) as unknown as Promise<{ status: string; count: string }[]>,
      Role.count(),
      UserSession.count({ where: { organizationId, revokedAt: null, expiresAt: { [Op.gt]: new Date() } } }),
      OrganizationMembership.count({ where: { status: 'ACTIVE' }, include: [{ model: User, where: { mfaEnabled: true }, attributes: [] }] }),
      AuditLog.findAll({
        order: [['createdAt', 'DESC']],
        limit: 8,
        attributes: ['id', 'action', 'summary', 'entityType', 'createdAt'],
        include: [{ model: User, as: 'actor', attributes: ['firstName', 'lastName'] }],
      }),
      Organization.findByPk(organizationId, { attributes: ['timezone'], rejectOnEmpty: true }),
    ]);

    const logins = await this.db.select<{ day: string; outcome: string; count: number }>(
      `SELECT to_char(date_trunc('day', created_at AT TIME ZONE :tz), 'YYYY-MM-DD') AS day,
              outcome::text AS outcome,
              count(*)::int AS count
       FROM login_events
       WHERE organization_id = :organizationId AND created_at >= :since
       GROUP BY 1, 2
       ORDER BY 1`,
      { tz: org.timezone, organizationId, since },
    );

    const statusCounts = Object.fromEntries(membersByStatus.map((m) => [m.status, Number(m.count)]));
    const active = statusCounts.ACTIVE ?? 0;
    return {
      members: { active, invited: statusCounts.INVITED ?? 0, suspended: statusCounts.SUSPENDED ?? 0 },
      roles: roleCount,
      activeSessions,
      mfaAdoption: active ? Math.round((mfaEnabled / active) * 100) : 0,
      loginActivity: logins,
      recentActivity,
    };
  }
}
