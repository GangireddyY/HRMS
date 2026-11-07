import { Injectable } from '@nestjs/common';
import { PermissionScope } from '../../contracts';
import { Op, type Includeable, type Order, type WhereOptions } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { PaginationQueryDto, paginationArgs, paginationMeta, resolveSort } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { DatabaseService } from '../../database/database.service';
import { Employee, LoginEvent, MembershipRole, Organization, OrganizationMembership, Permission, Plan, Role, RolePermission, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { SessionService } from '../auth/session.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertNoEscalation } from '../rbac/escalation';
import { InviteUserDto, UserListQueryDto } from './dto/users.dto';
import { InvitationService } from './invitation.service';

const ORG_ADMIN_ROLE = 'org_admin';

const USER_ATTRIBUTES = ['id', 'email', 'firstName', 'lastName', 'phone', 'lastLoginAt', 'mfaEnabled', 'status', 'avatarUrl'];

const MEMBER_INCLUDE: Includeable[] = [
  { model: User, attributes: USER_ATTRIBUTES },
  { model: MembershipRole, attributes: ['id'], include: [{ model: Role, attributes: ['id', 'key', 'name'] }] },
];

function toMember(m: OrganizationMembership) {
  const user = m.user!;
  return {
    id: m.id,
    userId: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    status: m.status,
    accountStatus: user.status,
    mfaEnabled: user.mfaEnabled,
    lastLoginAt: user.lastLoginAt,
    invitedAt: m.invitedAt,
    joinedAt: m.joinedAt,
    suspendedAt: m.suspendedAt,
    createdAt: m.createdAt,
    roles: (m.roles ?? []).map((r) => ({ id: r.role!.id, key: r.role!.key, name: r.role!.name })),
  };
}

/** Organization user (membership) administration. Membership and role models are tenant-scoped automatically. */
@Injectable()
export class UsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly invitations: InvitationService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(query: UserListQueryDto) {
    const where: WhereOptions<OrganizationMembership> = { ...(query.status ? { status: query.status } : {}) };
    if (query.roleId) {
      const holders = await MembershipRole.findAll({ where: { roleId: query.roleId }, attributes: ['membershipId'] });
      Object.assign(where, { id: { [Op.in]: holders.map((h) => h.membershipId) } });
    }
    const userWhere = query.search
      ? { [Op.or]: ['email', 'firstName', 'lastName'].map((f) => ({ [f]: { [Op.iLike]: containsPattern(query.search!) } })) }
      : undefined;
    const order = resolveSort<Order>(
      query.sort,
      {
        name: (d) => [['user', 'firstName', d], ['user', 'lastName', d]],
        email: (d) => [['user', 'email', d]],
        status: (d) => [['status', d]],
        joinedAt: (d) => [['joinedAt', d]],
        createdAt: (d) => [['createdAt', d]],
        lastLoginAt: (d) => [['user', 'lastLoginAt', d]],
      },
      [['createdAt', 'DESC']],
    );

    // Page of ids first (filters + sort on the 1:1 user join), then full rows with their roles.
    const { rows: page, count } = await OrganizationMembership.findAndCountAll({
      where,
      attributes: ['id'],
      include: [{ model: User, attributes: [], where: userWhere, required: true }],
      order,
      ...paginationArgs(query),
    });
    const ids = page.map((p) => p.id);
    const rows = ids.length ? await OrganizationMembership.findAll({ where: { id: { [Op.in]: ids } }, include: MEMBER_INCLUDE }) : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return new PaginatedResult(ids.map((id) => toMember(byId.get(id)!)), paginationMeta(query, count));
  }

  async get(id: string) {
    const m = await OrganizationMembership.findByPk(id, { include: MEMBER_INCLUDE });
    if (!m) throw AppError.notFound('User');
    const employee = await Employee.findOne({ where: { membershipId: id }, attributes: ['id', 'employeeCode'] });
    return { ...toMember(m), employee: employee ? { id: employee.id, employeeCode: employee.employeeCode } : null };
  }

  async invite(auth: AuthContext, dto: InviteUserDto) {
    const organizationId = auth.organizationId!;
    await this.assertWithinPlanLimit(organizationId);
    await this.assertRolesAssignable(auth, dto.roleIds);

    const existingUser = await User.findOne({ where: { email: dto.email } });
    if (existingUser) {
      if (existingUser.status !== 'ACTIVE') throw AppError.conflict('This account is disabled');
      const existing = await OrganizationMembership.findOne({ where: { userId: existingUser.id } });
      if (existing) {
        throw AppError.conflict(existing.status === 'INVITED' ? 'This user has already been invited' : 'This user is already a member');
      }
    }

    let raw = '';
    const membershipId = await this.db.transaction(async (transaction) => {
      const user =
        existingUser ??
        (await User.create(
          { email: dto.email, firstName: dto.firstName, lastName: dto.lastName, createdById: auth.userId, updatedById: auth.userId },
          { transaction },
        ));
      const membership = await OrganizationMembership.create(
        { organizationId, userId: user.id, status: 'INVITED', invitedAt: new Date(), createdById: auth.userId, updatedById: auth.userId },
        { transaction },
      );
      await MembershipRole.bulkCreate(
        [...new Set(dto.roleIds)].map((roleId) => ({ organizationId, membershipId: membership.id, roleId, assignedById: auth.userId })),
        { transaction },
      );
      raw = await this.invitations.issueToken(user.id, organizationId, auth.userId, transaction);
      await this.audit.record(
        { action: 'user.invited', entityType: 'OrganizationMembership', entityId: membership.id, summary: `Invited ${dto.email}`, metadata: { roleIds: dto.roleIds } },
        transaction,
      );
      return membership.id;
    });

    await this.sendInvitation(auth, membershipId, raw);
    return this.get(membershipId);
  }

  async resendInvitation(auth: AuthContext, id: string) {
    const member = await this.get(id);
    if (member.status !== 'INVITED') throw AppError.conflict('Only pending invitations can be resent');
    await this.assertCanManage(auth, id);
    const raw = await this.db.transaction(async (transaction) => {
      const token = await this.invitations.issueToken(member.userId, auth.organizationId!, auth.userId, transaction);
      await this.audit.record({ action: 'user.invitation_resent', entityType: 'OrganizationMembership', entityId: id }, transaction);
      return token;
    });
    await this.sendInvitation(auth, id, raw);
    return { resent: true };
  }

  async cancelInvitation(auth: AuthContext, id: string): Promise<void> {
    const member = await this.get(id);
    if (member.status !== 'INVITED') throw AppError.conflict('Only pending invitations can be cancelled');
    await this.assertCanManage(auth, id);
    await this.db.transaction(async (transaction) => {
      await this.invitations.revokePending(member.userId, auth.organizationId!, transaction);
      await OrganizationMembership.destroy({ where: { id }, transaction });
      await this.audit.record(
        { action: 'user.invitation_cancelled', entityType: 'OrganizationMembership', entityId: id, summary: `Invitation for ${member.email} cancelled` },
        transaction,
      );
    });
  }

  async setRoles(auth: AuthContext, id: string, roleIds: string[]) {
    if (id === auth.membershipId) throw AppError.forbidden('You cannot change your own roles');
    const member = await this.get(id);
    const nextIds = [...new Set(roleIds)];
    const currentIds = member.roles.map((r) => r.id);
    const removedIds = currentIds.filter((r) => !nextIds.includes(r));

    // Actor must be able to grant both the new roles and any roles being taken away.
    await this.assertRolesAssignable(auth, [...nextIds, ...removedIds]);
    const nextRoles = await Role.findAll({ where: { id: { [Op.in]: nextIds } }, attributes: ['id', 'key', 'name'] });
    if (member.status === 'ACTIVE' && member.roles.some((r) => r.key === ORG_ADMIN_ROLE) && !nextRoles.some((r) => r.key === ORG_ADMIN_ROLE)) {
      await this.assertNotLastAdmin(id);
    }

    await this.db.transaction(async (transaction) => {
      await MembershipRole.destroy({ where: { membershipId: id }, transaction });
      await MembershipRole.bulkCreate(
        nextIds.map((roleId) => ({ organizationId: auth.organizationId!, membershipId: id, roleId, assignedById: auth.userId })),
        { transaction },
      );
      await OrganizationMembership.update({ updatedById: auth.userId }, { where: { id }, transaction });
      await this.audit.record(
        {
          action: 'user.roles_updated',
          entityType: 'OrganizationMembership',
          entityId: id,
          summary: `Roles updated for ${member.email}`,
          changes: { roles: { from: member.roles.map((r) => r.key), to: nextRoles.map((r) => r.key) } },
        },
        transaction,
      );
    });
    await this.notifications.notify(member.userId, {
      type: 'access',
      title: 'Your roles were updated',
      body: `Current roles: ${nextRoles.map((r) => r.name).join(', ')}`,
      organizationId: auth.organizationId,
    });
    return this.get(id);
  }

  async suspend(auth: AuthContext, id: string) {
    if (id === auth.membershipId) throw AppError.forbidden('You cannot suspend yourself');
    const member = await this.get(id);
    if (member.status === 'SUSPENDED') throw AppError.conflict('User is already suspended');
    await this.assertCanManage(auth, id);
    if (member.status === 'ACTIVE' && member.roles.some((r) => r.key === ORG_ADMIN_ROLE)) await this.assertNotLastAdmin(id);

    await this.db.transaction(async (transaction) => {
      await OrganizationMembership.update({ status: 'SUSPENDED', suspendedAt: new Date(), updatedById: auth.userId }, { where: { id }, transaction });
      await this.audit.record({ action: 'user.suspended', entityType: 'OrganizationMembership', entityId: id, summary: `Suspended ${member.email}` }, transaction);
    });
    await this.sessions.revokeAll(member.userId, 'membership_suspended', { organizationId: auth.organizationId! });
    return this.get(id);
  }

  async reactivate(auth: AuthContext, id: string) {
    const member = await this.get(id);
    if (member.status !== 'SUSPENDED') throw AppError.conflict('Only suspended users can be reactivated');
    await this.assertCanManage(auth, id);
    await this.assertWithinPlanLimit(auth.organizationId!);
    const status = member.joinedAt ? 'ACTIVE' : 'INVITED';
    await this.db.transaction(async (transaction) => {
      await OrganizationMembership.update({ status, suspendedAt: null, updatedById: auth.userId }, { where: { id }, transaction });
      await this.audit.record({ action: 'user.reactivated', entityType: 'OrganizationMembership', entityId: id, summary: `Reactivated ${member.email}` }, transaction);
    });
    return this.get(id);
  }

  async revokeSessions(auth: AuthContext, id: string) {
    const member = await this.get(id);
    await this.assertCanManage(auth, id);
    const revoked = await this.sessions.revokeAll(member.userId, 'revoked_by_admin', { organizationId: auth.organizationId! });
    await this.audit.record({ action: 'user.sessions_revoked', entityType: 'OrganizationMembership', entityId: id, metadata: { revoked } });
    return { revoked };
  }

  async loginHistory(id: string, query: PaginationQueryDto) {
    const member = await this.get(id);
    const { rows, count } = await LoginEvent.findAndCountAll({
      where: { userId: member.userId },
      order: [['createdAt', 'DESC']],
      ...paginationArgs(query),
      attributes: ['id', 'outcome', 'failureReason', 'ipAddress', 'userAgent', 'createdAt'],
    });
    return new PaginatedResult(rows, paginationMeta(query, count));
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async assertRolesAssignable(auth: AuthContext, roleIds: string[]): Promise<void> {
    const unique = [...new Set(roleIds)];
    const roles = await Role.findAll({
      where: { id: { [Op.in]: unique } },
      attributes: ['id'],
      include: [{ model: RolePermission, attributes: ['scope'], include: [{ model: Permission, attributes: ['key'] }] }],
    });
    if (roles.length !== unique.length) {
      throw AppError.validation([{ field: 'roleIds', message: 'One or more roles do not exist' }]);
    }
    assertNoEscalation(
      auth.permissions,
      auth.features,
      roles.flatMap((r) => (r.permissions ?? []).map((p) => ({ key: p.permission!.key, scope: p.scope as PermissionScope }))),
    );
  }

  /** An actor can only manage users whose access does not exceed their own. */
  private async assertCanManage(auth: AuthContext, membershipId: string): Promise<void> {
    const roles = await MembershipRole.findAll({ where: { membershipId }, attributes: ['roleId'] });
    if (roles.length) await this.assertRolesAssignable(auth, roles.map((r) => r.roleId));
  }

  private async assertNotLastAdmin(excludingMembershipId: string): Promise<void> {
    const others = await OrganizationMembership.count({
      where: { id: { [Op.ne]: excludingMembershipId }, status: 'ACTIVE' },
      include: [
        {
          model: MembershipRole,
          attributes: [],
          required: true,
          include: [{ model: Role, attributes: [], where: { key: ORG_ADMIN_ROLE }, required: true }],
        },
      ],
      distinct: true,
      col: 'id',
    });
    if (others === 0) throw AppError.conflict('An organization must keep at least one active Organization Admin');
  }

  private async assertWithinPlanLimit(organizationId: string): Promise<void> {
    const org = await Organization.findByPk(organizationId, { attributes: ['id'], include: [{ model: Plan, attributes: ['maxUsers'] }], rejectOnEmpty: true });
    const maxUsers = org.plan?.maxUsers;
    if (!maxUsers) return;
    const count = await OrganizationMembership.count({ where: { status: { [Op.in]: ['ACTIVE', 'INVITED'] } } });
    if (count >= maxUsers) {
      throw AppError.forbidden(`Your subscription allows up to ${maxUsers} users. Upgrade your plan to add more.`);
    }
  }

  private async sendInvitation(auth: AuthContext, membershipId: string, rawToken: string): Promise<void> {
    const member = await this.get(membershipId);
    const [org, inviter] = await Promise.all([
      Organization.findByPk(auth.organizationId!, { attributes: ['name'], rejectOnEmpty: true }),
      User.findByPk(auth.userId, { attributes: ['firstName', 'lastName'], rejectOnEmpty: true }),
    ]);
    await this.invitations.send({
      email: member.email,
      firstName: member.firstName,
      organizationName: org.name,
      inviterName: `${inviter.firstName} ${inviter.lastName}`,
      rawToken,
    });
  }
}
