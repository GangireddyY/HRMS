# Product Requirements – Enterprise HRMS

## 1. Vision

A secure, multi-tenant HR platform that runs the complete employee lifecycle — **Recruitment → Hiring → Onboarding → Employment → Attendance → Leave → Payroll → Performance → Training → Benefits → Exit** — for small businesses through large enterprises, IT/consulting firms and recruitment agencies, each with fully isolated data.

## 2. Target customers & personas

| Segment | Needs |
|---|---|
| Small businesses | Fast self-service setup, sensible defaults, Starter plan |
| Mid-size / IT / consulting | Multiple branches, project-style teams, configurable approvals, Indian statutory payroll |
| Recruitment agencies | High-volume pipelines, candidate database, duplicate detection |
| Large enterprises | Multi-entity tenancy, granular RBAC, SSO-ready identity, audit, data residency |

| Persona | Primary workspace |
|---|---|
| Super Admin (platform operator) | Platform |
| Organization Admin | Administration |
| HR Director / Manager / Executive, Recruiter, Payroll & Finance Managers | HR Operations |
| Department Manager, Team Lead | HR Operations (team/department scope) + My Workspace |
| Employee | My Workspace (self-service) |
| Auditor | Read-only across permitted modules |

## 3. Product principles

1. **Tenant isolation is non-negotiable** — enforced in API, ORM and database.
2. **Least privilege** — configurable roles, record scopes, restricted permissions, segregation of duties.
3. **No fake functionality** — every screen is backed by real APIs, validation and tests; no placeholder modules.
4. **Configurable, effective-dated rules** — no hard-coded statutory rates, policies or calendars.
5. **Auditability** — every administrative change is attributable and immutable.

## 4. Scope by phase (milestones)

| Phase | Milestone | Key deliverables | Exit criteria |
|---|---|---|---|
| **1** | Foundation | Monorepo, CI, auth (login, MFA, sessions, password policy, reset, invites), tenancy, plans & entitlements, RBAC, audit, notifications, design system, four workspaces | ✅ All suites green (see §6) |
| 2 | Organization & Employee | Branches, locations, departments, designations, grades, cost centers, hierarchy, holidays, working days; employee master (all profile sections), encrypted bank/statutory data, documents (S3), import/export, lifecycle changes with history; record-scope enforcement | CRUD + history + scope tests; import of 10k rows |
| 3 | Recruitment & Onboarding | Requisitions & approvals, jobs, career portal, candidates, resume upload/parsing, duplicates, interviews, offers, candidate→employee conversion, checklists, probation | Pipeline E2E from requisition to joined |
| 4 | Attendance & Leave | Shifts/rotations, punches, rules engine (grace, late, early, OT, breaks), regularization, WFH/GPS, biometric interface, monthly close; leave types/policies, accrual, carry-forward, encashment, approvals, calendars | Calculation test suites (edge cases, DST, night shifts) |
| 5 | Payroll engine | Structures/components, effective-dated statutory rules (PF, ESI, PT, TDS), LOP, OT, arrears, loans, reimbursements, run state machine, validation, payslips, bank files, F&F | Golden-file payroll tests; immutability of approved runs |
| 6 | Performance & Training | Cycles, goals/KPIs, self/manager/peer/360, PIPs, hike recommendations; courses, sessions, assessments, certifications, skill matrix | Cycle E2E |
| 7 | Engagement, Grievance, Benefits | Announcements, events, surveys, recognition; confidential/anonymous cases with POSH IC access; benefit plans, eligibility, enrolment, renewals | POSH access tests |
| 8 | Compliance & Exit | Policies with versions & acknowledgements, document expiry, compliance calendar, access logs; resignation → clearances → F&F → letters → alumni | Exit E2E |
| 9 | Analytics & Automation | Role dashboards, reports with filters & CSV/Excel/PDF export; BullMQ automation engine (reminders, notifications) with retries, idempotency, monitoring | Job reliability tests |
| 10 | Hardening & Release | Security audit, RLS, Redis-backed rate limits, performance tuning, load tests, backup drills, deployment automation | Pen-test findings closed |

## 5. Non-functional requirements

