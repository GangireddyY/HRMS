-- Payroll: statutory settings, salary components and structures, employee salaries (history), tax declarations,
-- payroll runs with payslips and one-time adjustments, and reimbursement claims.

-- CreateTable
CREATE TABLE "payroll_settings" (
    "organization_id" UUID NOT NULL,
    "pf_enabled" BOOLEAN NOT NULL DEFAULT true,
    -- Contribute on PF wages up to the statutory ceiling only (false = on full PF wages).
    "pf_restrict_to_ceiling" BOOLEAN NOT NULL DEFAULT true,
    "esi_enabled" BOOLEAN NOT NULL DEFAULT true,
    "pt_enabled" BOOLEAN NOT NULL DEFAULT true,
    -- Professional tax state for employees whose work location has no state (code, e.g. KA).
    "pt_state" VARCHAR(2),
    -- Loss of pay from attendance (absences, half days) as well as unpaid leave; requires the month to be closed.
    "lop_from_attendance" BOOLEAN NOT NULL DEFAULT false,
    "pf_establishment_code" VARCHAR(30),
    "esi_employer_code" VARCHAR(30),
    "tan" VARCHAR(10),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "payroll_settings_pkey" PRIMARY KEY ("organization_id"),
    CONSTRAINT "payroll_settings_tan_check" CHECK ("tan" IS NULL OR "tan" ~ '^[A-Z]{4}[0-9]{5}[A-Z]$')
);

-- CreateTable
CREATE TABLE "salary_components" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(300),
    -- BASIC and HRA drive PF defaults, the HRA exemption and percent-of-basic lines (one each per organization).
    "role" VARCHAR(10),
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "pf_wage" BOOLEAN NOT NULL DEFAULT false,
    "esi_wage" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "salary_components_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "salary_components_role_check" CHECK ("role" IS NULL OR "role" IN ('BASIC', 'HRA')),
    CONSTRAINT "salary_components_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{1,19}$')
);

-- CreateTable
CREATE TABLE "salary_structures" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(300),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_structure_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "calculation" VARCHAR(20) NOT NULL,
    "value" NUMERIC(12,2),
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "salary_structure_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "salary_structure_lines_calculation_check" CHECK ("calculation" IN ('PERCENT_OF_CTC', 'PERCENT_OF_BASIC', 'FIXED', 'BALANCE')),
    CONSTRAINT "salary_structure_lines_value_check" CHECK (
        ("calculation" = 'BALANCE' AND "value" IS NULL)
        OR ("calculation" = 'FIXED' AND "value" >= 0)
        OR ("calculation" IN ('PERCENT_OF_CTC', 'PERCENT_OF_BASIC') AND "value" > 0 AND "value" <= 100)
    )
);

-- CreateTable
CREATE TABLE "employee_salaries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "annual_ctc" NUMERIC(14,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "pf_applicable" BOOLEAN NOT NULL DEFAULT true,
    -- Snapshot of the breakdown when the salary was set (structure edits don't change existing salaries).
    "monthly_gross" NUMERIC(12,2) NOT NULL,
    "employer_pf" NUMERIC(12,2) NOT NULL,
    "employer_esi" NUMERIC(12,2) NOT NULL,
    "components" JSONB NOT NULL,
    "reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "employee_salaries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_salaries_amounts_check" CHECK ("annual_ctc" > 0 AND "monthly_gross" >= 0 AND "employer_pf" >= 0 AND "employer_esi" >= 0)
);

