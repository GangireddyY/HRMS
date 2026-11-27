-- Which organization roles may open the connected Vector workspace (org admins with integration.manage always can).
ALTER TABLE "organization_vector_connectors"
  ADD COLUMN IF NOT EXISTS "allowed_role_ids" UUID[] NOT NULL DEFAULT '{}';
