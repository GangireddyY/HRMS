-- Per-person email choices for notifications: { "email": false } turns email off, "muted" lists categories not emailed.
ALTER TABLE "users" ADD COLUMN "notification_settings" JSONB NOT NULL DEFAULT '{}';
