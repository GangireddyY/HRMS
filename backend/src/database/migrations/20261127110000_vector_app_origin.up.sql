-- Where the Vector UI is served (may differ from CLIENT_URL when HRMS already owns :5173).
ALTER TABLE "organization_vector_connectors" ADD COLUMN IF NOT EXISTS "app_origin" VARCHAR(300);
