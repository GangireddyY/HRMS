ALTER TABLE "policies" DROP CONSTRAINT IF EXISTS "policies_current_version_id_organization_id_fkey";
DROP TABLE IF EXISTS "compliance_filings";
DROP TABLE IF EXISTS "compliance_obligations";
DROP TABLE IF EXISTS "policy_acknowledgements";
DROP TABLE IF EXISTS "policy_versions";
DROP TABLE IF EXISTS "policies";
