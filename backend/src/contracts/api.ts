import type { ModuleKey, PermissionScope } from './permissions';

/** Every successful API response uses this envelope. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

/** Every failed API response uses this envelope. */
export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: ValidationIssue[];
  requestId?: string;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'ACCOUNT_DISABLED',
  'MFA_REQUIRED',
  'MFA_INVALID',
  'MFA_SETUP_REQUIRED',
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
  'SESSION_REVOKED',
  'PASSWORD_POLICY_VIOLATION',
  'PASSWORD_EXPIRED',
  'FORBIDDEN',
  'FEATURE_NOT_ENTITLED',
  'ORGANIZATION_INACTIVE',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ORGANIZATION_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export type PlatformRole = 'SUPER_ADMIN';

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  logoUrl: string | null;
  /** Lowercase `#rrggbb` chosen by the organization, or null. */
  brandColor: string | null;
}

/** Appearance choices saved on the account (keys and values are validated by the web app's catalogs). */
export const APPEARANCE_PREFERENCE_KEYS = ['mode', 'color', 'sidebar', 'region', 'hourCycle', 'direction'] as const;
export type AppearancePreferences = Partial<Record<(typeof APPEARANCE_PREFERENCE_KEYS)[number], string>>;

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  platformRole: PlatformRole | null;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  /** API-relative URL of the profile photo. */
  avatarUrl: string | null;
  preferences: AppearancePreferences;
}

/** Effective access of the current user in the active organization. */
export interface AccessContext {
  user: AuthUser;
  activeOrganization: OrganizationSummary | null;
  organizations: OrganizationSummary[];
  roles: { id: string; key: string; name: string }[];
  /** permission key -> broadest granted scope */
  permissions: Record<string, PermissionScope>;
  platformPermissions: string[];
  /** Entitled modules for the active organization. */
  features: ModuleKey[];
  mfaSetupRequired: boolean;
  passwordExpired: boolean;
  /** Sign-out after this many minutes without activity (the active organization's security policy). */
  idleTimeoutMinutes: number;
}

export type LoginResult =
  | { status: 'AUTHENTICATED'; accessToken: string; expiresIn: number; context: AccessContext }
  | { status: 'MFA_REQUIRED'; challengeToken: string };

export interface TokenRefreshResult {
  accessToken: string;
  expiresIn: number;
}

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
  historyCount: number;
  maxAgeDays: number;
}
