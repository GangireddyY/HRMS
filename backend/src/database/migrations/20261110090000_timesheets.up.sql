-- Weekly timesheets (Monday to Sunday): lines of project / task with minutes per day, reviewed by the manager or HR.
CREATE TABLE "timesheets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "lines" JSONB NOT NULL DEFAULT '[]',
    "total_minutes" INTEGER NOT NULL DEFAULT 0,
    "note" VARCHAR(500),
    "submitted_at" TIMESTAMPTZ(3),
    "submitted_by_id" UUID,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "timesheets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "timesheets_status_check" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')),
    CONSTRAINT "timesheets_week_start_check" CHECK (EXTRACT(ISODOW FROM "week_start") = 1),
    CONSTRAINT "timesheets_total_minutes_check" CHECK ("total_minutes" BETWEEN 0 AND 10080)
);

CREATE UNIQUE INDEX "timesheets_employee_id_week_start_key" ON "timesheets"("employee_id", "week_start");
CREATE INDEX "timesheets_organization_id_status_week_start_idx" ON "timesheets"("organization_id", "status", "week_start");
CREATE INDEX "timesheets_organization_id_week_start_idx" ON "timesheets"("organization_id", "week_start");

ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Payroll rules: whether timesheets are required, from which week, when they're due and what a missed one costs.
ALTER TABLE "payroll_settings"
    ADD COLUMN "timesheets_required" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "timesheets_from" DATE,
    ADD COLUMN "timesheet_due_weekday" SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN "timesheet_missed_action" VARCHAR(4) NOT NULL DEFAULT 'FLAG';
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_timesheets_check" CHECK ("timesheet_due_weekday" BETWEEN 0 AND 6 AND "timesheet_missed_action" IN ('FLAG', 'LOP', 'HOLD'));
