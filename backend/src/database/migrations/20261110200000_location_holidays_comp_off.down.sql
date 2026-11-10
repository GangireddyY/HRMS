DROP TABLE IF EXISTS "comp_off_requests";
DROP INDEX IF EXISTS "leave_types_one_comp_off_key";
ALTER TABLE "leave_types" DROP CONSTRAINT IF EXISTS "leave_types_comp_off_check", DROP COLUMN IF EXISTS "comp_off_validity_days";

DROP INDEX IF EXISTS "holidays_organization_id_date_idx";
DROP INDEX IF EXISTS "holidays_organization_id_date_all_key";
-- Location-specific holidays sharing a date with another holiday can't fit the old one-per-date rule.
DELETE FROM "holidays" h USING "holidays" o
 WHERE h."organization_id" = o."organization_id" AND h."date" = o."date" AND h."id" <> o."id" AND h."location_ids" <> '{}';
CREATE UNIQUE INDEX "holidays_organization_id_date_key" ON "holidays"("organization_id", "date");
ALTER TABLE "holidays" DROP COLUMN IF EXISTS "location_ids";
