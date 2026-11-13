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

## 3. Module resource roots

`/employees`, `/recruitment`, `/careers` (public), `/onboarding`, `/attendance`, `/leaves`, `/payroll`, `/performance`, `/training`, `/skills`, `/engagement`, `/grievances`, `/benefits`, `/compliance`, `/exits`, `/alumni`, `/reports` — all following the conventions above. The full, always-current reference (every route, DTO and permission) is the OpenAPI document served at `/api/docs` (`/api/docs/openapi.json`); the tables below list the endpoints added in 1.10.

### Integrations for other tools

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/integrations/webhooks` | `integration.manage` | `format`: `JSON` (signed event, default), `SLACK` or `TEAMS` (chat message to an incoming-webhook URL; returned masked, no secret) |
| GET | `/careers/:slug/jobs.xml` | 🔓 | Open public jobs as an XML job feed (Indeed format) for job boards and aggregators |
| GET | `/payroll/runs/:id/tally` | `payroll.view` | Payroll journal as Tally XML vouchers |

### Statutory rates

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/platform/statutory-rates` | `platform.statutory.manage` | PF / ESI rates by effective date (in force now, scheduled), income-tax rules per financial year (entered, built in or borrowed) |
| PUT | `/platform/statutory-rates/contribution` | `platform.statutory.manage` | Add or change the rates in force from `effectiveFrom` |
| DELETE | `/platform/statutory-rates/contribution/:id` | `platform.statutory.manage` | Remove a set of rates (the previous set applies again) |
| PUT · DELETE | `/platform/statutory-rates/tax/:fy` | `platform.statutory.manage` | Enter or remove a financial year's income-tax rules (`2027` = FY 2027-28) |
| GET | `/payroll/statutory-rates?year=&month=` | `payroll.view` or `payroll.configure` | What payroll uses for that month |

### 1.10 additions

