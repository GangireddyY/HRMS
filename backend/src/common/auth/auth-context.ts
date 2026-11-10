import type { DelegatedGrant, ModuleKey, PermissionScope, PlatformRole } from '../../contracts';

/** Authenticated principal attached to each request by the JwtAuthGuard. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  platformRole: PlatformRole | null;
  /** Active organization (membership verified on every request). */
  organizationId: string | null;
  membershipId: string | null;
  roleIds: string[];
  permissions: Map<string, PermissionScope>;
  /** Approvals held on behalf of someone who is away; scoped to their team, not the caller's (see EmployeeScopeService). */
  delegated?: DelegatedGrant[];
  features: Set<ModuleKey>;
  mfaSetupRequired: boolean;
  passwordExpired: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
    requestId?: string;
  }
}
