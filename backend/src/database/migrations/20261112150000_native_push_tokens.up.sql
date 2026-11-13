-- Push notifications to the HRMS phone app (Firebase Cloud Messaging; iOS through APNs). Personal, like
-- push_subscriptions: one row per installed app a person signed in on.
CREATE TABLE "native_push_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" VARCHAR(8) NOT NULL,
    -- The FCM registration token of the installation (unique; rotates).
    "token" VARCHAR(4096) NOT NULL,
    "device_name" VARCHAR(120),
    "app_version" VARCHAR(30),
    "last_sent_at" TIMESTAMPTZ(3),
    "failure_count" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "native_push_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "native_push_tokens_platform_check" CHECK ("platform" IN ('ANDROID', 'IOS'))
);
CREATE UNIQUE INDEX "native_push_tokens_token_uq" ON "native_push_tokens"("token");
CREATE INDEX "native_push_tokens_user_idx" ON "native_push_tokens"("user_id");
ALTER TABLE "native_push_tokens" ADD CONSTRAINT "native_push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
