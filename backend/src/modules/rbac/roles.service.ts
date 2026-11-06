import { Injectable } from '@nestjs/common';
import { getPermission, MODULES, PERMISSIONS, PermissionScope } from '../../contracts';
import { Op, col, fn, type Transaction } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import { MembershipRole, Permission, Role, RolePermission } from '../../database/models';
import { AuditService, diff } from '../../infrastructure/audit/audit.service';
import { assertNoEscalation, Grant } from './escalation';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

function roleKeyFrom(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'role';
}

/** Normalises scopes (non-scopable → ORGANIZATION) and rejects duplicates. */
function normalizeGrants(grants: Grant[]): Grant[] {
  const seen = new Set<string>();
  return grants.map((g) => {
    if (seen.has(g.key)) throw AppError.validation([{ field: 'permissions', message: `Duplicate permission ${g.key}` }]);
    seen.add(g.key);
    const def = getPermission(g.key)!;
    return { key: g.key, scope: def.scopable ? g.scope : 'ORGANIZATION' };
  });
}

/** Counts rows per role id (tenant-scoped through the model hooks). */
async function countByRole(model: typeof MembershipRole | typeof RolePermission, roleIds: string[]): Promise<Map<string, number>> {
  if (!roleIds.length) return new Map();
  const rows = (await (model as typeof MembershipRole).findAll({
    attributes: ['roleId', [fn('COUNT', col('id')), 'count']],
    where: { roleId: { [Op.in]: roleIds } },
    group: ['roleId'],
    raw: true,
  })) as unknown as { roleId: string; count: string }[];
  return new Map(rows.map((r) => [r.roleId, Number(r.count)]));
}

const ROLE_ATTRIBUTES = ['id', 'key', 'name', 'description', 'isSystem', 'isLocked', 'createdAt', 'updatedAt'];

