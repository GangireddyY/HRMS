DROP TABLE IF EXISTS "leave_ledger_entries";
DROP FUNCTION IF EXISTS "leave_ledger_append_only"();
DROP TABLE IF EXISTS "leave_requests";
DROP TABLE IF EXISTS "leave_types";
ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "organizations_leave_year_start_month_check", DROP COLUMN IF EXISTS "leave_year_start_month";
