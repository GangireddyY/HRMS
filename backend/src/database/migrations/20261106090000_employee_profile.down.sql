DROP TABLE IF EXISTS "employee_documents";
DROP TABLE IF EXISTS "employee_experience";
DROP TABLE IF EXISTS "employee_education";
DROP TABLE IF EXISTS "employee_family_members";

ALTER TABLE "employees"
    DROP CONSTRAINT IF EXISTS "employees_grade_id_organization_id_fkey",
    DROP CONSTRAINT IF EXISTS "employees_cost_center_id_organization_id_fkey",
    DROP COLUMN IF EXISTS "grade_id",
    DROP COLUMN IF EXISTS "cost_center_id",
    DROP COLUMN IF EXISTS "marital_status",
    DROP COLUMN IF EXISTS "blood_group",
    DROP COLUMN IF EXISTS "nationality",
    DROP COLUMN IF EXISTS "permanent_address",
    DROP COLUMN IF EXISTS "notice_period_days",
    DROP COLUMN IF EXISTS "aadhaar_encrypted",
    DROP COLUMN IF EXISTS "aadhaar_last4",
    DROP COLUMN IF EXISTS "passport_encrypted",
    DROP COLUMN IF EXISTS "passport_expiry";

DROP TABLE IF EXISTS "cost_centers";
DROP TABLE IF EXISTS "grades";
