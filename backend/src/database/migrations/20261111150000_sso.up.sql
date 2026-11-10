-- Single sign-on with an OpenID Connect identity provider, per organization, and the short-lived state of sign-ins
-- in progress (the browser is away at the identity provider).

CREATE TABLE "organization_sso_configs" (
    "organization_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "issuer" VARCHAR(500) NOT NULL,
    "client_id" VARCHAR(300) NOT NULL,
    "client_secret_encrypted" TEXT,
    -- Work email domains that sign in through this provider (lowercase, unique across organizations).
    "email_domains" VARCHAR(253)[] NOT NULL DEFAULT '{}',
    -- Members sign in only through SSO; organization admins keep their password as a fallback.
    "required" BOOLEAN NOT NULL DEFAULT false,
    -- Create a membership (with the default role) for someone from an allowed domain who isn't a member yet.
    "auto_provision" BOOLEAN NOT NULL DEFAULT false,
    "default_role_key" VARCHAR(60) NOT NULL DEFAULT 'employee',
    "button_label" VARCHAR(60),
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_sso_configs_pkey" PRIMARY KEY ("organization_id")
);
CREATE INDEX "organization_sso_configs_domains_idx" ON "organization_sso_configs" USING GIN ("email_domains");
ALTER TABLE "organization_sso_configs" ADD CONSTRAINT "organization_sso_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sso_login_states" (
    -- SHA-256 of the state sent to the identity provider (the raw value is never stored).
    "id" CHAR(64) NOT NULL,
    "organization_id" UUID NOT NULL,
    "nonce" VARCHAR(64) NOT NULL,
    "code_verifier" VARCHAR(128) NOT NULL,
    "return_to" VARCHAR(300),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_login_states_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sso_login_states_expires_idx" ON "sso_login_states"("expires_at");
ALTER TABLE "sso_login_states" ADD CONSTRAINT "sso_login_states_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
