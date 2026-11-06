DROP TABLE IF EXISTS "probation_reviews";
DROP TABLE IF EXISTS "onboarding_tasks";
DROP TABLE IF EXISTS "onboarding_cases";
DROP TABLE IF EXISTS "onboarding_template_tasks";
DROP TABLE IF EXISTS "onboarding_templates";
DELETE FROM "employee_lifecycle_events" WHERE "type" = 'PROBATION_EXTENDED';
ALTER TABLE "employee_lifecycle_events" DROP CONSTRAINT "employee_lifecycle_events_type_check";
ALTER TABLE "employee_lifecycle_events" ADD CONSTRAINT "employee_lifecycle_events_type_check"
    CHECK ("type" IN ('JOINED', 'TRANSFER', 'PROMOTION', 'MANAGER_CHANGE', 'STATUS_CHANGE', 'CONFIRMATION'));
ALTER TABLE "employees" DROP COLUMN IF EXISTS "confirmed_on";
