import { getPermission } from '../../contracts';
import { MembershipRole, OrganizationMembership, Permission, Role, RolePermission } from '../../database/models';
import type { AuditService } from '../../infrastructure/audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';

/** Restricted permissions (e.g. POSH case access) among the given keys. */
export function restrictedKeys(keys: string[]): string[] {
  return [...new Set(keys.filter((k) => getPermission(k)?.restricted))];
}

/**
 * Tells everyone who already holds a restricted permission (e.g. the POSH Internal Committee) that someone else was
 * just given it, so a quiet self-assignment or a wrong grant can't go unnoticed. Also audited.
 */
export async function alertRestrictedGrant(
  deps: { notifications: NotificationsService; audit: AuditService },
  input: { organizationId: string; actorUserId: string; keys: string[]; grantedTo: string; excludeUserIds?: string[] },
): Promise<void> {
  const keys = restrictedKeys(input.keys);
  if (!keys.length) return;
  const holders = await OrganizationMembership.findAll({
    where: { organizationId: input.organizationId, status: 'ACTIVE' },
    attributes: ['id', 'userId'],
    include: [
      {
        model: MembershipRole,
        attributes: [],
        required: true,
        include: [{ model: Role, attributes: [], required: true, include: [{ model: RolePermission, attributes: [], required: true, include: [{ model: Permission, attributes: [], required: true, where: { key: keys } }] }] }],
      },
    ],
    skipTenantScope: true,
  });
  const skip = new Set([input.actorUserId, ...(input.excludeUserIds ?? [])]);
  const names = keys.map((k) => getPermission(k)?.description ?? k).join(', ');
  for (const userId of new Set(holders.map((h) => h.userId))) {
    if (skip.has(userId)) continue;
    await deps.notifications.notify(userId, {
      organizationId: input.organizationId,
      type: 'security',
      title: `Restricted access granted to ${input.grantedTo}`,
      body: `${names}. If you didn't expect this, raise it with your committee and the organization owner.`,
      link: '/admin/audit-logs',
    });
  }
  await deps.audit.record({ action: 'rbac.restricted_access_granted', entityType: 'Permission', summary: `Restricted access (${keys.join(', ')}) granted to ${input.grantedTo}`, metadata: { keys, grantedTo: input.grantedTo } });
}
