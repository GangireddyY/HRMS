DROP TABLE IF EXISTS "offer_documents";
DROP INDEX IF EXISTS "offers_portal_token_hash_key";
ALTER TABLE "offers" DROP CONSTRAINT IF EXISTS "offers_approval_status_check",
    DROP CONSTRAINT IF EXISTS "offers_approved_by_id_fkey",
    DROP CONSTRAINT IF EXISTS "offers_approval_requested_by_id_fkey",
    DROP COLUMN IF EXISTS "approval_status", DROP COLUMN IF EXISTS "approval_requested_at", DROP COLUMN IF EXISTS "approval_requested_by_id",
    DROP COLUMN IF EXISTS "approved_by_id", DROP COLUMN IF EXISTS "approved_at", DROP COLUMN IF EXISTS "approval_note",
    DROP COLUMN IF EXISTS "letter_html", DROP COLUMN IF EXISTS "letter_hash", DROP COLUMN IF EXISTS "portal_token_hash", DROP COLUMN IF EXISTS "portal_expires_at",
    DROP COLUMN IF EXISTS "signed_name", DROP COLUMN IF EXISTS "signed_at", DROP COLUMN IF EXISTS "signed_ip", DROP COLUMN IF EXISTS "signed_user_agent",
    DROP COLUMN IF EXISTS "prejoining_encrypted", DROP COLUMN IF EXISTS "prejoining_submitted_at";
DROP TABLE IF EXISTS "letter_templates";
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "offer_approval_required";
