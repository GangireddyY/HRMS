-- Maker-checker for salary revisions: a raise above the organization's threshold (percent over the salary in force on
-- the effective date) waits for a second person with employee.salary.approve before it becomes a salary.
ALTER TABLE "payroll_settings" ADD COLUMN "salary_approval_threshold_pct" DECIMAL(5,2);
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_salary_approval_threshold_check" CHECK ("salary_approval_threshold_pct" IS NULL OR "salary_approval_threshold_pct" BETWEEN 0 AND 500);

CREATE TABLE "salary_revision_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "annual_ctc" DECIMAL(14,2) NOT NULL,
    "previous_ctc" DECIMAL(14,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "pf_applicable" BOOLEAN NOT NULL DEFAULT true,
    "reason" VARCHAR(300),
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" VARCHAR(500),
    "salary_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "salary_revision_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "salary_revision_requests_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'))
);

-- One open request per employee.
CREATE UNIQUE INDEX "salary_revision_requests_one_pending_key" ON "salary_revision_requests"("employee_id") WHERE "status" = 'PENDING';
CREATE INDEX "salary_revision_requests_organization_id_status_idx" ON "salary_revision_requests"("organization_id", "status");

ALTER TABLE "salary_revision_requests" ADD CONSTRAINT "salary_revision_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "salary_revision_requests" ADD CONSTRAINT "salary_revision_requests_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "salary_revision_requests" ADD CONSTRAINT "salary_revision_requests_structure_id_fkey" FOREIGN KEY ("structure_id") REFERENCES "salary_structures"("id") ON UPDATE CASCADE;
ALTER TABLE "salary_revision_requests" ADD CONSTRAINT "salary_revision_requests_salary_id_fkey" FOREIGN KEY ("salary_id") REFERENCES "employee_salaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "salary_revision_requests" ADD CONSTRAINT "salary_revision_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "salary_revision_requests" ADD CONSTRAINT "salary_revision_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
