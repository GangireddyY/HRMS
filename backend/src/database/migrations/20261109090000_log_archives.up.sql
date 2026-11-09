-- Archives of the audit trail and login history: records are saved to a file before they can be deleted.

CREATE TABLE "log_archives" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "records_before" TIMESTAMPTZ(3) NOT NULL,
    "first_record_at" TIMESTAMPTZ(3),
    "last_record_at" TIMESTAMPTZ(3),
    "record_count" INTEGER NOT NULL,
    "file_name" VARCHAR(200) NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ARCHIVED',
    "downloaded_at" TIMESTAMPTZ(3),
    "purged_at" TIMESTAMPTZ(3),
    "purged_count" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "purged_by_id" UUID,

    CONSTRAINT "log_archives_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "log_archives_kind_check" CHECK ("kind" IN ('AUDIT_LOG', 'LOGIN_HISTORY')),
    CONSTRAINT "log_archives_status_check" CHECK ("status" IN ('ARCHIVED', 'PURGED')),
    CONSTRAINT "log_archives_record_count_check" CHECK ("record_count" > 0)
);

CREATE INDEX "log_archives_organization_id_created_at_idx" ON "log_archives"("organization_id", "created_at");

ALTER TABLE "log_archives" ADD CONSTRAINT "log_archives_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "log_archives" ADD CONSTRAINT "log_archives_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "log_archives" ADD CONSTRAINT "log_archives_purged_by_id_fkey" FOREIGN KEY ("purged_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The audit trail stays append-only; the only delete allowed is an archive purge, which sets
-- `hrms.audit_purge` for its own transaction (SET LOCAL) after the archive file has been saved.
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('hrms.audit_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only (attempted %)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
