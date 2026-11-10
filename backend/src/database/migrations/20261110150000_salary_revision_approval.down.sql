DROP TABLE IF EXISTS "salary_revision_requests";
ALTER TABLE "payroll_settings" DROP CONSTRAINT IF EXISTS "payroll_settings_salary_approval_threshold_check";
ALTER TABLE "payroll_settings" DROP COLUMN IF EXISTS "salary_approval_threshold_pct";
