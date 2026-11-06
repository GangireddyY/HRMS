-- Exits: separation cases (resignation or employer-initiated) with notice and last working day, clearance steps, and
-- the full & final settlement.

-- CreateTable
CREATE TABLE "exit_cases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "type" VARCHAR(14) NOT NULL,
    "reason" VARCHAR(20) NOT NULL,
    "reason_detail" VARCHAR(2000),
    "status" VARCHAR(10) NOT NULL,
    "submitted_on" DATE NOT NULL,
    "notice_days" INTEGER NOT NULL,
    "notice_ends_on" DATE NOT NULL,
    "requested_last_day" DATE,
    "last_working_day" DATE,
    "notice_waived" BOOLEAN NOT NULL DEFAULT false,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" VARCHAR(1000),
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_id" UUID,
    "closed_reason" VARCHAR(1000),
    "closed_at" TIMESTAMPTZ(3),
    -- The employee's exit survey (only for exit.manage).
    "feedback" JSONB,
    "eligible_for_rehire" BOOLEAN,
    "rehire_note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "exit_cases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exit_cases_type_check" CHECK ("type" IN ('RESIGNATION', 'TERMINATION', 'RETIREMENT', 'CONTRACT_END', 'DEATH', 'OTHER')),
    CONSTRAINT "exit_cases_reason_check" CHECK ("reason" IN ('BETTER_OPPORTUNITY', 'COMPENSATION', 'CAREER_GROWTH', 'RELOCATION', 'HIGHER_STUDIES', 'PERSONAL', 'HEALTH', 'WORK_ENVIRONMENT', 'MANAGER', 'PERFORMANCE', 'MISCONDUCT', 'REDUNDANCY', 'OTHER')),
    CONSTRAINT "exit_cases_status_check" CHECK ("status" IN ('SUBMITTED', 'APPROVED', 'COMPLETED', 'WITHDRAWN', 'CANCELLED')),
    CONSTRAINT "exit_cases_notice_check" CHECK ("notice_days" BETWEEN 0 AND 365 AND "notice_ends_on" >= "submitted_on" - 1),
    CONSTRAINT "exit_cases_last_day_check" CHECK (("status" IN ('APPROVED', 'COMPLETED')) <= ("last_working_day" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "exit_clearance_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "department" VARCHAR(10) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    -- Dues to recover in the settlement (e.g. an unreturned device).
    "recovery_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" VARCHAR(1000),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "cleared_by_id" UUID,
    "cleared_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exit_clearance_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exit_clearance_items_department_check" CHECK ("department" IN ('MANAGER', 'IT', 'ADMIN', 'FINANCE', 'HR')),
    CONSTRAINT "exit_clearance_items_status_check" CHECK ("status" IN ('PENDING', 'CLEARED', 'NOT_APPLICABLE')),
    CONSTRAINT "exit_clearance_items_recovery_check" CHECK ("recovery_amount" >= 0)
);

-- CreateTable
CREATE TABLE "exit_settlements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "encashment_basis" VARCHAR(10) NOT NULL,
    "notice_basis" VARCHAR(10) NOT NULL,
    "include_gratuity" BOOLEAN NOT NULL,
    "gratuity_note" VARCHAR(1000),
    -- Manual earnings / deductions: [{ label, kind, amount }].
    "adjustments" JSONB NOT NULL DEFAULT '[]',
    -- Computed statement: [{ code, label, kind, amount, detail }].
    "lines" JSONB NOT NULL DEFAULT '[]',
    -- What the calculation used (salary, service, leave, notice).
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "total_earnings" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_payable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "due_on" DATE NOT NULL,
    "calculated_by_id" UUID,
    "calculated_at" TIMESTAMPTZ(3),
    "submitted_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "returned_note" VARCHAR(1000),
    "paid_on" DATE,
    "payment_reference" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exit_settlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exit_settlements_status_check" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'PAID')),
    CONSTRAINT "exit_settlements_basis_check" CHECK ("encashment_basis" IN ('BASIC_26', 'BASIC_30', 'GROSS_30') AND "notice_basis" IN ('BASIC_26', 'BASIC_30', 'GROSS_30')),
    CONSTRAINT "exit_settlements_paid_check" CHECK (("status" = 'PAID') = ("paid_on" IS NOT NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "exit_cases_id_organization_id_key" ON "exit_cases"("id", "organization_id");
CREATE UNIQUE INDEX "exit_cases_open_key" ON "exit_cases"("employee_id") WHERE "status" IN ('SUBMITTED', 'APPROVED');
CREATE INDEX "exit_cases_organization_id_status_idx" ON "exit_cases"("organization_id", "status", "last_working_day");
CREATE INDEX "exit_clearance_items_case_id_idx" ON "exit_clearance_items"("case_id", "sort_order");
CREATE UNIQUE INDEX "exit_settlements_case_id_key" ON "exit_settlements"("case_id");

-- AddForeignKey (organization)
ALTER TABLE "exit_cases" ADD CONSTRAINT "exit_cases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exit_clearance_items" ADD CONSTRAINT "exit_clearance_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exit_settlements" ADD CONSTRAINT "exit_settlements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (tenant-safe composite references). An exit case keeps the employee from being deleted.
ALTER TABLE "exit_cases" ADD CONSTRAINT "exit_cases_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exit_clearance_items" ADD CONSTRAINT "exit_clearance_items_case_id_organization_id_fkey" FOREIGN KEY ("case_id", "organization_id") REFERENCES "exit_cases"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exit_settlements" ADD CONSTRAINT "exit_settlements_case_id_organization_id_fkey" FOREIGN KEY ("case_id", "organization_id") REFERENCES "exit_cases"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (actors)
ALTER TABLE "exit_cases" ADD CONSTRAINT "exit_cases_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "exit_cases" ADD CONSTRAINT "exit_cases_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "exit_cases" ADD CONSTRAINT "exit_cases_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "exit_clearance_items" ADD CONSTRAINT "exit_clearance_items_cleared_by_id_fkey" FOREIGN KEY ("cleared_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "exit_settlements" ADD CONSTRAINT "exit_settlements_calculated_by_id_fkey" FOREIGN KEY ("calculated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "exit_settlements" ADD CONSTRAINT "exit_settlements_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "exit_settlements" ADD CONSTRAINT "exit_settlements_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
