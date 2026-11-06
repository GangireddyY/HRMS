import { getPermission, ModuleKey, PermissionScope, scopeCovers } from '../../contracts';
import { AppError } from '../../common/errors/app-error';

export interface Grant {
  key: string;
  scope: PermissionScope;
}

/**
 * Privilege-escalation guard: an actor may only grant permissions they hold themselves, at no broader
 * scope. Restricted permissions (e.g. POSH access) are never held implicitly, so holders of
 * `role.manage` may assign them. Grants in modules the organization is not entitled to are inert
 * and skipped.
 */
export function findEscalations(actor: Map<string, PermissionScope>, features: Set<ModuleKey>, grants: Grant[]): string[] {
  const canManageRoles = actor.has('role.manage');
  return grants
    .filter((g) => {
      const def = getPermission(g.key);
      if (!def) return true;
      if (!features.has(def.module)) return false;
      if (def.restricted) return !canManageRoles;
      const held = actor.get(g.key);
      return !held || !scopeCovers(held, def.scopable ? g.scope : 'ORGANIZATION');
    })
    .map((g) => g.key);
}

export function assertNoEscalation(actor: Map<string, PermissionScope>, features: Set<ModuleKey>, grants: Grant[]): void {
  const violations = findEscalations(actor, features, grants);
  if (violations.length) {
    throw AppError.forbidden(`You cannot grant permissions beyond your own access: ${violations.join(', ')}`);
  }
}
