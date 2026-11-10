ALTER TABLE "candidates" DROP COLUMN IF EXISTS "erased_at";
ALTER TABLE "employees" DROP CONSTRAINT IF EXISTS "employees_erasure_level_check";
ALTER TABLE "employees" DROP COLUMN IF EXISTS "erasure_level", DROP COLUMN IF EXISTS "erased_at";
DROP TABLE IF EXISTS "privacy_settings";
