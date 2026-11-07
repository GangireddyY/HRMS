# Functional Requirements

Requirement ids: `FR-<area>-<n>`. Status: ✅ implemented · ◻ planned (phase).

## 1. Authentication & sessions

| Id | Requirement | Status |
|---|---|:-:|
| FR-AUTH-1 | Users sign in with email (case-insensitive) and password. Unknown email and wrong password return the same error. | ✅ |
| FR-AUTH-2 | After *threshold* consecutive failures the account locks for *duration* minutes (organization policy; strictest across memberships). Locked attempts are logged and the user is notified. | ✅ |
| FR-AUTH-3 | Users with MFA enabled must complete a TOTP or recovery-code challenge within 5 minutes; codes cannot be replayed; recovery codes are single-use. | ✅ |
| FR-AUTH-4 | On success the user lands in their last-used organization (or first active one); a requested organization is honoured only with an active membership in an active organization. | ✅ |
| FR-AUTH-5 | Sessions refresh silently; a replayed refresh token revokes the session. Sessions expire after the idle timeout and the absolute lifetime of the organization policy. | ✅ |
| FR-AUTH-6 | Users can list their active sessions (device, IP, organization, last activity), sign out one session or all others. | ✅ |
| FR-AUTH-7 | Users see their sign-in history (successes, failures with reason, lockouts, MFA challenges). | ✅ |
| FR-AUTH-8 | Forgot password emails a 30-minute single-use link; the response never reveals whether the account exists; only the latest link is valid; resetting signs out everywhere. | ✅ |
| FR-AUTH-9 | Changing the password requires the current password, enforces policy & history, and signs out other sessions. | ✅ |
| FR-AUTH-10 | Users enrol TOTP via QR/secret, receive 10 recovery codes (copy/download), can regenerate codes, and can disable MFA with password + code unless their organization requires MFA. | ✅ |
| FR-AUTH-11 | When the organization requires MFA (or the password expired), the user can only reach the security page until resolved; a banner explains why. | ✅ |
| FR-AUTH-12 | Users belonging to several organizations switch organization from the top bar; the old token stops working immediately. | ✅ |
| FR-AUTH-13 | SSO (SAML 2.0 / OIDC) per organization. | ◻ 10 |

## 2. Organizations, plans & entitlements

| Id | Requirement | Status |
|---|---|:-:|
| FR-ORG-1 | Self-service registration (when enabled) creates the organization (default plan), provisions system roles and the default security policy, makes the registrant Organization Admin and signs them in. | ✅ |
| FR-ORG-2 | Super Admins create organizations on any active plan and invite the first administrator (existing accounts can join). | ✅ |
| FR-ORG-3 | Organization profile: names, industry, size, contact, registration & tax ids, address, country, time zone (IANA), currency (ISO 4217), locale, date format, fiscal-year start; all changes audited with before/after values. | ✅ |
| FR-ORG-4 | Security policy: password length & character classes, history, max age, lockout threshold/duration, idle timeout, max session lifetime, mandatory MFA (with confirmation). | ✅ |
| FR-ORG-5 | Lifecycle: activate, suspend (reason required), deactivate; suspension/deactivation revokes all sessions and blocks sign-in with a clear message. Invalid transitions are rejected. | ✅ |
| FR-ORG-6 | Plans define name, code, price, currency, user limit and included modules; Super Admins create/edit/deactivate plans. | ✅ |
| FR-ORG-7 | Per-organization overrides force a module on/off regardless of plan; core modules cannot be disabled. | ✅ |
| FR-ORG-8 | Organizations see their plan, user usage vs limit and entitled modules. Inviting beyond the limit is blocked. | ✅ |
| FR-ORG-9 | Branches, locations, departments/sub-departments, designations, grades, cost centers, reporting hierarchy, holidays, working days. | ◻ 2 |

## 3. Users, roles & permissions

| Id | Requirement | Status |
|---|---|:-:|
| FR-RBAC-1 | Each organization receives 11 system roles (see RBAC.md). Organization Admin is locked. | ✅ |
| FR-RBAC-2 | Admins create custom roles and edit permissions per module with a scope per scopable permission (Own/Team/Department/Organization). Non-entitled modules are shown but disabled. | ✅ |
| FR-RBAC-3 | Nobody can grant (to a role or a user) permissions beyond their own access; nobody can change their own roles or suspend themselves; the last active Organization Admin cannot be removed. | ✅ |
| FR-RBAC-4 | Restricted permissions (POSH access) are never part of templates and can only be assigned by role managers. | ✅ |
| FR-RBAC-5 | Changes to roles, assignments, suspensions and entitlements take effect on the next request without re-login. | ✅ |
| FR-RBAC-6 | Menu items, pages and actions the user lacks are hidden; direct navigation shows "Access denied"; the API enforces independently. | ✅ |
| FR-USR-1 | Admins list users with search, status and role filters, sorting and pagination. | ✅ |
| FR-USR-2 | Admins invite users (email, name, roles); invitations can be resent (old link invalidated) or cancelled. | ✅ |
| FR-USR-3 | Admins change roles, suspend/reactivate users, sign out a user's sessions and view their sign-in history. Affected users are notified of role changes. | ✅ |
| FR-RBAC-7 | Record-scope enforcement on business data (own/team/department). | ◻ 2 |

