ALTER TABLE "performance_reviews"
    DROP CONSTRAINT IF EXISTS "performance_reviews_potential_check",
    DROP COLUMN IF EXISTS "potential",
    DROP COLUMN IF EXISTS "potential_set_by_id",
    DROP COLUMN IF EXISTS "potential_set_at";
ALTER TABLE "performance_cycles" DROP COLUMN IF EXISTS "target_distribution";
DROP TABLE IF EXISTS "one_on_one_items";
DROP TABLE IF EXISTS "one_on_ones";
DROP TABLE IF EXISTS "okr_check_ins";
DROP TABLE IF EXISTS "okr_key_results";
DROP TABLE IF EXISTS "okr_objectives";
