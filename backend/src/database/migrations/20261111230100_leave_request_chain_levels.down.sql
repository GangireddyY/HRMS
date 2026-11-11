ALTER TABLE "leave_requests" DROP CONSTRAINT "leave_requests_approval_level_check";
UPDATE "leave_requests" SET "approval_levels" = LEAST("approval_levels", 2), "approval_level" = LEAST("approval_level", LEAST("approval_levels", 2));
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approval_level_check" CHECK ("approval_levels" BETWEEN 1 AND 2 AND "approval_level" BETWEEN 1 AND "approval_levels");
