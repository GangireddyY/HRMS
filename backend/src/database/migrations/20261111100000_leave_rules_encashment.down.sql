DROP TABLE IF EXISTS "leave_encashments";
ALTER TABLE "payroll_settings" DROP CONSTRAINT IF EXISTS "payroll_settings_leave_encashment_basis_check", DROP COLUMN IF EXISTS "leave_encashment_basis";
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "leave_accruals_run_on";
ALTER TABLE "leave_types"
    DROP CONSTRAINT IF EXISTS "leave_types_max_balance_check",
    DROP CONSTRAINT IF EXISTS "leave_types_encash_max_check",
    DROP CONSTRAINT IF EXISTS "leave_types_encash_min_check",
    DROP COLUMN IF EXISTS "location_ids",
    DROP COLUMN IF EXISTS "employment_types",
    DROP COLUMN IF EXISTS "grade_ids",
    DROP COLUMN IF EXISTS "max_balance",
    DROP COLUMN IF EXISTS "encash_max_days",
    DROP COLUMN IF EXISTS "encash_min_balance";
