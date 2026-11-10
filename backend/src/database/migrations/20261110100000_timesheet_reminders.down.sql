ALTER TABLE "payroll_settings"
    DROP COLUMN IF EXISTS "timesheet_overdue_reminded",
    DROP COLUMN IF EXISTS "timesheet_due_reminded",
    DROP COLUMN IF EXISTS "timesheet_auto_remind";