| Method | Path | Access | Description |
|---|---|---|---|
| GET · POST | `/exits/:id/letters` | `exit.manage` (employee: own, issued only) | Relieving / experience letters of an exit; issue one (numbered, snapshot of the text) |
| GET | `/exits/:id/letters/draft` | `exit.manage` | Draft text of a letter type, with what still blocks it |
| GET · POST | `/exits/:id/letters/:letterId` · `…/revoke` | `exit.manage` / subject | One letter; revoke with a reason |
| GET | `/alumni` | `exit.manage` or `exit.view` ≥ TEAM | Alumni directory (opted-in former employees) |
| GET · PUT | `/alumni/me` | 🔑 former employee | Own alumni profile and consent |
| GET · POST | `/payroll/me/loans` | `payroll.loan.apply` | Own loans and advances; request one |
| GET · POST | `/payroll/loans` | `payroll.loan.approve` / `payroll.loan.manage` | All requests; raise one for an employee |
| GET | `/payroll/loans/first-month` · `/payroll/loans/:id` | as above | First open payroll month; one loan with schedule and repayments |
| POST | `/payroll/loans/:id/approve` · `reject` · `cancel` · `disburse` · `defer` · `repayments` | approve / manage | Lifecycle (approver ≠ requester); instalments are deducted by payroll runs and recovered in full & final settlements |
| GET | `/attendance/overtime` · POST `…/:id/approve` · `…/:id/reject` | `attendance.view` / `attendance.regularize.approve` in scope | Overtime worked beyond the shift; approved minutes are paid by payroll (`OVERTIME` earning) |
| GET · POST | `/attendance/work-from-home` · POST `…/:id/approve` · `reject` · `cancel` | `attendance.view`, `attendance.wfh.apply` / `attendance.regularize.approve` in scope | Work-from-home requests (punches outside the geofence are allowed on approved days) |
| GET · POST · PATCH · DELETE | `/attendance/rotations[/:id]` | `attendance.configure` | Shift rotation patterns |
| GET | `/attendance/roster` · POST `…/assign` · `…/apply-rotation` · `…/clear` | view / `attendance.configure` | Roster of shift assignments by day (overrides the default shift) |
| GET · POST · PATCH · DELETE | `/attendance/devices[/:id]` · POST `…/:id/rotate-key` | `attendance.configure` | Biometric / attendance terminals and their API keys (shown once) |
| POST | `/attendance/device/punches` | 🔓 `X-Device-Key` | Devices push up to 500 punches (employee biometric code, time, direction); idempotent |
| POST | `/benefits/plans/:id/renew` | `benefits.manage` | Draft of next year's plan (options copied); activating it carries enrolments over |
| GET · POST · PATCH · DELETE | `/skills[/:id]` | 🔑 member / `training.manage` | Skill catalog |
| GET `/skills/requirements/all` · PUT `/skills/requirements/:designationId` | | 🔑 member / `training.manage` | Skills (and levels) each designation needs |
| GET · PUT | `/skills/courses/:courseId` | 🔑 member / `training.manage` | Skills a course awards on completion |
| GET · PUT | `/skills/me/profile` · DELETE `…/:skillId` | `training.view` | Own skills (self-assessed levels) and gaps for the role |
| GET | `/skills/matrix/view` · `/skills/employees/:id` | `training.view` in scope | Skill matrix (people × skills) and one employee's skills |
| POST | `/skills/employees/:employeeId/:skillId/verify` | manager in scope or `training.manage` | Confirm a level (never one's own) |
| GET · PUT | `/performance/cycles/:id/compensation` | `performance.configure` (read: also `employee.salary.revise`) | Merit guidelines per rating, budget % and effective date; counts and budget use (amounts with org-wide salary access) |
| GET | `/performance/cycles/:id/hikes` | reviewer / HR | Completed reviews with their increase recommendation (`view=mine\|all`, `status`) |
| PUT | `/performance/reviews/:reviewId/hike` | the reviewer or `performance.configure` | Recommend an increase (a justification is needed outside the guideline) |
| POST | `/performance/hikes/:id/submit` · `approve` · `reject` | recommender / `employee.salary.revise` | Submit; approve (optionally a different %) or reject with a reason — never one's own or one recommended by the approver |
| POST | `/performance/cycles/:id/hikes/apply` | `employee.salary.revise` | Approved increases become salary revisions from the effective date (`{applied, failed}`) |
| POST · DELETE | `/auth/me/avatar` | 🔑 R | Own profile photo (multipart `file`: PNG, JPEG or WebP, ≤ 5 MB; stored as a 256 × 256 WebP) |
| GET | `/users/:id/avatar?v=…` | 🔓 (needs the photo URL's `v`) | Profile photo image |
| POST | `/recruitment/resumes/parse` | `recruitment.manage` | Multipart `file` (PDF / .docx, ≤ 5 MB): details read from a resume to prefill the candidate form (`{parsed, readable}`); the file isn't kept |
| GET | `/reports/:key/export?format=csv\|xlsx\|pdf` | `reports.export` + the report's permission | CSV (tables), Excel (summary sheet + a sheet per table, typed cells) or PDF (A4 landscape with the headline figures) |

### Approval chains, channels, schedules, calendars, compensation, entities and the AI assistant

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/approvals/waiting` | 🔑 member | Requests waiting at an approval-chain step you decide (or cover), across leave, expenses, travel, resignations and offers |
| GET | `/recruitment/offers/awaiting-approval` | 🔑 member (recruitment on) | Offers waiting for your approval (your chain step, or any pending offer with `recruitment.offer.approve`) |
| POST | `/travel/requests/:id/approve` · `reject`, `/exits/:id/approve`, `/recruitment/offers/:id/approve` · `reject-approval` | on a chain: its current step's approvers; otherwise as before | One decision; middle steps keep the request pending and notify the next approvers |
| POST | `/notifications/whatsapp/verify` · `confirm` · `remove` | 🔑 R | Send a 6-digit code to a WhatsApp number (3 an hour), confirm it (messages switch on), or remove it |
| PUT | `/notifications/settings` | 🔑 R | Adds `emailDigest` (`OFF` / `DAILY` / `WEEKLY`), `digestHour`, `digestDay`, `timezone`, `whatsapp`, `calendarInvites` |
| GET · POST | `/reports/schedules` | `reports.view` + `reports.export` | Your scheduled report emails; schedule one of your saved reports (frequency, day, hour, format, rolling period, member recipients) |
| PUT · DELETE · POST | `/reports/schedules/:id` · `…/send` | owner | Edit, delete or send now (each recipient gets only their own rows) |
| GET | `/reports/schedules/recipients?q=` | `reports.view` + `reports.export` | Members to pick as recipients |
| GET · POST | `/calendar/feed` · `/calendar/feed/remove` | 🔑 member | Whether you have a calendar feed; a new private feed URL (shown once) or switch it off |
| GET | `/calendar/feed/:token.ics` | 🔓 the URL's secret | iCalendar feed: your leave, team leave, 1:1s, interviews, holidays |
| GET · PUT | `/performance/cycles/:id/budgets` | `performance.configure` or `employee.salary.revise` (+ org-wide salary access); write: `performance.configure` | Increase pools per department with planned / committed / remaining; set all pools |
| POST | `/performance/hikes/:id/approve` | `employee.salary.revise` | Adds `overBudget: true` to approve beyond the department's pool (audited); without it, 409 |
| GET · POST · PUT · DELETE | `/performance/succession[/:id]` | view: `performance.succession.view` in scope; write: `performance.succession.manage` | Succession plans with bench strength (never your own role's plan unless you manage) |
| POST · PATCH · DELETE | `/performance/succession/:id/successors[/:candidateId]` | `performance.succession.manage` | Name successors, change readiness / rank / notes, remove |
| GET · POST · PUT · DELETE | `/legal-entities[/:id]` | 🔑 member; write: `organization.update` | Legal entities (country, currency, registrations, default) |
| POST | `/legal-entities/assign` | `organization.update` + `employee.update` | Move employees to an entity (null = default) |
| GET · PUT · DELETE | `/exchange-rates[/:id]` | 🔑 member; write: `payroll.configure` | Exchange rates into the base currency by date (the rate in force per currency) |
| GET · PUT | `/assistant/status` · `/assistant/settings` | 🔑 member; write: `organization.update` | Whether AI answers are on; turn them on or off for the organization |
| POST | `/assistant/chat` | 🔑 member (20 / minute) | `{messages}` → `{mode: 'ai', text, links, sources}` or `{mode: 'fallback', reason}` |
| POST | `/notifications/push/native` · `…/native/remove` | 🔑 R | Phone app install: `{platform: ANDROID \| IOS, token, deviceName?, appVersion?}` registers it for your notifications (409 when that platform isn't configured); remove on sign-out. `GET /notifications/push` adds `nativeEnabled`, `nativePlatforms`, `apps` |
| GET · PUT | `/payroll/accounting` | `payroll.view` or `payroll.configure`; write: `payroll.configure` | Ledger names per posting, earning components with their own ledger, Tally company, voucher type, department cost centres |
| GET | `/payroll/runs/:id/journal` | `payroll.view` | Balanced journal of an approved or paid run (409 before approval, or when a run pays in several currencies) |
| GET | `/payroll/runs/:id/tally?part=vouchers\|masters` | `payroll.view` | Tally import XML: the journal voucher (`REMOTEID` = the run, so Tally refuses a second import), or the ledger and cost-centre masters it uses; audited |
