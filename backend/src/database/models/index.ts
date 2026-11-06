import { AuditLog, Notification } from './activity.models';
import { AttendancePeriod, AttendanceRecord, AttendanceRegularization, Holiday, Shift } from './attendance.models';
import { ActionToken, LoginEvent, MfaRecoveryCode, PasswordHistory, RefreshToken, User, UserSession } from './identity.models';
import { Feature, Organization, OrganizationFeature, OrganizationLogo, OrganizationMembership, OrganizationSecurityPolicy, Plan, PlanFeature } from './organization.models';
import { Department, Designation, Employee, EmployeeLifecycleEvent, Location } from './people.models';
import { MembershipRole, Permission, Role, RolePermission } from './rbac.models';

export * from './activity.models';
export * from './attendance.models';
export * from './identity.models';
export * from './organization.models';
export * from './people.models';
export * from './rbac.models';

export const ALL_MODELS = [
  User,
  PasswordHistory,
  MfaRecoveryCode,
  UserSession,
  RefreshToken,
  ActionToken,
  LoginEvent,
  Feature,
  Plan,
  PlanFeature,
  Organization,
  OrganizationFeature,
  OrganizationSecurityPolicy,
  OrganizationLogo,
  OrganizationMembership,
  Permission,
  Role,
  RolePermission,
  MembershipRole,
  AuditLog,
  Notification,
  Department,
  Designation,
  Location,
  Employee,
  EmployeeLifecycleEvent,
  Shift,
  Holiday,
  AttendanceRecord,
  AttendanceRegularization,
  AttendancePeriod,
];

/**
 * Organization-owned models. Every query on these models is automatically constrained to the active
 * organization (see tenant-scope.ts); queries without a tenant context fail closed unless they opt out
 * explicitly with `skipTenantScope: true`. Add every new organization-owned model here (enforced by test).
 */
export const TENANT_MODELS = [
  OrganizationSecurityPolicy,
  OrganizationLogo,
  OrganizationFeature,
  OrganizationMembership,
  Role,
  RolePermission,
  MembershipRole,
  Department,
  Designation,
  Location,
  Employee,
  EmployeeLifecycleEvent,
  Shift,
  Holiday,
  AttendanceRecord,
  AttendanceRegularization,
  AttendancePeriod,
  // Nullable organization_id (platform-level rows exist); written with explicit organization ids.
  AuditLog,
  LoginEvent,
];
