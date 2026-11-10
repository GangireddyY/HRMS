-- Expense policies per claim category (allowed, per-claim and monthly limits, when a receipt is required), a finance
-- approval above an amount, and the approval trail of each claim.

CREATE TABLE "expense_policies" (
    "organization_id" UUID NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "per_claim_limit" NUMERIC(12,2),
    "monthly_limit" NUMERIC(12,2),
    -- A receipt is required for claims above this amount (0 = always; null = never).
    "receipt_required_above" NUMERIC(12,2),
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expense_policies_pkey" PRIMARY KEY ("organization_id", "category"),
    CONSTRAINT "expense_policies_category_check" CHECK ("category" IN ('TRAVEL', 'FOOD', 'INTERNET_PHONE', 'MEDICAL', 'RELOCATION', 'OFFICE_SUPPLIES', 'OTHER')),
    CONSTRAINT "expense_policies_limits_check" CHECK (("per_claim_limit" IS NULL OR "per_claim_limit" > 0) AND ("monthly_limit" IS NULL OR "monthly_limit" > 0) AND ("receipt_required_above" IS NULL OR "receipt_required_above" >= 0))
);
ALTER TABLE "expense_policies" ADD CONSTRAINT "expense_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Claims above this amount need a finance approval after the manager's; null = one approval.
ALTER TABLE "payroll_settings" ADD COLUMN "claim_finance_approval_above" NUMERIC(12,2),
    ADD CONSTRAINT "payroll_settings_claim_finance_check" CHECK ("claim_finance_approval_above" IS NULL OR "claim_finance_approval_above" > 0);

ALTER TABLE "reimbursement_claims" ADD COLUMN "approval_stage" VARCHAR(8) NOT NULL DEFAULT 'MANAGER',
    ADD CONSTRAINT "reimbursement_claims_stage_check" CHECK ("approval_stage" IN ('MANAGER', 'FINANCE'));

CREATE TABLE "reimbursement_approvals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "step" VARCHAR(8) NOT NULL,
    "decision" VARCHAR(8) NOT NULL,
    "decided_by_id" UUID,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reimbursement_approvals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reimbursement_approvals_step_check" CHECK ("step" IN ('MANAGER', 'FINANCE')),
    CONSTRAINT "reimbursement_approvals_decision_check" CHECK ("decision" IN ('APPROVED', 'REJECTED'))
);
CREATE INDEX "reimbursement_approvals_claim_idx" ON "reimbursement_approvals"("claim_id", "created_at");
ALTER TABLE "reimbursement_approvals" ADD CONSTRAINT "reimbursement_approvals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reimbursement_approvals" ADD CONSTRAINT "reimbursement_approvals_claim_fkey" FOREIGN KEY ("claim_id") REFERENCES "reimbursement_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Claims already decided keep a one-line trail.
INSERT INTO "reimbursement_approvals" ("id", "organization_id", "claim_id", "step", "decision", "decided_by_id", "note", "created_at")
SELECT gen_random_uuid(), "organization_id", "id", 'MANAGER', CASE WHEN "status" = 'REJECTED' THEN 'REJECTED' ELSE 'APPROVED' END, "reviewed_by_id", "review_note", COALESCE("reviewed_at", "updated_at")
FROM "reimbursement_claims" WHERE "status" IN ('APPROVED', 'REJECTED', 'PAID') AND "reviewed_at" IS NOT NULL;
