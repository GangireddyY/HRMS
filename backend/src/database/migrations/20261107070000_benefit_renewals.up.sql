-- Benefit plan renewals: the plan for the next policy period, and enrolments carried over to it.

ALTER TABLE "benefit_plans" ADD COLUMN "renewed_from_id" UUID;
-- One renewal per plan.
CREATE UNIQUE INDEX "benefit_plans_renewed_from_id_key" ON "benefit_plans"("renewed_from_id") WHERE "renewed_from_id" IS NOT NULL;
ALTER TABLE "benefit_plans" ADD CONSTRAINT "benefit_plans_renewed_from_id_organization_id_fkey" FOREIGN KEY ("renewed_from_id", "organization_id") REFERENCES "benefit_plans"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "benefit_plans" ADD CONSTRAINT "benefit_plans_renewed_from_check" CHECK ("renewed_from_id" IS NULL OR "renewed_from_id" <> "id");

ALTER TABLE "benefit_enrollments" DROP CONSTRAINT "benefit_enrollments_reason_check";
ALTER TABLE "benefit_enrollments" ADD CONSTRAINT "benefit_enrollments_reason_check" CHECK ("reason" IN ('OPEN_ENROLLMENT', 'NEW_JOINER', 'LIFE_EVENT', 'HR', 'RENEWAL'));
