DROP TABLE IF EXISTS "tax_declaration_proofs";
ALTER TABLE "employees" DROP COLUMN IF EXISTS "esi_number";
ALTER TABLE "payroll_settings" DROP CONSTRAINT IF EXISTS "payroll_settings_proofs_from_month_check",
    DROP COLUMN IF EXISTS "proofs_from_month", DROP COLUMN IF EXISTS "lwf_enabled";
