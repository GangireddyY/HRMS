DROP TABLE IF EXISTS "shift_swaps";
ALTER TABLE "attendance_records" DROP COLUMN IF EXISTS "check_in_photo_key";
ALTER TABLE "locations" DROP COLUMN IF EXISTS "allowed_networks", DROP COLUMN IF EXISTS "punch_photo_required";
