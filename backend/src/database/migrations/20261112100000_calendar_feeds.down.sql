DROP INDEX IF EXISTS "organization_memberships_calendar_feed_uq";
ALTER TABLE "organization_memberships" DROP COLUMN IF EXISTS "calendar_feed_token_hash";
