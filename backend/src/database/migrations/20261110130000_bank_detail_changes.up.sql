-- Maker-checker for salary bank accounts: changing an existing account creates a request that a second person
-- (with sensitive-data access, not the requester or the employee) approves before payroll pays the new account.
CREATE TABLE "bank_detail_changes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "account_encrypted" TEXT,
    "account_last4" VARCHAR(4),
    "ifsc" VARCHAR(11),
    "bank_name" VARCHAR(100),
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bank_detail_changes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bank_detail_changes_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'))
);

-- One open request per employee.
CREATE UNIQUE INDEX "bank_detail_changes_one_pending_key" ON "bank_detail_changes"("employee_id") WHERE "status" = 'PENDING';
CREATE INDEX "bank_detail_changes_organization_id_status_idx" ON "bank_detail_changes"("organization_id", "status");
CREATE INDEX "bank_detail_changes_employee_id_reviewed_at_idx" ON "bank_detail_changes"("employee_id", "reviewed_at");

ALTER TABLE "bank_detail_changes" ADD CONSTRAINT "bank_detail_changes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_detail_changes" ADD CONSTRAINT "bank_detail_changes_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "bank_detail_changes" ADD CONSTRAINT "bank_detail_changes_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bank_detail_changes" ADD CONSTRAINT "bank_detail_changes_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
