ALTER TABLE "benefit_enrollments" DROP CONSTRAINT "benefit_enrollments_reason_check";
UPDATE "benefit_enrollments" SET "reason" = 'HR' WHERE "reason" = 'RENEWAL';
ALTER TABLE "benefit_enrollments" ADD CONSTRAINT "benefit_enrollments_reason_check" CHECK ("reason" IN ('OPEN_ENROLLMENT', 'NEW_JOINER', 'LIFE_EVENT', 'HR'));
ALTER TABLE "benefit_plans" DROP CONSTRAINT IF EXISTS "benefit_plans_renewed_from_check";
ALTER TABLE "benefit_plans" DROP CONSTRAINT IF EXISTS "benefit_plans_renewed_from_id_organization_id_fkey";
DROP INDEX IF EXISTS "benefit_plans_renewed_from_id_key";
ALTER TABLE "benefit_plans" DROP COLUMN IF EXISTS "renewed_from_id";
