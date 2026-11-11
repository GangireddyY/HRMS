# Deployment & Operations

## 1. Local development (without Docker)

Prerequisites: Node.js 22+ (developed on 24), npm 10+, PostgreSQL 16+ running locally, (Redis 7 for Phase 9).

### Environment files

Each application owns its environment files. Real values are git-ignored; `*.example` templates are committed.

| File | Used by | Contents |
|---|---|---|
| `backend/.env` ← `backend/.env.example` | backend dev server, migrations, seed | database, secrets, mail (SendGrid), seed accounts |
| `backend/.env.test` ← `backend/.env.test.example` | backend integration tests, Playwright backend | test database (name must contain `test`), test secrets, e2e seed accounts |
| `backend/.env.docker` ← `backend/.env.docker.example` | `migrate` + `backend` containers | app secrets including `SENDGRID_*` (required: the stack runs in production mode); DB/Redis settings are injected by compose |
| `frontend/.env` ← `frontend/.env.example` | Vite dev server | `VITE_API_BASE_URL`, `VITE_APP_NAME`, `DEV_SERVER_PORT`, `DEV_API_PROXY_TARGET` |
| `frontend/.env.e2e` (committed) | `vite --mode e2e` for Playwright | port 5174, proxy to the test backend on :3001 |
| `frontend/.env.production` (committed) | `vite build` | public build-time values |
| `.env.docker` ← `.env.docker.example` (root) | docker compose | infrastructure secrets only (Postgres, Redis, MinIO) |

`VITE_*` variables are compiled into the browser bundle, so the frontend never holds secrets.

```bash
npm run install:all              # npm install in backend/ and frontend/ (each has its own lock file);
                                 # npm 11 only runs install scripts listed in each package.json "allowScripts"
cp backend/.env.example backend/.env             # fill DB_*, JWT_ACCESS_SECRET, DATA_ENCRYPTION_KEY, SUPERADMIN_*
cp backend/.env.test.example backend/.env.test   # test database + test secrets
cp frontend/.env.example frontend/.env
# Create a least-privilege DB role that owns the databases:
#   CREATE ROLE hrms LOGIN PASSWORD '...'; CREATE DATABASE hrms_dev OWNER hrms; CREATE DATABASE hrms_test OWNER hrms;
npm run db:migrate               # Sequelize/Umzug SQL migrations
npm run db:seed                  # plans + the Super Admin (SUPERADMIN_*); no organizations
npm run dev:backend              # backend :3000 (watch)
npm run dev:frontend             # second terminal: frontend :5173 (Vite proxy → API)
```

