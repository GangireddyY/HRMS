-- People explicitly blocked from opening Vector even when their role is allowed.
ALTER TABLE "organization_vector_connectors"
  ADD COLUMN IF NOT EXISTS "denied_user_ids" UUID[] NOT NULL DEFAULT '{}';
