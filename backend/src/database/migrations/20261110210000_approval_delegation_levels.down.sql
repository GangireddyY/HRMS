ALTER TABLE "leave_requests" DROP CONSTRAINT IF EXISTS "leave_requests_approval_level_check",
    DROP COLUMN IF EXISTS "approval_trail", DROP COLUMN IF EXISTS "approval_levels", DROP COLUMN IF EXISTS "approval_level";
ALTER TABLE "leave_types" DROP CONSTRAINT IF EXISTS "leave_types_second_approval_check", DROP CONSTRAINT IF EXISTS "leave_types_approval_levels_check",
    DROP COLUMN IF EXISTS "second_approval_min_days", DROP COLUMN IF EXISTS "approval_levels";
DROP TABLE IF EXISTS "approval_delegations";
