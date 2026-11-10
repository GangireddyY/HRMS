-- Leave policy rules (who a type applies to, a balance cap, encashment limits), the nightly accrual job's marker, and
-- leave encashment requests paid through payroll.

ALTER TABLE "leave_types"
    ADD COLUMN "location_ids" UUID[],
    ADD COLUMN "employment_types" VARCHAR(20)[],
    ADD COLUMN "grade_ids" UUID[],
    -- Accrual stops once the balance reaches this many days.
    ADD COLUMN "max_balance" NUMERIC(6,2),
    ADD COLUMN "encash_max_days" NUMERIC(5,1),
    ADD COLUMN "encash_min_balance" NUMERIC(5,1) NOT NULL DEFAULT 0,
    ADD CONSTRAINT "leave_types_max_balance_check" CHECK ("max_balance" IS NULL OR "max_balance" > 0),
    ADD CONSTRAINT "leave_types_encash_max_check" CHECK ("encash_max_days" IS NULL OR "encash_max_days" > 0),
    ADD CONSTRAINT "leave_types_encash_min_check" CHECK ("encash_min_balance" >= 0);

-- The local date the nightly accrual job last ran for the organization.
ALTER TABLE "organizations" ADD COLUMN "leave_accruals_run_on" DATE;

ALTER TABLE "payroll_settings"
    ADD COLUMN "leave_encashment_basis" VARCHAR(10) NOT NULL DEFAULT 'BASIC_26',
    ADD CONSTRAINT "payroll_settings_leave_encashment_basis_check" CHECK ("leave_encashment_basis" IN ('BASIC_26', 'BASIC_30', 'GROSS_30'));

CREATE TABLE "leave_encashments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "leave_year" SMALLINT NOT NULL,
    "days" NUMERIC(5,1) NOT NULL,
    "reason" VARCHAR(500),
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" VARCHAR(500),
    -- Set by the payroll run that pays it (draft runs claim it; cancelling or holding the salary releases it).
    "payroll_run_id" UUID,
    "amount" NUMERIC(12,2),
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leave_encashments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "leave_encashments_days_check" CHECK ("days" > 0 AND "days" * 2 = round("days" * 2)),
    CONSTRAINT "leave_encashments_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'PAID')),
    CONSTRAINT "leave_encashments_paid_check" CHECK (("status" = 'PAID') = ("paid_at" IS NOT NULL))
);
CREATE INDEX "leave_encashments_employee_idx" ON "leave_encashments"("employee_id", "leave_year");
CREATE INDEX "leave_encashments_payable_idx" ON "leave_encashments"("organization_id", "status") WHERE "status" = 'APPROVED';
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_employee_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_leave_type_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON UPDATE CASCADE;
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_run_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
