-- Personal-data handling (India DPDP Act 2023): retention schedules per organization, and markers on erased records.
CREATE TABLE "privacy_settings" (
    "organization_id" UUID NOT NULL,
    -- Statutory payroll and PF records are kept this long after exit; then the record can be fully anonymized.
    "exited_retention_years" SMALLINT NOT NULL DEFAULT 8,
    -- Candidates who weren't hired are anonymized this long after their last activity (0 = never automatically).
    "candidate_retention_months" SMALLINT NOT NULL DEFAULT 12,
    "candidates_purged_at" TIMESTAMPTZ(3),
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "privacy_settings_pkey" PRIMARY KEY ("organization_id"),
    CONSTRAINT "privacy_settings_retention_check" CHECK ("exited_retention_years" BETWEEN 1 AND 30 AND "candidate_retention_months" BETWEEN 0 AND 120)
);
ALTER TABLE "privacy_settings" ADD CONSTRAINT "privacy_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "privacy_settings" ADD CONSTRAINT "privacy_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- PARTIAL: personal details removed, statutory data kept (within retention). FULL: anonymized (after retention).
ALTER TABLE "employees" ADD COLUMN "erased_at" TIMESTAMPTZ(3), ADD COLUMN "erasure_level" VARCHAR(7);
ALTER TABLE "employees" ADD CONSTRAINT "employees_erasure_level_check" CHECK ("erasure_level" IS NULL OR "erasure_level" IN ('PARTIAL', 'FULL'));
ALTER TABLE "candidates" ADD COLUMN "erased_at" TIMESTAMPTZ(3);