/** Organization roles. Role models are tenant-scoped automatically. */
@Injectable()
export class RolesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const roles = await Role.findAll({ attributes: ROLE_ATTRIBUTES, order: [['isSystem', 'DESC'], ['name', 'ASC']] });
    const ids = roles.map((r) => r.id);
    const [members, permissions] = await Promise.all([countByRole(MembershipRole, ids), countByRole(RolePermission, ids)]);
    return roles.map((r) => {
      const { createdAt: _c, ...rest } = r.get({ plain: true });
      return { ...rest, memberCount: members.get(r.id) ?? 0, permissionCount: permissions.get(r.id) ?? 0 };
    });
  }

  async get(id: string) {
    const role = await Role.findByPk(id, {
      attributes: ROLE_ATTRIBUTES,
      include: [{ model: RolePermission, attributes: ['scope'], include: [{ model: Permission, attributes: ['key'] }] }],
    });
    if (!role) throw AppError.notFound('Role');
    const memberCount = await MembershipRole.count({ where: { roleId: id } });
    return {
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      isLocked: role.isLocked,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
      memberCount,
      permissions: (role.permissions ?? []).map((p) => ({ key: p.permission!.key, scope: p.scope as PermissionScope })),
    };
  }

  catalog(features: Set<string>) {
    return {
      modules: MODULES.map((m) => ({
        key: m.key,
        name: m.name,
        description: m.description,
        entitled: features.has(m.key),
        permissions: PERMISSIONS.filter((p) => p.module === m.key).map((p) => ({
          key: p.key,
          page: p.page,
          description: p.description,
          scopable: p.scopable,
          restricted: !!p.restricted,
        })),
      })),
    };
  }

  async create(auth: AuthContext, dto: CreateRoleDto) {
    const grants = normalizeGrants(dto.permissions);
    this.assertEntitled(auth, grants);
    assertNoEscalation(auth.permissions, auth.features, grants);

    const key = await this.uniqueKey(roleKeyFrom(dto.name));
    const role = await this.db.transaction(async (transaction) => {
      const created = await Role.create(
        {
          organizationId: auth.organizationId!,
          key,
          name: dto.name,
          description: dto.description ?? null,
          isSystem: false,
          isLocked: false,
          createdById: auth.userId,
          updatedById: auth.userId,
        },
        { transaction },
      );
      await this.writeGrants(created.id, auth.organizationId!, grants, transaction);
      await this.audit.record(
        { action: 'role.created', entityType: 'Role', entityId: created.id, summary: `Role "${dto.name}" created`, metadata: { permissions: grants } },
        transaction,
      );
      return created;
    });
    return this.get(role.id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateRoleDto) {
    const role = await Role.findByPk(id);
    if (!role) throw AppError.notFound('Role');
    if (role.isSystem && dto.name !== undefined && dto.name !== role.name) {
      throw AppError.forbidden('System role names cannot be changed. Create a custom role for a different name.');
    }
    const before = role.get({ plain: true, clone: true });
    const data = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
    };
    await role.update({ ...data, updatedById: auth.userId });
    await this.audit.record({ action: 'role.updated', entityType: 'Role', entityId: id, changes: diff(before, data, ['name', 'description']) });
    return this.get(id);
  }

  async setPermissions(auth: AuthContext, id: string, input: Grant[]) {
    const role = await this.get(id);
    if (role.isLocked) throw AppError.forbidden('This role is locked and its permissions cannot be changed');

    const grants = normalizeGrants(input);
    this.assertEntitled(auth, grants);

    const before = new Map(role.permissions.map((p) => [p.key, p.scope]));
    const after = new Map(grants.map((g) => [g.key, g.scope]));
    const added = grants.filter((g) => before.get(g.key) !== g.scope);
    const removed = role.permissions.filter((p) => !after.has(p.key)).map((p) => p.key);

    // Only newly granted / widened permissions need escalation checks; removing is always allowed.
    assertNoEscalation(auth.permissions, auth.features, added);
    if (auth.roleIds.includes(id) && removed.includes('role.manage')) {
      throw AppError.forbidden('You cannot remove role management from a role you hold');
    }

    await this.db.transaction(async (transaction) => {
      await RolePermission.destroy({ where: { roleId: id }, transaction });
      await this.writeGrants(id, auth.organizationId!, grants, transaction);
      await Role.update({ updatedById: auth.userId }, { where: { id }, transaction });
      await this.audit.record(
        {
          action: 'role.permissions_updated',
          entityType: 'Role',
          entityId: id,
          summary: `Permissions of "${role.name}" updated (+${added.length} / -${removed.length})`,
          metadata: { added, removed },
        },
        transaction,
      );
    });
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const role = await this.get(id);
    if (role.isSystem) throw AppError.forbidden('System roles cannot be deleted');
    if (role.memberCount > 0) throw AppError.conflict('Remove this role from all users before deleting it');
    await this.db.transaction(async (transaction) => {
      await Role.destroy({ where: { id }, transaction });
      await this.audit.record({ action: 'role.deleted', entityType: 'Role', entityId: id, summary: `Role "${role.name}" deleted` }, transaction);
    });
  }

  private assertEntitled(auth: AuthContext, grants: Grant[]): void {
    const notEntitled = grants.filter((g) => !auth.features.has(getPermission(g.key)!.module)).map((g) => g.key);
    if (notEntitled.length) {
      throw new AppError('FEATURE_NOT_ENTITLED', `These permissions belong to modules not in your subscription: ${notEntitled.join(', ')}`);
    }
  }

  private async writeGrants(roleId: string, organizationId: string, grants: Grant[], transaction: Transaction): Promise<void> {
    if (!grants.length) return;
    const permissions = await Permission.findAll({ where: { key: { [Op.in]: grants.map((g) => g.key) } }, attributes: ['id', 'key'], transaction });
    const ids = new Map(permissions.map((p) => [p.key, p.id]));
    await RolePermission.bulkCreate(
      grants.map((g) => ({ organizationId, roleId, permissionId: ids.get(g.key)!, scope: g.scope })),
      { transaction },
    );
  }

  private async uniqueKey(base: string): Promise<string> {
    const taken = new Set((await Role.findAll({ where: { key: { [Op.startsWith]: base } }, attributes: ['key'] })).map((r) => r.key));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
  }
}
