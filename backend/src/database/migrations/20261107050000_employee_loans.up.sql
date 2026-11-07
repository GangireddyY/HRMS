-- Loans and salary advances recovered from salary in monthly instalments, and their repayments.

-- CreateTable
CREATE TABLE "employee_loans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "type" VARCHAR(8) NOT NULL,
    -- LOAN-0001 / ADV-0001, numbered separately per organization.
    "reference" VARCHAR(20) NOT NULL,
    "purpose" VARCHAR(500) NOT NULL,
    "principal" DECIMAL(12,2) NOT NULL,
    -- Yearly rate on the reducing balance (0 for advances).
    "interest_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tenure_months" SMALLINT NOT NULL,
    -- Monthly instalment, fixed on approval.
    "emi" DECIMAL(12,2),
    -- First month deducted by payroll.
    "start_year" SMALLINT,
    "start_month" SMALLINT,
    "status" VARCHAR(10) NOT NULL DEFAULT 'REQUESTED',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" VARCHAR(1000),
    "disbursed_on" DATE,
    "disbursement_reference" VARCHAR(120),
    "disbursed_by_id" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "employee_loans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_loans_type_check" CHECK ("type" IN ('LOAN', 'ADVANCE')),
    CONSTRAINT "employee_loans_status_check" CHECK ("status" IN ('REQUESTED', 'APPROVED', 'ACTIVE', 'CLOSED', 'REJECTED', 'CANCELLED')),
    CONSTRAINT "employee_loans_amount_check" CHECK ("principal" > 0 AND "interest_rate" BETWEEN 0 AND 30 AND "tenure_months" BETWEEN 1 AND 60),
    CONSTRAINT "employee_loans_advance_check" CHECK ("type" = 'LOAN' OR ("interest_rate" = 0 AND "tenure_months" <= 12)),
    CONSTRAINT "employee_loans_terms_check" CHECK (("status" IN ('APPROVED', 'ACTIVE', 'CLOSED')) <= ("emi" IS NOT NULL AND "start_year" IS NOT NULL AND "start_month" BETWEEN 1 AND 12)),
    CONSTRAINT "employee_loans_disbursed_check" CHECK (("status" IN ('ACTIVE', 'CLOSED')) = ("disbursed_on" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "employee_loan_repayments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "source" VARCHAR(10) NOT NULL,
    "payroll_run_id" UUID,
    "settlement_id" UUID,
    "paid_on" DATE NOT NULL,
    "principal" DECIMAL(12,2) NOT NULL,
    "interest" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "employee_loan_repayments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_loan_repayments_source_check" CHECK ("source" IN ('PAYROLL', 'MANUAL', 'SETTLEMENT')),
    CONSTRAINT "employee_loan_repayments_amount_check" CHECK ("principal" >= 0 AND "interest" >= 0 AND "principal" + "interest" > 0),
    CONSTRAINT "employee_loan_repayments_link_check" CHECK (("source" = 'PAYROLL') = ("payroll_run_id" IS NOT NULL) AND ("source" = 'SETTLEMENT') = ("settlement_id" IS NOT NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_loans_id_organization_id_key" ON "employee_loans"("id", "organization_id");
CREATE UNIQUE INDEX "employee_loans_reference_key" ON "employee_loans"("organization_id", "reference");
CREATE UNIQUE INDEX "employee_loans_pending_key" ON "employee_loans"("employee_id") WHERE "status" = 'REQUESTED';
CREATE INDEX "employee_loans_organization_id_status_idx" ON "employee_loans"("organization_id", "status");
CREATE INDEX "employee_loans_employee_id_idx" ON "employee_loans"("employee_id");
CREATE INDEX "employee_loan_repayments_loan_id_idx" ON "employee_loan_repayments"("loan_id");
CREATE UNIQUE INDEX "employee_loan_repayments_run_key" ON "employee_loan_repayments"("loan_id", "payroll_run_id") WHERE "payroll_run_id" IS NOT NULL;
CREATE UNIQUE INDEX "employee_loan_repayments_settlement_key" ON "employee_loan_repayments"("loan_id", "settlement_id") WHERE "settlement_id" IS NOT NULL;

-- AddForeignKey (organization)
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_loan_repayments" ADD CONSTRAINT "employee_loan_repayments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (tenant-safe composite references). A loan keeps the employee from being deleted.
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_loan_repayments" ADD CONSTRAINT "employee_loan_repayments_loan_id_organization_id_fkey" FOREIGN KEY ("loan_id", "organization_id") REFERENCES "employee_loans"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_loan_repayments" ADD CONSTRAINT "employee_loan_repayments_payroll_run_id_organization_id_fkey" FOREIGN KEY ("payroll_run_id", "organization_id") REFERENCES "payroll_runs"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_loan_repayments" ADD CONSTRAINT "employee_loan_repayments_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "exit_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (actors)
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_disbursed_by_id_fkey" FOREIGN KEY ("disbursed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_loan_repayments" ADD CONSTRAINT "employee_loan_repayments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
