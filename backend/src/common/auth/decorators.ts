import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PlatformPermission } from '../../contracts';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';
import type { AuthContext } from './auth-context';

export const IS_PUBLIC_KEY = 'auth:public';
export const PERMISSIONS_KEY = 'auth:permissions';
export const PLATFORM_PERMISSIONS_KEY = 'auth:platformPermissions';
export const REQUIRE_TENANT_KEY = 'auth:requireTenant';
export const ALLOW_RESTRICTED_SESSION_KEY = 'auth:allowRestrictedSession';

/** Skips authentication for the route. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Requires all listed organization permissions in the active organization.
 * Implies an active organization context and entitlement to each permission's module.
 */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** Requires platform (Super Admin) capabilities. */
export const RequirePlatformPermissions = (...permissions: PlatformPermission[]) =>
  SetMetadata(PLATFORM_PERMISSIONS_KEY, permissions);

/** Requires an active organization context without a specific permission (e.g. own notifications). */
export const RequireTenant = () => SetMetadata(REQUIRE_TENANT_KEY, true);

/**
 * Allows the route while the session is restricted (MFA enrollment required or password expired),
 * so the user can resolve the restriction.
 */
export const AllowRestrictedSession = () => SetMetadata(ALLOW_RESTRICTED_SESSION_KEY, true);

export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.auth) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  return req.auth;
});

/** Active organization id; throws if the request has no tenant context. */
export const CurrentOrg = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const orgId = req.auth?.organizationId;
  if (!orgId) throw new AppError('FORBIDDEN', 'No active organization for this session');
  return orgId;
});
