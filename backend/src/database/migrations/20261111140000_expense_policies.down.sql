DROP TABLE IF EXISTS "reimbursement_approvals";
ALTER TABLE "reimbursement_claims" DROP CONSTRAINT IF EXISTS "reimbursement_claims_stage_check", DROP COLUMN IF EXISTS "approval_stage";
ALTER TABLE "payroll_settings" DROP CONSTRAINT IF EXISTS "payroll_settings_claim_finance_check", DROP COLUMN IF EXISTS "claim_finance_approval_above";
DROP TABLE IF EXISTS "expense_policies";
