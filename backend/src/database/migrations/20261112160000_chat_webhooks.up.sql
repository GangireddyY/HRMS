-- Slack and Microsoft Teams alerts: a webhook can post a chat message instead of signed JSON. Their incoming-webhook
-- URLs are credentials, so the real URL is encrypted (url_encrypted) and "url" keeps a masked copy for display.
ALTER TABLE "webhook_endpoints" ADD COLUMN "format" VARCHAR(8) NOT NULL DEFAULT 'JSON';
ALTER TABLE "webhook_endpoints" ADD COLUMN "url_encrypted" TEXT;
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_format_check" CHECK ("format" IN ('JSON', 'SLACK', 'TEAMS'));
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_chat_url_check" CHECK ("format" = 'JSON' OR "url_encrypted" IS NOT NULL);
