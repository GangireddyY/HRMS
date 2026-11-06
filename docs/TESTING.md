# Testing

A module is complete only when its database, API, UI and tests are done and green — rendering pages is not enough.

## 1. Test pyramid

| Layer | Tool | Location | What it covers |
|---|---|---|---|
| Contracts | Jest (backend unit suite) | `backend/src/contracts/contracts.spec.ts` | Permission catalog integrity, role templates (no restricted grants, segregation of duties, scope merging), password policy validation & combination |
| Backend unit | Jest + ts-jest | `backend/src/**/*.spec.ts` | Tenant-scope helpers (AND-scoping, fail-closed, opt-out, row tenant assignment) + `TENANT_MODELS` coverage via model attributes, AES-GCM encryption & tamper detection, Argon2id, token helpers, permission folding, entitlements, escalation rules, security-policy combination, audit diff/redaction, sort whitelists |
| Backend integration | Jest + Supertest + **real PostgreSQL** | `backend/test/*.e2e-spec.ts` | Full HTTP stack (guards, pipes, filters, Sequelize hooks) against `hrms_test`; database reset between tests |
| Frontend unit | Vitest + Vue Test Utils + jsdom | `frontend/src/**/*.spec.ts` | HTTP client (envelope, error mapping, refresh-and-retry, session end), auth store (scopes, MFA flow, single-flight refresh), navigation access rules & landing pages, theme store (defaults, persistence, invalid values, OS changes), AppDataTable states/sorting, password checklist, redirect safety |
| End-to-end | Playwright (Chromium) at three sizes: `desktop` (1280×720), `tablet` (Galaxy Tab S4, 712×1138), `mobile` (Pixel 7, 412×839) | `frontend/e2e/*.spec.ts` | Built backend (test mode) + Vite dev server + migrated test DB seeded with plans and the Super Admin only. A `setup` project (`org-admin.setup.ts`) creates the Organization Admin through organization sign-up (`E2E_ORG_ADMIN_*`, idempotent) before the device projects run. Covers organization sign-up through the UI (owner becomes Organization Admin), sign-in/out, redirects, session persistence, role & permission editing, invitations, server validation, global search, access denial, platform administration, themes; `responsive.spec.ts` asserts no page-level horizontal overflow on every page and exercises the navigation drawer (screenshots saved under `test-results/`) |

## 2. Integration suites

| Suite | Scenarios (positive & negative) |
|---|---|
| `auth.e2e-spec.ts` | Login success/cookie flags; case-insensitive email; identical errors for unknown user/wrong password; validation & unknown-field rejection; lockout + login history + audit; no-organization and disabled accounts; forged tokens; refresh rotation and **replay ⇒ revocation**; logout; session listing/revocation (and cannot revoke others'); password reset (enumeration-safe, policy, history, single-use, expiry, latest-token-only, sessions revoked); change password; profile updates & mass-assignment; **rate limiting** |
| `mfa.e2e-spec.ts` | Enrolment (bad code, encrypted secret, recovery codes); login challenge; **TOTP replay rejected**; recovery codes single-use; wrong-purpose challenge tokens; disable requires password + code; org-mandated MFA restricts the session until enrolment and blocks disabling |
| `rbac.e2e-spec.ts` | 11 system roles provisioned; employees denied admin endpoints; role changes effective immediately; scope normalisation; unknown permissions rejected; **privilege escalation** blocked (invite/assign/manage more-privileged users); locked/system role protection; roles in use cannot be deleted; **last-admin** guard (even for an all-permissions custom role); suspension blocks immediately, reactivation restores; invitation accept/duplicate/reuse; existing account joins second org; resend/cancel; plan user limit; entitlement gating; pagination/search/sort whitelist |
| `tenant-isolation.e2e-spec.ts` | Lists contain only own-tenant rows; **every read/write endpoint returns 404 for another tenant's ids** with no side effects; foreign role ids rejected; client-supplied org ids rejected without membership; multi-org switching invalidates stale tokens and applies per-org roles; audit/login history scoped; composite FK blocks cross-tenant role assignment in the DB; audit trail append-only in the DB; tenant models **fail closed** without context (find, count, update, destroy); auto-scoping with context (foreign filters/PKs return nothing); **cross-tenant create/update/save rejected by hooks** |
| `platform.e2e-spec.ts` | Super Admin without tenant context; org admins denied platform endpoints; provisioning + admin invitation + acceptance; unique slugs; suspension revokes sessions and blocks login, invalid transitions, activation; plans CRUD with duplicate detection; feature overrides (on/off/clear, core protected); filters |
| `organization.e2e-spec.ts` | Profile read/update, validation (time zone, currency, month), clearing fields, audit diff; role-restricted updates; security policy validation and enforcement on password change; subscription & overview metrics; self-service registration (success, duplicates, weak password, invalid input); notifications ownership & read state; health + request id |

Migrations are also exercised end-to-end in CI (`up` → three `down`s → `up` on an empty database).

## 3. Running tests

```bash
npm run test                           # backend unit + backend integration + frontend unit (from the root)
cd backend  && npm test                # backend unit (includes src/contracts catalog & role-template tests)
cd backend  && npm run test:e2e        # backend integration (requires backend/.env.test → *test* database)
cd frontend && npm test                # frontend unit
npm run test:e2e:frontend              # builds the backend, then Playwright (backend :3001, frontend :5174)
```

Safety: integration and E2E setups refuse to run unless the database name contains `test`. `backend/.env.test` holds test-only secrets, the seeded Super Admin (`SUPERADMIN_*`) and the e2e organization owner (`E2E_ORG_ADMIN_*`) (git-ignored; CI generates it with random values).

## 4. Current results

| Suite | Tests |
|---|---|
| Backend unit (incl. 17 contracts tests) | 63 ✅ |
| Backend integration | 73 ✅ |
| Frontend unit | 45 ✅ |
| Playwright E2E (setup + 20 specs × desktop, tablet, phone) | 60 ✅ · 1 skipped (drawer test on desktop) |

## 5. Conventions for upcoming phases

* Calculation engines (attendance, leave accrual, payroll, statutory) are pure services with **table-driven tests** and golden files for payroll; every rule is effective-dated and tested across boundary dates.
* Each new tenant model must be added to `TENANT_MODELS` (enforced by test) and get isolation cases in `tenant-isolation.e2e-spec.ts`.
* Each new permission must appear in at least one authorization test (allowed + denied).
