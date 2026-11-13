DELETE FROM "webhook_endpoints" WHERE "format" <> 'JSON';
ALTER TABLE "webhook_endpoints" DROP CONSTRAINT "webhook_endpoints_chat_url_check";
ALTER TABLE "webhook_endpoints" DROP CONSTRAINT "webhook_endpoints_format_check";
ALTER TABLE "webhook_endpoints" DROP COLUMN "url_encrypted";
ALTER TABLE "webhook_endpoints" DROP COLUMN "format";
