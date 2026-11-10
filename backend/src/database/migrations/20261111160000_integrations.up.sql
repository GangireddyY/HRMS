-- Integrations: read-only API keys that act for their creator within chosen permissions, and webhooks that deliver
-- the organization's events (signed) to an endpoint, with a log of deliveries.

CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    -- Shown to tell keys apart (hrms_xxxxxxxx); only the SHA-256 of the full key is stored.
    "prefix" VARCHAR(20) NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "permissions" VARCHAR(100)[] NOT NULL DEFAULT '{}',
    "created_by_id" UUID NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "last_used_ip" VARCHAR(64),
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");
CREATE INDEX "api_keys_organization_idx" ON "api_keys"("organization_id", "created_at");
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "description" VARCHAR(200),
    -- Event patterns: "*", "leave.*" or an exact event such as "leave.request_approved".
    "events" VARCHAR(100)[] NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "disabled_reason" VARCHAR(200),
    "last_delivery_at" TIMESTAMPTZ(3),
    "last_status" SMALLINT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "webhook_endpoints_id_organization_id_key" ON "webhook_endpoints"("id", "organization_id");
CREATE INDEX "webhook_endpoints_organization_idx" ON "webhook_endpoints"("organization_id") WHERE "enabled";
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "event" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(8) NOT NULL DEFAULT 'PENDING',
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "response_status" SMALLINT,
    "response_body" VARCHAR(1000),
    "error" VARCHAR(500),
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "webhook_deliveries_status_check" CHECK ("status" IN ('PENDING', 'SUCCESS', 'FAILED'))
);
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries"("endpoint_id", "created_at" DESC);
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_fkey" FOREIGN KEY ("endpoint_id", "organization_id") REFERENCES "webhook_endpoints"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