-- CreateTable
CREATE TABLE "tax_declarations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    -- Starting year of the financial year (2026 = FY 2026-27).
    "financial_year" SMALLINT NOT NULL,
    "regime" VARCHAR(3) NOT NULL DEFAULT 'NEW',
    "rent_paid_annual" NUMERIC(12,2) NOT NULL DEFAULT 0,
    "metro_city" BOOLEAN NOT NULL DEFAULT false,
    "section_80c" NUMERIC(12,2) NOT NULL DEFAULT 0,
    "section_80ccd1b" NUMERIC(12,2) NOT NULL DEFAULT 0,
    "section_80d" NUMERIC(12,2) NOT NULL DEFAULT 0,
    "home_loan_interest" NUMERIC(12,2) NOT NULL DEFAULT 0,
    "previous_employer_income" NUMERIC(14,2) NOT NULL DEFAULT 0,
    "previous_employer_tds" NUMERIC(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "tax_declarations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tax_declarations_regime_check" CHECK ("regime" IN ('NEW', 'OLD')),
    CONSTRAINT "tax_declarations_year_check" CHECK ("financial_year" BETWEEN 2000 AND 2100),
    CONSTRAINT "tax_declarations_amounts_check" CHECK (
        "rent_paid_annual" >= 0 AND "section_80c" >= 0 AND "section_80ccd1b" >= 0 AND "section_80d" >= 0
        AND "home_loan_interest" >= 0 AND "previous_employer_income" >= 0 AND "previous_employer_tds" >= 0
    )
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "year" SMALLINT NOT NULL,
    "month" SMALLINT NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "notes" VARCHAR(500),
    "employee_count" INTEGER NOT NULL DEFAULT 0,
    "total_gross" NUMERIC(14,2) NOT NULL DEFAULT 0,
    "total_deductions" NUMERIC(14,2) NOT NULL DEFAULT 0,
    "total_net" NUMERIC(14,2) NOT NULL DEFAULT 0,
    "total_employer_contributions" NUMERIC(14,2) NOT NULL DEFAULT 0,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "calculated_at" TIMESTAMPTZ(3),
    "calculated_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "submitted_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_id" UUID,
    "review_note" VARCHAR(500),
    "paid_at" TIMESTAMPTZ(3),
    "paid_by_id" UUID,
    "payment_reference" VARCHAR(100),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_runs_status_check" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'PAID', 'CANCELLED')),
    CONSTRAINT "payroll_runs_period_check" CHECK ("month" BETWEEN 1 AND 12 AND "year" BETWEEN 2000 AND 2100)
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    -- Employee details as printed on the payslip (name, code, designation, department, PAN / UAN / bank masked).
    "employee" JSONB NOT NULL,
    "days_in_month" SMALLINT NOT NULL,
    "employed_days" NUMERIC(4,1) NOT NULL,
    "lop_days" NUMERIC(4,1) NOT NULL DEFAULT 0,
    -- Set by payroll to replace the attendance-based loss of pay.
    "lop_override" NUMERIC(4,1),
    "payable_days" NUMERIC(4,1) NOT NULL,
    "earnings" JSONB NOT NULL,
    "deductions" JSONB NOT NULL,
    "employer_contributions" JSONB NOT NULL,
    "gross" NUMERIC(12,2) NOT NULL,
    "total_deductions" NUMERIC(12,2) NOT NULL,
    "net_pay" NUMERIC(12,2) NOT NULL,
    -- PF / EPS / EDLI / ESI wages, ESI coverage, professional tax state.
    "statutory" JSONB NOT NULL,
    -- TDS working: regime, projected income, exemptions, deductions, annual tax, deducted so far.
    "tax" JSONB,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    -- Held: not paid in this run (no payslip is published).
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "exclude_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payslips_days_check" CHECK (
        "days_in_month" BETWEEN 28 AND 31 AND "employed_days" BETWEEN 0 AND "days_in_month"
        AND "lop_days" >= 0 AND ("lop_override" IS NULL OR "lop_override" BETWEEN 0 AND "days_in_month") AND "payable_days" >= 0
    )
);

-- CreateTable
CREATE TABLE "payroll_adjustments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "amount" NUMERIC(12,2) NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_adjustments_kind_check" CHECK ("kind" IN ('EARNING', 'DEDUCTION')),
    CONSTRAINT "payroll_adjustments_amount_check" CHECK ("amount" > 0)
);

-- CreateTable
CREATE TABLE "reimbursement_claims" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "expense_date" DATE NOT NULL,
    "amount" NUMERIC(12,2) NOT NULL,
    "description" VARCHAR(1000),
    "receipt_key" VARCHAR(200),
    "receipt_name" VARCHAR(255),
    "receipt_type" VARCHAR(50),
    "receipt_size" INTEGER,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" VARCHAR(500),
    -- Run that pays the claim (set when an approved claim is included in a calculated run).
    "payroll_run_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "reimbursement_claims_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reimbursement_claims_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'PAID')),
    CONSTRAINT "reimbursement_claims_category_check" CHECK ("category" IN ('TRAVEL', 'FOOD', 'INTERNET_PHONE', 'MEDICAL', 'RELOCATION', 'OFFICE_SUPPLIES', 'OTHER')),
    CONSTRAINT "reimbursement_claims_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "reimbursement_claims_receipt_check" CHECK (("receipt_key" IS NULL) = ("receipt_name" IS NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "salary_components_id_organization_id_key" ON "salary_components"("id", "organization_id");
