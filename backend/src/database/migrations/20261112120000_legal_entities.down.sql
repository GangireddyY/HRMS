ALTER TABLE "payslips" DROP COLUMN IF EXISTS "currency";
ALTER TABLE "reimbursement_claims" DROP COLUMN IF EXISTS "exchange_rate";
ALTER TABLE "reimbursement_claims" DROP COLUMN IF EXISTS "original_amount";
ALTER TABLE "reimbursement_claims" DROP COLUMN IF EXISTS "currency";
DROP TABLE IF EXISTS "exchange_rates";
ALTER TABLE "pay_groups" DROP COLUMN IF EXISTS "legal_entity_id";
DROP INDEX IF EXISTS "employees_legal_entity_idx";
ALTER TABLE "employees" DROP COLUMN IF EXISTS "legal_entity_id";
DROP TABLE IF EXISTS "legal_entities";
