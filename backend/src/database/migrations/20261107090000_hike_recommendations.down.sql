DROP TABLE IF EXISTS "hike_recommendations";
ALTER TABLE "performance_cycles" DROP CONSTRAINT IF EXISTS "performance_cycles_hike_check";
ALTER TABLE "performance_cycles" DROP COLUMN IF EXISTS "hike_effective_from", DROP COLUMN IF EXISTS "hike_budget_percent", DROP COLUMN IF EXISTS "merit_matrix";
