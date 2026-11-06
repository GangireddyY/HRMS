import { getPermission, type ModuleKey, type PermissionScope, type PlatformPermission } from '@contracts';

/** Requirements attached to routes and menu items. */
export interface AccessRule {
  /** Any of these permissions grants access. */
  permissions?: string[];
  /** Minimum record scope for scopable permissions (default OWN). */
  scope?: PermissionScope;
  platform?: PlatformPermission;
  feature?: ModuleKey;
  /** Requires an active organization context. */
  tenant?: boolean;
}

export interface AccessSubject {
  can(permission: string, scope?: PermissionScope): boolean;
  hasFeature(module: ModuleKey): boolean;
  canPlatform(permission: PlatformPermission): boolean;
  hasOrganization: boolean;
}

export function isAllowed(rule: AccessRule | undefined, subject: AccessSubject): boolean {
  if (!rule) return true;
  if (rule.platform && !subject.canPlatform(rule.platform)) return false;
  if ((rule.tenant || rule.permissions?.length || rule.feature) && !subject.hasOrganization) return false;
  if (rule.feature && !subject.hasFeature(rule.feature)) return false;
  if (rule.permissions?.length) {
    return rule.permissions.some((p) => {
      const scopable = getPermission(p)?.scopable ?? false;
      return subject.can(p, scopable ? (rule.scope ?? 'OWN') : 'OWN');
    });
  }
  return true;
}
