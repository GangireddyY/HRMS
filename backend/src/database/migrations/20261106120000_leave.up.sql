-- Leave: types with their policy, an append-only balance ledger and leave requests.

-- AlterTable: leave year (1 = January … 12 = December); a leave year is named after the calendar year it starts in.
ALTER TABLE "organizations" ADD COLUMN "leave_year_start_month" SMALLINT NOT NULL DEFAULT 1,
    ADD CONSTRAINT "organizations_leave_year_start_month_check" CHECK ("leave_year_start_month" BETWEEN 1 AND 12);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "color" CHAR(7) NOT NULL DEFAULT '#6366f1',
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    -- No balance is kept (e.g. leave without pay).
    "unlimited" BOOLEAN NOT NULL DEFAULT false,
    "annual_quota" NUMERIC(5,2) NOT NULL DEFAULT 0,
    "accrual_frequency" VARCHAR(10) NOT NULL DEFAULT 'YEARLY',
    "prorate_on_joining" BOOLEAN NOT NULL DEFAULT true,
    -- Days that move to the next leave year (0 = none; the rest lapses).
    "carry_forward_limit" NUMERIC(5,2) NOT NULL DEFAULT 0,
    "encashable" BOOLEAN NOT NULL DEFAULT false,
    "allow_half_day" BOOLEAN NOT NULL DEFAULT true,
    "allow_negative_balance" BOOLEAN NOT NULL DEFAULT false,
    -- Weekly offs and holidays inside the range count as leave days (sandwich rule).
    "count_non_working_days" BOOLEAN NOT NULL DEFAULT false,
    "min_notice_days" SMALLINT NOT NULL DEFAULT 0,
    "max_backdated_days" SMALLINT NOT NULL DEFAULT 0,
    "max_consecutive_days" SMALLINT,
    -- Days after joining before the type can be used.
    "eligible_after_days" SMALLINT NOT NULL DEFAULT 0,
    "applicable_gender" VARCHAR(10),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "leave_types_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9]{0,9}$'),
    CONSTRAINT "leave_types_color_check" CHECK ("color" ~ '^#[0-9a-fA-F]{6}$'),
    CONSTRAINT "leave_types_accrual_check" CHECK ("accrual_frequency" IN ('YEARLY', 'MONTHLY', 'NONE')),
    CONSTRAINT "leave_types_gender_check" CHECK ("applicable_gender" IS NULL OR "applicable_gender" IN ('FEMALE', 'MALE')),
    CONSTRAINT "leave_types_numbers_check" CHECK (
        "annual_quota" BETWEEN 0 AND 366 AND "carry_forward_limit" BETWEEN 0 AND 366
        AND "min_notice_days" BETWEEN 0 AND 365 AND "max_backdated_days" BETWEEN 0 AND 365
        AND ("max_consecutive_days" IS NULL OR "max_consecutive_days" BETWEEN 1 AND 366)
        AND "eligible_after_days" BETWEEN 0 AND 3650
    ),
    CONSTRAINT "leave_types_unlimited_check" CHECK (NOT "unlimited" OR ("accrual_frequency" = 'NONE' AND "carry_forward_limit" = 0 AND NOT "encashable"))
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "leave_year" SMALLINT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "start_session" VARCHAR(12) NOT NULL DEFAULT 'FULL',
    "end_session" VARCHAR(12) NOT NULL DEFAULT 'FULL',
    "days" NUMERIC(5,1) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" VARCHAR(500),
    "cancelled_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "leave_requests_dates_check" CHECK ("end_date" >= "start_date"),
    CONSTRAINT "leave_requests_days_check" CHECK ("days" > 0),
    CONSTRAINT "leave_requests_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    -- Single day: FULL, FIRST_HALF or SECOND_HALF. Several days: may start in the afternoon and end at noon.
    CONSTRAINT "leave_requests_sessions_check" CHECK (
        ("start_date" = "end_date" AND "start_session" IN ('FULL', 'FIRST_HALF', 'SECOND_HALF') AND "end_session" = "start_session")
        OR ("start_date" < "end_date" AND "start_session" IN ('FULL', 'SECOND_HALF') AND "end_session" IN ('FULL', 'FIRST_HALF'))
    )
);

-- CreateTable
CREATE TABLE "leave_ledger_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "leave_year" SMALLINT NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "days" NUMERIC(6,2) NOT NULL,
    "effective_date" DATE NOT NULL,
    "leave_request_id" UUID,
    "note" VARCHAR(500),
    -- Makes automatic entries (accruals, carry-forward, lapse) safe to run any number of times.
    "idempotency_key" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "leave_ledger_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "leave_ledger_entries_kind_check" CHECK ("kind" IN ('ACCRUAL', 'CARRY_FORWARD', 'LAPSE', 'GRANT', 'ADJUSTMENT', 'ENCASHMENT', 'TAKEN', 'REVERSAL')),
    CONSTRAINT "leave_ledger_entries_sign_check" CHECK (
        ("kind" IN ('ACCRUAL', 'CARRY_FORWARD', 'GRANT', 'REVERSAL') AND "days" > 0)
        OR ("kind" IN ('LAPSE', 'ENCASHMENT', 'TAKEN') AND "days" < 0)
        OR ("kind" = 'ADJUSTMENT' AND "days" <> 0)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_id_organization_id_key" ON "leave_types"("id", "organization_id");
CREATE UNIQUE INDEX "leave_types_organization_id_code_key" ON "leave_types"("organization_id", "code");
CREATE UNIQUE INDEX "leave_types_organization_id_name_key" ON "leave_types"("organization_id", lower("name"));
CREATE UNIQUE INDEX "leave_requests_id_organization_id_key" ON "leave_requests"("id", "organization_id");
CREATE INDEX "leave_requests_employee_id_dates_idx" ON "leave_requests"("employee_id", "start_date", "end_date");
CREATE INDEX "leave_requests_organization_id_status_idx" ON "leave_requests"("organization_id", "status", "start_date");
CREATE INDEX "leave_ledger_entries_balance_idx" ON "leave_ledger_entries"("employee_id", "leave_type_id", "leave_year");
CREATE UNIQUE INDEX "leave_ledger_entries_idempotency_key" ON "leave_ledger_entries"("organization_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;

-- AddForeignKey (organization)
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (tenant-safe composite references; NO ACTION so leave history blocks deleting employees and types)
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_organization_id_fkey" FOREIGN KEY ("leave_type_id", "organization_id") REFERENCES "leave_types"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_leave_type_id_organization_id_fkey" FOREIGN KEY ("leave_type_id", "organization_id") REFERENCES "leave_types"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_leave_request_id_organization_id_fkey" FOREIGN KEY ("leave_request_id", "organization_id") REFERENCES "leave_requests"("id", "organization_id") ON UPDATE CASCADE;

-- AddForeignKey (actors)
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The ledger is append-only: corrections are new entries, never edits.
CREATE FUNCTION "leave_ledger_append_only"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'leave_ledger_entries is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "leave_ledger_entries_no_update" BEFORE UPDATE ON "leave_ledger_entries" FOR EACH ROW EXECUTE FUNCTION "leave_ledger_append_only"();