Open http://localhost:5173 and sign in with `SUPERADMIN_*` (platform console). Organizations are created by their owners at http://localhost:5173/register (requires `ALLOW_ORGANIZATION_SIGNUP=true`): the person who signs up becomes the **Organization Admin** and is signed straight in. The Super Admin can also create organizations from the platform console, which emails an invitation to the organization's first admin.
Swagger UI: http://localhost:3000/api/docs.

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # JWT_ACCESS_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # DATA_ENCRYPTION_KEY
```

### Email (SendGrid)

All outbound email (password resets, invitations, security alerts) is sent with SendGrid (Web API v3, official `@sendgrid/mail` SDK).

```env
SENDGRID_API_KEY=SG.xxxxxxxx
SENDGRID_FROM_EMAIL=support@your-domain.com
SENDGRID_FROM_NAME="HRMS"
SENDGRID_SANDBOX_MODE=false   # true = validated by SendGrid but never delivered (staging)
```

| Environment | Behaviour |
|---|---|
| Production | `SENDGRID_API_KEY` required (must start with `SG.`); sandbox mode refused |
| Development | With a key: real delivery. Without a key: emails are printed to the API log |
| Tests | Never sent; captured in memory so tests can read links |

SendGrid setup:
1. Create a **Restricted Access** API key with only *Mail Send* permission (Settings → API Keys) and store it in the secret manager / `backend/.env` as `SENDGRID_API_KEY`.
2. Verify the sender: **Domain Authentication** (SPF/DKIM DNS records) for production, or a Single Sender for testing. `SENDGRID_FROM_EMAIL` must use that address/domain, otherwise SendGrid returns 403.
3. Restart the backend.

Click and open tracking are disabled on every message: the links contain one-time tokens, and tracking would rewrite them through SendGrid's redirect domain. Delivery failures are logged with SendGrid's error message (never the key) and surface as an error to the caller.

## 2. Docker Compose stack

```bash
cp .env.docker.example .env.docker                    # infrastructure secrets
cp backend/.env.docker.example backend/.env.docker    # backend app secrets
docker compose --env-file .env.docker up -d --build
```

Services: `postgres` (17), `redis` (7.4, password-protected), `minio` (S3, console :9001), `migrate` (runs `node dist/database/migrate.js up` + `node dist/cli/bootstrap.js`, then exits), `backend`, `frontend` (unprivileged nginx on http://localhost:8080 serving the SPA and proxying `/api` to `backend`). Only `frontend` and tooling ports are published, bound to 127.0.0.1.

The API connects as `hrms_app` (password `APP_DB_PASSWORD`), which can only read and write rows; `migrate` connects as the schema owner `hrms`, applies migrations and then creates `hrms_app` / refreshes its grants — so existing volumes switch over on the next `up`. Demo data scripts refuse to run with `NODE_ENV=production` unless `ALLOW_DEMO_DATA=true` (throwaway demo environments only).

## 3. Production deployment

Topology: TLS load balancer → `web` (nginx, static SPA + `/api` proxy) → `api` (≥ 2 replicas, stateless) → managed PostgreSQL (HA, PITR) and managed Redis. Object storage on S3 (or compatible) with SSE.

Release steps:

1. Build images in CI: `docker build -t hrms-backend backend` (context = `backend/`) and `docker build -f frontend/Dockerfile -t hrms-frontend .` (context = repository root, because the frontend compiles `backend/src/contracts`). `.dockerignore` files keep `node_modules`, build output and `.env` secrets out of both contexts.
2. Run the **release job** once per deploy: `node dist/database/migrate.js up && node dist/database/reencrypt.js && node dist/cli/bootstrap.js` (idempotent; `reencrypt.js` moves encrypted values written in an older format or under a previous key to the current one and encrypts contact details still in plain text — `--dry-run` only counts, exit code 2 when a value can't be read; syncs the permission catalog, creates missing plans, creates the first Super Admin if `SUPERADMIN_*` are provided — remove them afterwards).
3. Roll out API replicas (liveness `GET /api/v1/health/live`, readiness `GET /api/v1/health/ready`), then web.

### Required environment (API)

| Variable | Notes |
|---|---|
| `NODE_ENV=production` | Enables production checks |
| `DB_HOST`, `DB_PORT` (5432), `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Database configuration. `DB_USER` must be a least-privilege role (boot fails with `postgres` in production); `DB_PASSWORD` from the secret manager |
| `DB_SSL` (false) | `true` requires TLS with certificate verification (managed databases). Required in production; boot fails without it unless `DB_ALLOW_INSECURE=true`, which is only for a database on a private network (the compose stack sets it) |
| `DB_MIGRATION_USER`, `DB_MIGRATION_PASSWORD` | Release job only. Migrations run as this schema owner; afterwards `migrate.js up` creates `DB_USER` if missing (needs `CREATEROLE`; otherwise create it once by hand) and grants it row access only — no DDL, no `TRUNCATE`, no `UPDATE` on `audit_logs`, no access to `schema_migrations`. Production boot refuses `DB_USER` = `DB_MIGRATION_USER`. Don't give these to the API replicas |
| `JWT_ACCESS_SECRET` | ≥ 32 chars, from the secret manager; rotate by deploying a new value (forces re-login on next refresh) |
| `DATA_ENCRYPTION_KEY` | 32 bytes base64, from KMS/secret manager. **Back it up** – encrypted columns are unrecoverable without it |
| `UPLOAD_SCAN=clamav`, `CLAMAV_HOST`, `CLAMAV_PORT` (3310), `CLAMAV_TIMEOUT_MS` (30000) | Required in production: every upload is streamed to clamd before it's stored; infected files are rejected (`FILE_REJECTED`, audited as `security.upload_blocked`) and nothing is stored while clamd is unreachable (`SCAN_UNAVAILABLE`, 503). Run clamd beside the API (`clamav/clamav`, ~1.5 GB RAM, freshclam keeps signatures current). Development uses `off`, which still blocks the EICAR test file |
| `DATA_ENCRYPTION_KEY_VERSION` (1), `DATA_ENCRYPTION_PREVIOUS_KEYS` | Key rotation: the version written into new values, and earlier keys (`1:<base64>,2:<base64>`) still needed to read older ones |
| `DATA_ENCRYPTION_KEY_SOURCE` (`env`), `KMS_REGION` | `aws-kms`: the two settings above hold KMS-encrypted data keys (`aws kms generate-data-key --key-spec AES_256 --encryption-context app=hrms,purpose=data-encryption-key`, the `CiphertextBlob`); the API's role needs `kms:Decrypt` on that key |
| `AUDIT_ARCHIVE_RETENTION_DAYS` (2557), `AUDIT_ARCHIVE_LOCK_MODE` (`COMPLIANCE`) | Log archives are write-once (S3 Object Lock) for this long — enable Object Lock on `S3_BUCKET`; at least 1 day in production |
| `COOKIE_SECURE=true` | Enforced at boot |
| `CORS_ORIGINS`, `APP_URL` | Public web origin |
| `TRUST_PROXY` | Number of proxies in front of the API (for correct client IPs / rate limits) |
| `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME` | Required in production (boot fails without a key or with `SENDGRID_SANDBOX_MODE=true`) |
| `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION` (+ `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` for MinIO / R2) | Employee documents. `s3` is required in production; credentials come from the AWS chain (instance role or `AWS_*` variables), never from `.env` files. Keep the bucket private with Block Public Access on; objects are written with SSE-S3 and only served through authorized API endpoints. Development uses `STORAGE_DRIVER=local` (`STORAGE_LOCAL_DIR`, default `uploads/`) |
| `ALLOW_ORGANIZATION_SIGNUP`, `DEFAULT_PLAN_CODE` | Self-service onboarding control |
| `JWT_ACCESS_TTL_SECONDS` (900), `REFRESH_TOKEN_TTL_DAYS` (7) | Upper bounds; organization policies may be stricter |
| `REDIS_URL` | Required in production: rate-limit counters shared by all API instances (an instance counts in memory while Redis is unreachable, and readiness reports it down) |
| `SENTRY_DSN` | Optional: unexpected errors (5xx, background jobs that failed every attempt, unhandled rejections) are reported with the request id and route pattern only — no bodies, headers or user data |
| `METRICS_TOKEN` (required in production) | Prometheus scrapes `GET /api/v1/metrics` with `Authorization: Bearer <token>` (`bearer_token` in the scrape config): request counts and latency by route pattern, job outcomes and backlog, failed sign-ins, process and event-loop metrics. Alert rules: `deploy/prometheus/alerts.yml` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` (+ standard `OTEL_*`) | Optional OpenTelemetry tracing (OTLP/HTTP) of HTTP, Express, PostgreSQL and Redis spans, without request bodies or SQL parameters; `OTEL_SERVICE_NAME` defaults to `hrms-api` |
| `LOG_FORMAT` (`json` in production) | `json`: one object per line with time, level, context, message, requestId, organizationId, stack; `text`: Nest's readable format |

Swagger is disabled when `NODE_ENV=production`.

## 4. Operations

* **Health**: `GET /api/v1/health/live` (process up) and `GET /api/v1/health/ready` (= `/health`): database, Redis, virus scanner and background jobs; 503 only when the database or Redis is down, `degraded` when the scanner is down, a job has failed or jobs wait more than 15 minutes. nginx `GET /healthz`.
* **Background jobs**: `background_jobs` (PostgreSQL) — notification emails and other side effects are enqueued in the same transaction as the change and run by any API instance (`FOR UPDATE SKIP LOCKED`), retried after 30 s, 2 min, 10 min, 1 h and 6 h, then kept as `FAILED` for 30 days (done jobs are deleted after 3 days). Alert on `jobs.failed > 0` from the readiness response. Emails with one-time links (invitations, password resets) are sent directly so tokens never sit in the database.
* **Logs**: JSON lines to stdout (warnings and errors to stderr); correlate with `X-Request-Id` / `requestId` in error responses and job ids (`job-<id>`).
* **Migrations**: never edit applied migrations; add a new `*.up.sql` (+ `*.down.sql`); check `node dist/database/migrate.js status` in the release job. Databases created by the earlier Prisma-based build are adopted with `migrate.js baseline` (no SQL is executed); the obsolete `_prisma_migrations` table can then be dropped.
* **Backups**: see [SECURITY.md §6](SECURITY.md#6-backup--recovery). `scripts/db-backup.sh` takes a custom-format dump with a SHA-256 checksum (optionally GPG-encrypted and copied to S3 with SSE-KMS); schedule it daily. `scripts/db-restore-verify.sh <dump>` restores it into a scratch database and checks the schema version and row counts against the source — run it after each backup, or at least weekly; CI runs both on every build. Example manual backup / restore:

```bash
PGPASSWORD="$DB_PASSWORD" pg_dump -Fc -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f hrms-$(date +%F).dump
PGPASSWORD="$RESTORE_DB_PASSWORD" pg_restore --clean --if-exists -h "$RESTORE_DB_HOST" -U "$RESTORE_DB_USER" -d "$RESTORE_DB_NAME" hrms-2026-11-04.dump
```

* **Key rotation**: JWT secret – deploy new secret (sessions re-authenticate). Data key – generate a new key; deploy it as `DATA_ENCRYPTION_KEY` with `DATA_ENCRYPTION_KEY_VERSION=2` and the old one as `DATA_ENCRYPTION_PREVIOUS_KEYS=1:<old key>`; run `node dist/database/reencrypt.js` (safe while the API runs) until it reports everything current; then remove the previous key.

## 5. Environment notes for this workstation

* PostgreSQL 18 runs as a Windows service on :5432; the app uses the dedicated `hrms` role with `hrms_dev` / `hrms_test` databases.
* The installed Redis service is **3.0.504** (unsupported by BullMQ). Install Memurai or run Redis 7 via Docker before Phase 9.
* Docker is not installed; the compose stack is validated in CI.
