-- Automatic timesheet reminders: on the due day and the day after. The *_reminded columns hold the Monday of the last
-- week reminded, so each reminder goes out once even with several servers or a restart.
ALTER TABLE "payroll_settings"
    ADD COLUMN "timesheet_auto_remind" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "timesheet_due_reminded" DATE,
    ADD COLUMN "timesheet_overdue_reminded" DATE;