| Area | Target |
|---|---|
| Availability | 99.9 % monthly (stateless API, horizontally scalable) |
| Performance | p95 < 300 ms for interactive APIs at 200 rps; list endpoints paginated (≤ 100) |
| Scale | 1,000+ tenants; 100k employees per tenant |
| Security | OWASP ASVS L2; see SECURITY.md |
| Accessibility | WCAG 2.1 AA for core flows |
| Browsers | Latest Chrome, Edge, Firefox, Safari |
| Localisation | Org-level time zone, currency, date format, fiscal year (Phase 1); UI i18n (Phase 10) |

## 6. Phase 1 implementation checklist

| # | Item | Status |
|---|---|:-:|
| 1 | Repository with two independent applications (`backend`, `frontend`; shared contracts in `backend/src/contracts`), pinned compatible versions | ✅ |
| 2 | Environment validation, typed config, `.env.example`, secrets git-ignored | ✅ |
| 3 | Sequelize models + SQL migrations via Umzug (UUIDs, snake_case, timestamps, actor columns, composite tenant FKs, append-only audit trigger) | ✅ |
| 4 | Consistent response envelope, central exception filter, validation pipe, pagination/sorting/filter helpers, request ids | ✅ |
| 5 | Tenant-scope Sequelize hooks (auto-scoping, fail-closed, explicit opt-out) + coverage test | ✅ |
| 6 | Login, logout, refresh rotation with reuse detection, session management, login history | ✅ |
| 7 | Password policies (per org, strictest-of), history, expiry, lockout | ✅ |
| 8 | Forgot/reset password, invitation acceptance (new & existing accounts) | ✅ |
| 9 | TOTP MFA with recovery codes, replay protection, org-mandated MFA (restricted sessions) | ✅ |
| 10 | Organization registration (self-service + platform-provisioned), profile, regional settings, security policy | ✅ |
| 11 | Plans, features, per-organization entitlement overrides, user limits | ✅ |
| 12 | Organization lifecycle (activate/suspend/deactivate) with session revocation | ✅ |
| 13 | Permission catalog (92 permissions, 15 modules), 11 org roles + Super Admin, catalog sync | ✅ |
| 14 | Roles API (custom roles, scoped grants, locked roles), escalation prevention, last-admin guard | ✅ |
| 15 | User administration (invite, roles, suspend/reactivate, revoke sessions, history) | ✅ |
| 16 | Audit trail with diffs & redaction; org and platform audit views | ✅ |
| 17 | In-app notifications (security & access events) | ✅ |
| 18 | Rate limiting, helmet, CORS, trust-proxy, body limits | ✅ |
| 19 | Design system (forms, tables, modals, confirm, toasts, skeletons, empty/error states, charts, tabs, menus) with light/dark themes | ✅ |
| 20 | Four workspace layouts, permission-filtered navigation, global search, notifications bell, org & workspace switchers | ✅ |
| 21 | Auth pages, ESS (home, profile, security, notifications), Admin (dashboard, settings, users, roles, audit, login history), HR dashboard, Platform (dashboard, orgs, plans, audit) | ✅ |
| 22 | Tests: shared, API unit, API integration (auth, MFA, RBAC, tenant isolation, platform, organization), web unit, Playwright E2E | ✅ |
| 23 | Dockerfiles, docker-compose stack, GitHub Actions CI, production bootstrap command | ✅ |
| 24 | Documentation set | ✅ |

### Acceptance results (Phase 1)

| Suite | Result |
|---|---|
| Shared catalog & policy (Vitest) | 17 passed |
| Backend unit (Jest) | 46 passed |
| Backend integration (Jest + Supertest + PostgreSQL, Sequelize) | 73 passed |
| Frontend unit (Vitest) | 35 passed |
| End-to-end (Playwright, Chromium) | 12 passed |
| Typecheck API / web | clean |

## 7. Known gaps & blockers carried forward

* **Redis**: the local Windows Redis is 3.0.504; BullMQ requires ≥ 6.2. Use the Redis 7 container (or Memurai) before Phase 9. Rate limiting is in-memory until then (single instance).
* **Docker** is not installed on the development machine; Dockerfiles/compose are written and built in CI but not yet executed locally.
* **Email**: SendGrid only. Without `SENDGRID_API_KEY` in development, emails are printed to the API log.
* **Record-scope enforcement** (OWN/TEAM/DEPARTMENT filters) is modelled and stored; it is applied to queries once employees and reporting lines exist (Phase 2).
* **RLS**, Redis-backed throttling, i18n and SSO (SAML/OIDC) are scheduled for Phase 10.
