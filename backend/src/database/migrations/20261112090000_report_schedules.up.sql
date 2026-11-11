-- Scheduled reports: a saved report-builder report emailed daily, weekly or monthly to members of the organization,
-- each recipient getting only the rows their own access allows.
CREATE TABLE "report_schedules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "saved_report_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "frequency" VARCHAR(8) NOT NULL,
    -- WEEKLY: ISO weekday (1 = Monday); MONTHLY: day of the month (1 to 28).
    "day_of_week" SMALLINT,
    "day_of_month" SMALLINT,
    -- Local hour in the organization's timezone.
    "hour" SMALLINT NOT NULL DEFAULT 8,
    "format" VARCHAR(4) NOT NULL DEFAULT 'xlsx',
    "period" VARCHAR(16) NOT NULL DEFAULT 'PREVIOUS_MONTH',
    -- User ids (members of the organization).
    "recipient_ids" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMPTZ(3),
    "last_run_at" TIMESTAMPTZ(3),
    "last_status" VARCHAR(8),
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "report_schedules_frequency_check" CHECK ("frequency" IN ('DAILY', 'WEEKLY', 'MONTHLY')),
    CONSTRAINT "report_schedules_day_check" CHECK (
        ("frequency" <> 'WEEKLY' OR "day_of_week" BETWEEN 1 AND 7) AND ("frequency" <> 'MONTHLY' OR "day_of_month" BETWEEN 1 AND 28)
    ),
    CONSTRAINT "report_schedules_hour_check" CHECK ("hour" BETWEEN 0 AND 23),
    CONSTRAINT "report_schedules_format_check" CHECK ("format" IN ('csv', 'xlsx'))
);
CREATE INDEX "report_schedules_report_idx" ON "report_schedules"("organization_id", "saved_report_id");
CREATE INDEX "report_schedules_due_idx" ON "report_schedules"("next_run_at") WHERE "is_active";
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_saved_report_id_fkey" FOREIGN KEY ("saved_report_id") REFERENCES "saved_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "report_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_schedules" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "report_schedules" USING ("hrms_tenant_visible"("organization_id")) WITH CHECK ("hrms_tenant_visible"("organization_id"));
