-- Per-organization Vector workspace embed connector (publishable + secret keys from Vector → Integrations → Workspace embed).
CREATE TABLE "organization_vector_connectors" (
    "organization_id" UUID NOT NULL,
    "api_base_url" VARCHAR(300) NOT NULL,
    "app_origin" VARCHAR(300),
    "publishable_key" VARCHAR(64) NOT NULL,
    "secret_key_encrypted" TEXT NOT NULL,
    "secret_prefix" VARCHAR(20) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "vector_org_name" VARCHAR(200),
    "vector_org_slug" VARCHAR(120),
    "last_connected_at" TIMESTAMPTZ(3),
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_vector_connectors_pkey" PRIMARY KEY ("organization_id")
);
ALTER TABLE "organization_vector_connectors" ADD CONSTRAINT "organization_vector_connectors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_vector_connectors" ADD CONSTRAINT "organization_vector_connectors_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "organization_vector_connectors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_vector_connectors" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "organization_vector_connectors" USING ("hrms_tenant_visible"("organization_id")) WITH CHECK ("hrms_tenant_visible"("organization_id"));
