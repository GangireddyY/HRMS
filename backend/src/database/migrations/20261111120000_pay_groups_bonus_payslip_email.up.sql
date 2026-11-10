-- Pay groups (separate payroll runs per group of employees), the kind of one-off payment, and payslip emails.

CREATE TABLE "pay_groups" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "pay_groups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pay_groups_id_organization_id_key" ON "pay_groups"("id", "organization_id");
CREATE UNIQUE INDEX "pay_groups_organization_id_name_key" ON "pay_groups"("organization_id", lower("name"));
ALTER TABLE "pay_groups" ADD CONSTRAINT "pay_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Employees without a pay group are paid in the main run.
ALTER TABLE "employees" ADD COLUMN "pay_group_id" UUID;
ALTER TABLE "employees" ADD CONSTRAINT "employees_pay_group_fkey" FOREIGN KEY ("pay_group_id", "organization_id") REFERENCES "pay_groups"("id", "organization_id") ON UPDATE CASCADE;
CREATE INDEX "employees_pay_group_idx" ON "employees"("pay_group_id") WHERE "pay_group_id" IS NOT NULL;

ALTER TABLE "payroll_runs" ADD COLUMN "pay_group_id" UUID;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_pay_group_fkey" FOREIGN KEY ("pay_group_id", "organization_id") REFERENCES "pay_groups"("id", "organization_id") ON UPDATE CASCADE;
DROP INDEX "payroll_runs_one_per_month_key";
CREATE UNIQUE INDEX "payroll_runs_one_per_month_key" ON "payroll_runs"("organization_id", "year", "month", COALESCE("pay_group_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "status" <> 'CANCELLED';

ALTER TABLE "payroll_adjustments"
    ADD COLUMN "category" VARCHAR(10) NOT NULL DEFAULT 'OTHER',
    ADD CONSTRAINT "payroll_adjustments_category_check" CHECK ("category" IN ('BONUS', 'INCENTIVE', 'ARREARS', 'OTHER'));

ALTER TABLE "payroll_settings"
    -- Email each employee their payslip (PDF) when a run is approved.
    ADD COLUMN "payslip_email_enabled" BOOLEAN NOT NULL DEFAULT false,
    -- NONE, or the date of birth (DDMMYYYY) as the PDF password.
    ADD COLUMN "payslip_pdf_password" VARCHAR(10) NOT NULL DEFAULT 'DOB',
    ADD CONSTRAINT "payroll_settings_payslip_pdf_password_check" CHECK ("payslip_pdf_password" IN ('NONE', 'DOB'));
