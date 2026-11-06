DROP TABLE IF EXISTS "attendance_periods";
DROP TABLE IF EXISTS "attendance_regularizations";
DROP TABLE IF EXISTS "attendance_records";
DROP TABLE IF EXISTS "holidays";
ALTER TABLE "employees" DROP CONSTRAINT IF EXISTS "employees_shift_id_organization_id_fkey";
ALTER TABLE "employees" DROP COLUMN IF EXISTS "shift_id";
DROP TABLE IF EXISTS "shifts";
