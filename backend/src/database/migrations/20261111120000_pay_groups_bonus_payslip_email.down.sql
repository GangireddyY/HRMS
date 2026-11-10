ALTER TABLE "payroll_settings"
    DROP CONSTRAINT IF EXISTS "payroll_settings_payslip_pdf_password_check",
    DROP COLUMN IF EXISTS "payslip_email_enabled",
    DROP COLUMN IF EXISTS "payslip_pdf_password";
ALTER TABLE "payroll_adjustments" DROP CONSTRAINT IF EXISTS "payroll_adjustments_category_check", DROP COLUMN IF EXISTS "category";
DROP INDEX IF EXISTS "payroll_runs_one_per_month_key";
ALTER TABLE "payroll_runs" DROP CONSTRAINT IF EXISTS "payroll_runs_pay_group_fkey", DROP COLUMN IF EXISTS "pay_group_id";
CREATE UNIQUE INDEX "payroll_runs_one_per_month_key" ON "payroll_runs"("organization_id", "year", "month") WHERE "status" <> 'CANCELLED';
ALTER TABLE "employees" DROP CONSTRAINT IF EXISTS "employees_pay_group_fkey", DROP COLUMN IF EXISTS "pay_group_id";
DROP TABLE IF EXISTS "pay_groups";
