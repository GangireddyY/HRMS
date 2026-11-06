DROP TABLE IF EXISTS "notifications", "audit_logs", "membership_roles", "role_permissions", "roles", "permissions",
  "organization_memberships", "organization_security_policies", "organization_features", "plan_features",
  "login_events", "action_tokens", "refresh_tokens", "user_sessions", "mfa_recovery_codes", "password_history",
  "users", "organizations", "plans", "features" CASCADE;
DROP TYPE IF EXISTS "LoginOutcome", "ActionTokenPurpose", "PermissionScope", "MembershipStatus", "OrganizationStatus", "UserStatus", "PlatformRole";
