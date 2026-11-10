-- Offers: optional approval before release, letters from a template, built-in e-signature and a pre-joining portal.
ALTER TABLE "organizations" ADD COLUMN "offer_approval_required" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "letter_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "letter_templates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "letter_templates_kind_check" CHECK ("kind" IN ('OFFER')),
    CONSTRAINT "letter_templates_body_check" CHECK (length("body") BETWEEN 20 AND 20000)
);
CREATE UNIQUE INDEX "letter_templates_organization_id_kind_key" ON "letter_templates"("organization_id", "kind");
ALTER TABLE "letter_templates" ADD CONSTRAINT "letter_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "letter_templates" ADD CONSTRAINT "letter_templates_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "offers"
    ADD COLUMN "approval_status" VARCHAR(12) NOT NULL DEFAULT 'NOT_REQUIRED',
    ADD COLUMN "approval_requested_at" TIMESTAMPTZ(3),
    ADD COLUMN "approval_requested_by_id" UUID,
    ADD COLUMN "approved_by_id" UUID,
    ADD COLUMN "approved_at" TIMESTAMPTZ(3),
    ADD COLUMN "approval_note" VARCHAR(500),
    -- The letter exactly as released (what the candidate signs), and its SHA-256.
    ADD COLUMN "letter_html" TEXT,
    ADD COLUMN "letter_hash" CHAR(64),
    -- Candidate portal: only the SHA-256 of the link token is kept.
    ADD COLUMN "portal_token_hash" CHAR(64),
    ADD COLUMN "portal_expires_at" TIMESTAMPTZ(3),
    ADD COLUMN "signed_name" VARCHAR(200),
    ADD COLUMN "signed_at" TIMESTAMPTZ(3),
    ADD COLUMN "signed_ip" VARCHAR(64),
    ADD COLUMN "signed_user_agent" VARCHAR(300),
    -- Personal details from the pre-joining portal (encrypted JSON).
    ADD COLUMN "prejoining_encrypted" TEXT,
    ADD COLUMN "prejoining_submitted_at" TIMESTAMPTZ(3),
    ADD CONSTRAINT "offers_approval_status_check" CHECK ("approval_status" IN ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED'));
CREATE UNIQUE INDEX "offers_portal_token_hash_key" ON "offers"("portal_token_hash") WHERE "portal_token_hash" IS NOT NULL;
ALTER TABLE "offers" ADD CONSTRAINT "offers_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_approval_requested_by_id_fkey" FOREIGN KEY ("approval_requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Documents the candidate uploads before joining; moved to the employee's documents on hire.
CREATE TABLE "offer_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "offer_documents_category_check" CHECK ("category" IN ('IDENTITY', 'ADDRESS', 'EDUCATION', 'EXPERIENCE', 'CERTIFICATION', 'MEDICAL', 'OTHER'))
);
CREATE INDEX "offer_documents_offer_id_idx" ON "offer_documents"("offer_id");
ALTER TABLE "offer_documents" ADD CONSTRAINT "offer_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offer_documents" ADD CONSTRAINT "offer_documents_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
