ALTER TABLE "payroll_settings" DROP CONSTRAINT IF EXISTS "payroll_settings_timesheets_check";
ALTER TABLE "payroll_settings"
    DROP COLUMN IF EXISTS "timesheet_missed_action",
    DROP COLUMN IF EXISTS "timesheet_due_weekday",
    DROP COLUMN IF EXISTS "timesheets_from",
    DROP COLUMN IF EXISTS "timesheets_required";
DROP TABLE IF EXISTS "timesheets";
