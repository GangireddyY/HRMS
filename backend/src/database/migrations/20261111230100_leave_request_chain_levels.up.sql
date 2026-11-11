-- Leave requests on an approval chain have as many levels as the chain has steps (up to 5).
ALTER TABLE "leave_requests" DROP CONSTRAINT "leave_requests_approval_level_check";
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approval_level_check" CHECK ("approval_levels" BETWEEN 1 AND 5 AND "approval_level" BETWEEN 1 AND "approval_levels");
