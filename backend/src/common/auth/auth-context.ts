import type { ModuleKey, PermissionScope, PlatformRole } from '../../contracts';

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
