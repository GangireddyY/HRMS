# API

Base URL: `/api/v1` · Interactive OpenAPI docs: `/api/docs` (non-production) · JSON spec: `/api/docs/openapi.json`

## 1. Conventions

**Authentication** – `Authorization: Bearer <accessToken>`; the refresh token travels in the `hrms_rt` HttpOnly cookie (only sent to `/api/v1/auth/*`).

**Success envelope**

```json
{ "success": true, "data": { "...": "..." } }
{ "success": true, "data": [ ... ], "meta": { "page": 1, "pageSize": 20, "total": 134, "totalPages": 7 } }
```

**Error envelope** (no stack traces or SQL ever returned)

```json
{ "success": false, "error": { "code": "VALIDATION_FAILED", "message": "Validation failed",
  "details": [{ "field": "email", "message": "email must be an email" }], "requestId": "5b0c…" } }
```

| HTTP | Codes |
|---|---|
| 400 | `BAD_REQUEST`, `TOKEN_INVALID` |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `TOKEN_EXPIRED`, `SESSION_REVOKED`, `MFA_INVALID` |
| 403 | `FORBIDDEN`, `FEATURE_NOT_ENTITLED`, `ORGANIZATION_INACTIVE`, `ACCOUNT_DISABLED`, `MFA_SETUP_REQUIRED`, `PASSWORD_EXPIRED` |
| 404 | `NOT_FOUND` (also returned for other tenants' ids) |
| 409 | `CONFLICT` |
| 422 | `VALIDATION_FAILED`, `PASSWORD_POLICY_VIOLATION` |
| 423 | `ACCOUNT_LOCKED` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` |

**Lists** – `?page=1&pageSize=20&sort=field:asc|desc&search=text` + endpoint-specific filters. Sort fields are whitelisted per endpoint; unknown fields return 422. `pageSize` ≤ 100.

**Validation** – unknown body/query fields are rejected (422). Strings are trimmed; empty strings clear nullable profile fields.

**Tracing** – every response has `X-Request-Id` (a valid incoming one is propagated).

**Versioning** – URI versioning (`/v1`). Breaking changes ship as `/v2` alongside `/v1`.

## 2. Endpoints (Phase 1)

Legend: 🔓 public · 🔑 authenticated · `perm` required permission · ⚙ platform permission · R = allowed in a restricted session (MFA enrolment / expired password).

### Auth – `/auth`

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/auth/login` | 🔓 10/min | Email + password (+ optional `organizationId`). Returns `AUTHENTICATED` (token + context) or `MFA_REQUIRED` (challenge) |
| POST | `/auth/mfa/verify` | 🔓 10/min | `{challengeToken, code}` or `{challengeToken, recoveryCode}` |
| POST | `/auth/refresh` | 🔓 cookie, 30/min | Rotates refresh cookie, returns new access token |
| POST | `/auth/logout` | 🔓 cookie | Revokes the session, clears cookie |
| POST | `/auth/forgot-password` | 🔓 5/min | Always 202 |
| POST | `/auth/tokens/inspect` | 🔓 | Validate reset/invitation token; returns email, organization, password policy |
| POST | `/auth/reset-password` | 🔓 5/min | Reset with token; revokes all sessions |
| POST | `/auth/accept-invitation` | 🔓 | Set password (new) or confirm password (existing account) |
| POST | `/auth/register-organization` | 🔓 5/min | Self-service org + admin (if `ALLOW_ORGANIZATION_SIGNUP`) |
| GET | `/auth/me` | 🔑 R | Access context: user, active org, orgs, roles, permissions→scope, platform permissions, features, restriction flags |
| PATCH | `/auth/me` | 🔑 | Update first/last name, phone |
| GET | `/auth/password-policy` | 🔑 R | Effective policy for the user |
| POST | `/auth/change-password` | 🔑 R | Revokes other sessions |
| POST | `/auth/switch-organization` | 🔑 | Validates membership; returns new token + context |
| GET | `/auth/mfa` | 🔑 R | MFA status, requirement, recovery codes remaining |
| POST | `/auth/mfa/setup` | 🔑 R | Secret + otpauth URL + QR (pending until verified) |
| POST | `/auth/mfa/enable` | 🔑 R | Verify code → returns 10 recovery codes |
| POST | `/auth/mfa/disable` | 🔑 | Requires password + code; blocked if org requires MFA |
| POST | `/auth/mfa/recovery-codes` | 🔑 | Regenerate (requires code) |
| GET | `/auth/sessions` | 🔑 R | Active sessions (current flagged) |
| DELETE | `/auth/sessions/:id` | 🔑 R | Revoke own session |
| POST | `/auth/sessions/revoke-others` | 🔑 R | Revoke all but current |
| GET | `/auth/login-history` | 🔑 R | Own sign-in history (paginated) |

### Organization – `/organizations/current`

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/organizations/current` | `organization.view` | Profile & regional settings |
| PATCH | `/organizations/current` | `organization.update` | Update profile (validated; audited with diff) |
| GET | `/organizations/current/security-policy` | `organization.view` | Password/lockout/session/MFA policy |
| PUT | `/organizations/current/security-policy` | `organization.security.manage` | Update policy (audited) |
| GET | `/organizations/current/subscription` | `organization.view` | Plan, user usage, module entitlements |
| GET | `/organizations/current/overview` | `organization.view` | Dashboard metrics, 14-day login activity, recent audit |

### Users – `/users`

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/users` | `user.view` | Filters: `status`, `roleId`, `search`; sort: `name`, `email`, `status`, `joinedAt`, `createdAt`, `lastLoginAt` |
| GET | `/users/:id` | `user.view` | Membership detail |
| POST | `/users/invitations` | `user.invite` | Invite with roles (plan user-limit and escalation checks) |
| POST | `/users/:id/invitation/resend` | `user.invite` | New token, old one invalidated |
| DELETE | `/users/:id/invitation` | `user.invite` | Cancel pending invitation |
| PUT | `/users/:id/roles` | `user.update` | Replace roles (escalation, self-edit and last-admin guards) |
| POST | `/users/:id/suspend` | `user.update` | Suspend membership; revokes sessions in this org |
| POST | `/users/:id/reactivate` | `user.update` | Reactivate |
| POST | `/users/:id/sessions/revoke` | `user.sessions.revoke` | Revoke the user's sessions in this org |
| GET | `/users/:id/login-history` | `audit.login_history.view` | Sign-in history in this org |

### Roles & permissions

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/permissions` | `role.view` | Catalog grouped by module with `entitled` flags |
| GET | `/roles` | `role.view` | Roles with member/permission counts |
| GET | `/roles/:id` | `role.view` | Role with `[{key, scope}]` |
| POST | `/roles` | `role.manage` | Create custom role `{name, description, permissions[]}` |
| PATCH | `/roles/:id` | `role.manage` | Rename / describe |
| PUT | `/roles/:id/permissions` | `role.manage` | Replace grants (locked roles rejected; escalation-checked) |
| DELETE | `/roles/:id` | `role.manage` | Custom roles without members only |

### Audit

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/audit-logs` | `audit.view` | Filters: `action` (prefix), `entityType`, `actorUserId`, `from`, `to`, `search` |
| GET | `/login-events` | `audit.login_history.view` | Filters: `outcome`, `from`, `to`, `search` (email) |

### Notifications

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/notifications` | 🔑 R | `unreadOnly` filter; personal + active-org notifications |
| GET | `/notifications/unread-count` | 🔑 R | |
| POST | `/notifications/:id/read` | 🔑 R | Own notifications only (404 otherwise) |
| POST | `/notifications/read-all` | 🔑 R | |

### Platform – `/platform` (Super Admin)

| Method | Path | Permission | Description |
|---|---|---|---|
| GET | `/platform/dashboard` | ⚙ `platform.organizations.view` | Tenant counts, plan distribution, users, sessions, logins |
| GET | `/platform/organizations` | ⚙ view | Filters: `status`, `planId`, `search`; sort `name`, `createdAt`, `status` |
| GET | `/platform/organizations/:id` | ⚙ view | Profile, member counts, admins, overrides, effective modules |
| POST | `/platform/organizations` | ⚙ `platform.organizations.manage` | Provision org (roles, policy) + invite first admin |
| PATCH | `/platform/organizations/:id` | ⚙ manage | Profile and plan |
| POST | `/platform/organizations/:id/activate` | ⚙ manage | |
| POST | `/platform/organizations/:id/suspend` | ⚙ manage | `{reason}`; revokes all sessions |
| POST | `/platform/organizations/:id/deactivate` | ⚙ manage | `{reason}` |
| PUT | `/platform/organizations/:id/features` | ⚙ manage | `{overrides:[{featureKey, enabled: true\|false\|null}]}` |
| POST | `/platform/organizations/:id/admins/:membershipId/resend-invitation` | ⚙ manage | |
| GET | `/platform/plans` · `/platform/plans/:id` | ⚙ view | |
| POST | `/platform/plans` · PATCH `/platform/plans/:id` | ⚙ `platform.plans.manage` | Plan with `featureKeys` |
| GET | `/platform/features` | ⚙ view | Module catalog |
| GET | `/platform/audit-logs` | ⚙ `platform.audit.view` | Cross-tenant audit, `organizationId` filter |

### Health

`GET /health` 🔓 → `{status, database, timestamp}` (503 when the database is down).

## 3. Planned resource roots

`/employees` (2), `/recruitment`, `/onboarding` (3), `/attendance`, `/leaves` (4), `/payroll` (5), `/performance`, `/training` (6), `/engagement`, `/grievances`, `/benefits` (7), `/compliance`, `/exits` (8), `/reports` (9) — all following the conventions above.