CREATE UNIQUE INDEX "salary_components_organization_id_code_key" ON "salary_components"("organization_id", "code");
CREATE UNIQUE INDEX "salary_components_organization_id_role_key" ON "salary_components"("organization_id", "role") WHERE "role" IS NOT NULL;
CREATE UNIQUE INDEX "salary_structures_id_organization_id_key" ON "salary_structures"("id", "organization_id");
CREATE UNIQUE INDEX "salary_structures_organization_id_name_key" ON "salary_structures"("organization_id", lower("name"));
CREATE UNIQUE INDEX "salary_structure_lines_structure_id_component_id_key" ON "salary_structure_lines"("structure_id", "component_id");
CREATE UNIQUE INDEX "salary_structure_lines_one_balance_key" ON "salary_structure_lines"("structure_id") WHERE "calculation" = 'BALANCE';
CREATE UNIQUE INDEX "employee_salaries_employee_id_effective_from_key" ON "employee_salaries"("employee_id", "effective_from");
CREATE INDEX "employee_salaries_organization_id_idx" ON "employee_salaries"("organization_id");
CREATE UNIQUE INDEX "tax_declarations_employee_id_financial_year_key" ON "tax_declarations"("employee_id", "financial_year");
CREATE UNIQUE INDEX "payroll_runs_id_organization_id_key" ON "payroll_runs"("id", "organization_id");
CREATE UNIQUE INDEX "payroll_runs_one_per_month_key" ON "payroll_runs"("organization_id", "year", "month") WHERE "status" <> 'CANCELLED';
CREATE UNIQUE INDEX "payslips_run_id_employee_id_key" ON "payslips"("run_id", "employee_id");
CREATE INDEX "payslips_employee_id_idx" ON "payslips"("employee_id");
CREATE INDEX "payroll_adjustments_run_id_employee_id_idx" ON "payroll_adjustments"("run_id", "employee_id");
CREATE INDEX "reimbursement_claims_organization_id_status_idx" ON "reimbursement_claims"("organization_id", "status");
CREATE INDEX "reimbursement_claims_employee_id_idx" ON "reimbursement_claims"("employee_id", "created_at");
CREATE UNIQUE INDEX "reimbursement_claims_receipt_key_key" ON "reimbursement_claims"("receipt_key") WHERE "receipt_key" IS NOT NULL;

-- AddForeignKey (organization)
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "salary_structure_lines" ADD CONSTRAINT "salary_structure_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tax_declarations" ADD CONSTRAINT "tax_declarations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (tenant-safe composite references)
ALTER TABLE "salary_structure_lines" ADD CONSTRAINT "salary_structure_lines_structure_id_organization_id_fkey" FOREIGN KEY ("structure_id", "organization_id") REFERENCES "salary_structures"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "salary_structure_lines" ADD CONSTRAINT "salary_structure_lines_component_id_organization_id_fkey" FOREIGN KEY ("component_id", "organization_id") REFERENCES "salary_components"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_structure_id_organization_id_fkey" FOREIGN KEY ("structure_id", "organization_id") REFERENCES "salary_structures"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "tax_declarations" ADD CONSTRAINT "tax_declarations_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_id_organization_id_fkey" FOREIGN KEY ("run_id", "organization_id") REFERENCES "payroll_runs"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Payslips, adjustments and claims keep the employee from being deleted (statutory records).
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_run_id_organization_id_fkey" FOREIGN KEY ("run_id", "organization_id") REFERENCES "payroll_runs"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_payroll_run_id_organization_id_fkey" FOREIGN KEY ("payroll_run_id", "organization_id") REFERENCES "payroll_runs"("id", "organization_id") ON UPDATE CASCADE;

-- AddForeignKey (actors)
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_calculated_by_id_fkey" FOREIGN KEY ("calculated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reimbursement_claims" ADD CONSTRAINT "reimbursement_claims_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
