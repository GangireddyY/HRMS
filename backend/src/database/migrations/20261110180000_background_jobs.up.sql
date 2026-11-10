-- Durable background jobs (outbound email and other side effects): enqueued in the same transaction as the change
-- that causes them, run by any API instance (FOR UPDATE SKIP LOCKED), retried with backoff, kept as FAILED after the
-- last attempt. Payloads can hold personal data, so finished jobs are deleted after a few days.
CREATE TABLE "background_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "type" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(8) NOT NULL DEFAULT 'PENDING',
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "max_attempts" SMALLINT NOT NULL DEFAULT 6,
    "run_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "locked_by" VARCHAR(100),
    "last_error" VARCHAR(1000),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "background_jobs_status_check" CHECK ("status" IN ('PENDING', 'RUNNING', 'DONE', 'FAILED'))
);
CREATE INDEX "background_jobs_due_idx" ON "background_jobs"("run_at") WHERE "status" = 'PENDING';
CREATE INDEX "background_jobs_status_finished_idx" ON "background_jobs"("status", "finished_at");
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