## 4. Audit & notifications

| Id | Requirement | Status |
|---|---|:-:|
| FR-AUD-1 | Every administrative and security event is recorded with actor, organization, entity, summary, field diff (sensitive fields redacted), IP and request id. Records cannot be modified or deleted. | ✅ |
| FR-AUD-2 | Organization auditors/admins browse and filter the audit trail (action, entity, date range, text) and open a detail view with the diff. | ✅ |
| FR-AUD-3 | Super Admins browse the cross-tenant audit trail filtered by organization. | ✅ |
| FR-AUD-4 | Admins review organization sign-in events filtered by outcome, date and email. | ✅ |
| FR-NOT-1 | Users receive in-app notifications (security events, access changes), see an unread badge, mark one/all read, and open linked pages. | ✅ |
| FR-NOT-2 | Email/SMS/push channels, preferences and scheduled reminders via the automation engine. | ◻ 9 |

## 5. User experience

| Id | Requirement | Status |
|---|---|:-:|
| FR-UX-1 | Four workspaces (Platform, Administration, HR Operations, My Workspace) with their own layouts and menus; switcher shows only accessible workspaces. | ✅ |
| FR-UX-2 | Collapsible sidebar (remembered), responsive mobile drawer, light/dark/system theme without flash. | ✅ |
| FR-UX-3 | Global search (Ctrl/⌘+K) across permitted pages, users and (for Super Admins) organizations, fully keyboard operable. | ✅ |
| FR-UX-4 | Data tables with server-side sorting, filtering, pagination, loading skeletons, empty states and error states with retry and request reference. | ✅ |
| FR-UX-5 | Forms show field-level server validation errors, form-level errors, live password-policy checklists; destructive actions require confirmation (type-to-confirm for deletions). | ✅ |
| FR-UX-6 | Accessible components: labelled inputs, focus-trapped modals with Esc, ARIA tabs/menus/switches, skip link, live regions for toasts. | ✅ |

## 6. Later-phase modules

Detailed functional requirements for Recruitment, Onboarding, Attendance, Leave, Payroll, Performance, Training, Engagement, Grievance, Benefits, Compliance, Exit and Reports are written at the start of each phase (task breakdown → requirements → schema → API → UI → tests) and appended here. The permission catalog for all modules already exists so RBAC is stable across phases.

### 6.1 Lifecycle completion (1.10)

| Id | Requirement | Status |
|---|---|:-:|
| FR-EXIT-L1 | HR issues relieving and experience letters once an exit is completed (not for an exit on death), numbered per type, with the text fixed at issue; letters can be revoked with a reason; the employee sees and prints their issued letters. | ✅ |
| FR-EXIT-L2 | Former employees opt in to an alumni directory (contact details they choose, open to rehire); HR and managers with team-wide exit access browse it. | ✅ |
| FR-PAY-L1 | Employees request a loan or salary advance; an approver other than the requester sets amount, tenure, interest (loans) and the first deduction month; payroll pays out, deducts the EMI each run (deferrals and manual repayments possible) and the full & final settlement recovers the balance. | ✅ |
| FR-ATT-L1 | Shifts define an overtime threshold and a minimum that counts; overtime beyond it (all hours on a day off) is recorded per day, approved by the manager in scope and paid in payroll at the organization's multiplier (basic or gross basis); a period can't close with overtime pending. | ✅ |
| FR-ATT-L2 | Employees request work-from-home days (up to a limit); approved days are attendance in WFH mode; office punches are checked against the location's geofence. | ✅ |
| FR-ATT-L3 | HR defines rotation patterns and assigns shifts per day (rotation or manual) for up to 92 days; the roster overrides the default shift for attendance, rest days and leave counting. | ✅ |
| FR-ATT-L4 | Attendance terminals are registered with a secret key (shown once, rotatable) and push batches of punches (up to 500) identified by the employee's biometric code; repeated batches are idempotent. | ✅ |
| FR-BEN-L1 | HR renews a plan for the next policy year as a draft copy; activating it carries active enrolments over (same option or the default, with the dependants it still covers) for employees still eligible. | ✅ |
| FR-TRN-L1 | A skill catalog, skills and levels required per designation and awarded per course; employees self-assess, managers verify, HR sees a skill matrix with gaps. | ✅ |
| FR-PERF-L1 | HR sets merit guidelines (increase % by rating), a budget and an effective date per cycle; reviewers recommend increases for completed reviews (justified outside the guideline); someone with salary-revision rights — never the employee or the recommender — approves or rejects; approved increases are applied as salary revisions. Salary amounts are shown only with salary access. | ✅ |
| FR-REC-L1 | Recruiters fill the candidate form from a resume (PDF or .docx): name, email, phone, LinkedIn, current title and company, experience, notice period, location and skills; candidates keep a skills list (filled from the first resume, editable, searchable). | ✅ |
| FR-REP-L1 | Every report exports as CSV, an Excel workbook (summary sheet and a sheet per table with typed cells) or a PDF (headline figures and tables), with the same permissions and audit as CSV. | ✅ |
