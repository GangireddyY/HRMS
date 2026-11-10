import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getPermission, PLATFORM_PERMISSIONS, PlatformPermission } from '../../../contracts';
import type { Request } from 'express';
import {
  AUTHENTICATED_KEY,
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  PLATFORM_PERMISSIONS_KEY,
  REQUIRE_TENANT_KEY,
} from '../../../common/auth/decorators';
import { AppError } from '../../../common/errors/app-error';

/** Platform role → platform permissions. Super Admin holds every platform permission. */
export function platformPermissionsFor(role: string | null): PlatformPermission[] {
  return role === 'SUPER_ADMIN' ? [...PLATFORM_PERMISSIONS] : [];
}

/** Enforces @RequirePermissions, @RequirePlatformPermissions and @RequireTenant. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const auth = context.switchToHttp().getRequest<Request>().auth;
    if (!auth) throw new AppError('UNAUTHENTICATED', 'Authentication required');

    const platform = this.reflector.getAllAndOverride<PlatformPermission[]>(PLATFORM_PERMISSIONS_KEY, targets);
    if (platform?.length) {
      const held = platformPermissionsFor(auth.platformRole);
      if (!platform.every((p) => held.includes(p))) throw AppError.forbidden();
    }

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets);
    const requireTenant = this.reflector.getAllAndOverride<boolean>(REQUIRE_TENANT_KEY, targets);
    // Fail closed: a route that declares no access rule is refused instead of being open to every signed-in user.
    if (!platform?.length && !required?.length && !requireTenant && !this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, targets)) {
      throw AppError.forbidden('This route does not declare who may use it');
    }

    if (required?.length || requireTenant) {
      if (!auth.organizationId) throw AppError.forbidden('No active organization for this session');
    }

    for (const key of required ?? []) {
      const def = getPermission(key);
      if (!def) throw new Error(`Route requires unknown permission "${key}"`);
      if (!auth.features.has(def.module)) {
        throw new AppError('FEATURE_NOT_ENTITLED', 'This module is not included in your organization subscription');
      }
      // A delegated approval only reaches the delegator's people; services check that through EmployeeScopeService.
      if (!auth.permissions.has(key) && !auth.delegated?.some((d) => d.permission === key)) throw AppError.forbidden();
    }
    return true;
  }
}
