# Design decisions

Architecture decision records: the choices that shape HRMS, why they were made, and what they cost. Read these
before changing one of these areas. To change a decision, add a new record that supersedes the old one rather than
editing history. For how the pieces fit together see [ARCHITECTURE.md](ARCHITECTURE.md); for security detail,
[SECURITY.md](SECURITY.md).

| # | Decision | Status |
|---|---|---|
| 1 | [One modular application, one database](#1-one-modular-application-one-database) | Accepted |
| 2 | [Shared contracts between backend and frontend](#2-shared-contracts-between-backend-and-frontend) | Accepted |
| 3 | [Tenant isolation in three layers](#3-tenant-isolation-in-three-layers) | Accepted |
| 4 | [Field-level encryption with envelope keys](#4-field-level-encryption-with-envelope-keys) | Accepted |
| 5 | [Background jobs in PostgreSQL](#5-background-jobs-in-postgresql) | Accepted |
| 6 | [The audit log is the event stream](#6-the-audit-log-is-the-event-stream) | Accepted |
| 7 | [Approval chains are snapshotted per request](#7-approval-chains-are-snapshotted-per-request) | Accepted |
| 8 | [Short-lived tokens in memory, refresh in a cookie](#8-short-lived-tokens-in-memory-refresh-in-a-cookie) | Accepted |
| 9 | [External services behind switchable adapters](#9-external-services-behind-switchable-adapters) | Accepted |
| 10 | [Plain SQL migrations that always roll back](#10-plain-sql-migrations-that-always-roll-back) | Accepted |
| 11 | [One web app for browser, PWA and phone app](#11-one-web-app-for-browser-pwa-and-phone-app) | Accepted |
| 12 | [Slack and Teams as webhook formats](#12-slack-and-teams-as-webhook-formats) | Accepted |

---

## 1. One modular application, one database

**Context.** HR data is deeply connected: a leave approval changes balances, attendance, payroll and notifications at
once. The team is small.

**Decision.** A single NestJS API split into feature modules (`backend/src/modules/*`), each owning its services,
controllers and DTOs, over one PostgreSQL database. Modules talk through exported services, not HTTP. The Vue
frontend mirrors the same modules (`frontend/src/modules/*`).

**Consequences.** One transaction covers a whole business change, so there are no partial updates or distributed
sagas. Deploys are one image per app. Scaling is horizontal (more API instances behind a load balancer); a module can
still be split out later because its boundary is already a NestJS module. The cost is discipline: modules must not
reach into each other's models without going through the owning service.

## 2. Shared contracts between backend and frontend

**Context.** Permission keys, statuses, enums and validation rules drift when written twice.

**Decision.** They live once in `backend/src/contracts`. The backend imports them directly and the frontend compiles
the same files through the `@contracts` alias.

**Consequences.** A renamed status or permission fails the frontend typecheck immediately. Contracts must stay free
of Node or NestJS imports so they compile in the browser.

## 3. Tenant isolation in three layers

**Context.** Many organizations share one database. A missing `WHERE organization_id = …` must never leak another
company's employees.

**Decision.**
1. **Application:** Sequelize hooks add the current tenant to every query on tenant tables and fail closed when there
   is none. Cross-tenant work (jobs, sign-in) must opt out explicitly with `skipTenantScope`.
2. **Schema:** composite foreign keys include `organization_id`, so a row cannot point at another tenant's row.
3. **Database:** PostgreSQL row-level security, forced even for the table owner, on every tenant table. Each
   connection sets `app.organization_id` (`src/database/row-level-security.ts`), and the policy only shows that
   tenant's rows.

**Consequences.** A bug in one layer is caught by the next. New tenant tables must be added to `TENANT_MODELS` and get
a policy; `row-level-security.e2e-spec.ts` fails otherwise. Tools that read the database directly need
`--enable-row-security` (see `scripts/db-backup.sh`).

## 4. Field-level encryption with envelope keys

**Context.** PAN, Aadhaar, bank accounts, passport numbers and grievance details must stay unreadable in a database
dump or backup.

**Decision.** AES-256-GCM per field. The ciphertext is bound to its table, column and row (associated data), so it
can't be copied to another row. Keys are versioned. In production the data key is wrapped by AWS KMS
(`DATA_ENCRYPTION_KEY_SOURCE=aws-kms`). Every encrypted column is listed in `ENCRYPTED_FIELDS`, which the
re-encryption job walks after a key rotation.

**Consequences.** Encrypted fields can't be searched or sorted in SQL, so only identifiers and secrets are encrypted,
not the names and dates people search by. Adding an encrypted column means adding it to the registry.

## 5. Background jobs in PostgreSQL

**Context.** Emails, pushes, webhooks, reminders and scheduled reports must happen only if the change that caused
them commits, and must survive restarts.

**Decision.** Jobs are rows in `background_jobs`, inserted in the same transaction as the business change. Every API
instance polls and claims work with `FOR UPDATE SKIP LOCKED`; failures retry with backoff (30 s up to 6 h), then are
kept as FAILED and reported in metrics.

**Consequences.** No second datastore to run or keep consistent, and no "email sent for a rolled-back change". It
won't match a dedicated broker at very high volume; if that day comes, the `JobQueueService` interface is the seam
to swap.

## 6. The audit log is the event stream

**Context.** HR needs a complete who-did-what trail, and integrations need events.

**Decision.** Every meaningful change calls `AuditService.record` inside its transaction. The `audit_logs` table is
append-only (a database trigger refuses updates and deletes), archives go to write-once storage (S3 Object Lock),
and webhooks, Slack and Teams alerts subscribe to the audit stream instead of separate event calls.

**Consequences.** An action that isn't audited can't be sent to integrations, which keeps the two consistent.
Sensitive groups (sign-ins, grievances, privacy, audit itself) are excluded from integrations by prefix.

## 7. Approval chains are snapshotted per request

**Context.** Approval rules change (a new finance approver, a lower limit), but a request already in flight must
finish under the rules it started with.

**Decision.** `approval_chains` define levels, conditions and time limits per subject (leave, expense, travel, exit,
offer). Starting an approval copies the matching chain into `approval_instances`. Decisions, delegation and SLA
escalation work on the instance.

**Consequences.** Editing a chain never changes requests already submitted. Being on a chain is never enough on its
own: an approver must also hold that kind of request's approve permission (`APPROVAL_DECIDE_PERMISSIONS`, any scope).
Chains naming someone without it are refused, people without it are left out of a step when it starts (a step left
empty is skipped), and someone who loses the permission can no longer decide. The approve routes require the
permission too, so a chain can widen *whose* requests an approver decides, never *who* may approve.

## 8. Short-lived tokens in memory, refresh in a cookie

**Context.** Tokens in `localStorage` can be stolen by any injected script.

**Decision.** The access token lives only in memory and expires quickly. The refresh token is an httpOnly, SameSite
cookie that rotates on every use; reusing an old one revokes the whole session family. Sensitive actions (bank file,
statutory exports) need a recent MFA check (step-up).

**Consequences.** A page reload silently refreshes the session. A strict CSP with nonces and HSTS complete the
picture.

## 9. External services behind switchable adapters

**Context.** Email, WhatsApp, push, KMS, object storage, SSO and the AI assistant must not be called from development
or tests, and providers change.

**Decision.** Each sits behind a service with a mode from configuration: `off`, `log` (development) or a real provider
(SMTP, Meta WhatsApp, FCM / APNs, AWS KMS, S3, an OIDC provider, an LLM). Tests use local stand-ins, such as an HTTP
receiver for webhooks.

**Consequences.** The whole suite runs offline. Each real provider still needs a check in a staging environment with
real credentials before go-live.

## 10. Plain SQL migrations that always roll back

**Context.** Schema changes on HR and payroll data must be reviewable and reversible.

**Decision.** Every migration is a pair of SQL files (`*.up.sql`, `*.down.sql`). CI applies all of them, rolls back
to an empty database, and applies them again.

**Consequences.** What runs in production is exactly what was reviewed. A down script is mandatory; data-destroying
downs are acceptable only when the up created that data.

## 11. One web app for browser, PWA and phone app

**Context.** Employees mostly use phones; maintaining a separate native app would double the work.

**Decision.** One responsive Vue app. It installs as a PWA (offline punch queue, Web Push), and the Android / iOS
store apps are a Capacitor shell around the hosted site with native push and location (see [MOBILE.md](MOBILE.md)).

**Consequences.** Every deploy reaches all platforms at once and security stays the same as the web. Deep native
features are limited to what Capacitor plugins provide.

## 12. Slack and Teams as webhook formats

**Context.** Customers want HR events in Slack or Teams channels. Webhooks already had event selection, a queue,
retries, a delivery log and auto-disable.

**Decision.** Slack and Teams are a `format` of a webhook rather than a new module. Delivery builds a chat message (a
Slack message, a Teams adaptive card) instead of signed JSON. Their incoming-webhook URL is a credential, so it is
encrypted (`url_encrypted`) and only a masked copy is stored in `url`, shown or audited.

**Consequences.** One delivery pipeline to operate, and other chat tools can be added as further formats. The format
is fixed when a webhook is created.
