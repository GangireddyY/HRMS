-- Holidays per location: an empty list means every location. Two holidays on one date may not cover the same location
-- (checked by the application; the partial index keeps a single all-locations holiday per date).
ALTER TABLE "holidays" ADD COLUMN "location_ids" UUID[] NOT NULL DEFAULT '{}';
DROP INDEX "holidays_organization_id_date_key";
CREATE UNIQUE INDEX "holidays_organization_id_date_all_key" ON "holidays"("organization_id", "date") WHERE "location_ids" = '{}';
CREATE INDEX "holidays_organization_id_date_idx" ON "holidays"("organization_id", "date");

-- Compensatory off: a leave type marked as comp-off is credited when someone works on a holiday or weekly off; each
-- credit expires after the validity period.
ALTER TABLE "leave_types" ADD COLUMN "comp_off_validity_days" SMALLINT,
    ADD CONSTRAINT "leave_types_comp_off_check" CHECK (
        "comp_off_validity_days" IS NULL OR ("comp_off_validity_days" BETWEEN 7 AND 365 AND NOT "unlimited" AND "accrual_frequency" = 'NONE')
    );
CREATE UNIQUE INDEX "leave_types_one_comp_off_key" ON "leave_types"("organization_id") WHERE "comp_off_validity_days" IS NOT NULL;

CREATE TABLE "comp_off_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    -- HOLIDAY or WEEKLY_OFF, with the holiday's name when there was one.
    "day_kind" VARCHAR(12) NOT NULL,
    "day_label" VARCHAR(120),
    "worked_minutes" INTEGER NOT NULL,
    "days" NUMERIC(2,1) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "leave_type_id" UUID,
    "expires_on" DATE,
    "requested_by_id" UUID,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "comp_off_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "comp_off_requests_days_check" CHECK ("days" IN (0.5, 1)),
    CONSTRAINT "comp_off_requests_kind_check" CHECK ("day_kind" IN ('HOLIDAY', 'WEEKLY_OFF')),
    CONSTRAINT "comp_off_requests_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    CONSTRAINT "comp_off_requests_approved_check" CHECK ("status" <> 'APPROVED' OR ("leave_type_id" IS NOT NULL AND "expires_on" IS NOT NULL))
);
CREATE UNIQUE INDEX "comp_off_requests_id_organization_id_key" ON "comp_off_requests"("id", "organization_id");
CREATE UNIQUE INDEX "comp_off_requests_one_active_key" ON "comp_off_requests"("employee_id", "work_date") WHERE "status" IN ('PENDING', 'APPROVED');
CREATE INDEX "comp_off_requests_organization_id_status_idx" ON "comp_off_requests"("organization_id", "status", "work_date");
CREATE INDEX "comp_off_requests_employee_id_expires_on_idx" ON "comp_off_requests"("employee_id", "expires_on") WHERE "status" = 'APPROVED';

ALTER TABLE "comp_off_requests" ADD CONSTRAINT "comp_off_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comp_off_requests" ADD CONSTRAINT "comp_off_requests_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "comp_off_requests" ADD CONSTRAINT "comp_off_requests_leave_type_id_organization_id_fkey" FOREIGN KEY ("leave_type_id", "organization_id") REFERENCES "leave_types"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "comp_off_requests" ADD CONSTRAINT "comp_off_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "comp_off_requests" ADD CONSTRAINT "comp_off_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
