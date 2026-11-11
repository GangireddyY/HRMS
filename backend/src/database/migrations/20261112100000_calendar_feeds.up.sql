-- Personal calendar feeds: a secret subscription URL per member (SHA-256 of the token) that Google Calendar, Outlook
-- or Apple Calendar poll for their leave, 1:1s, interviews and holidays.
ALTER TABLE "organization_memberships" ADD COLUMN "calendar_feed_token_hash" VARCHAR(64);
CREATE UNIQUE INDEX "organization_memberships_calendar_feed_uq" ON "organization_memberships"("calendar_feed_token_hash") WHERE "calendar_feed_token_hash" IS NOT NULL;
