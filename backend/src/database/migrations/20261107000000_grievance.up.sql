-- Grievances and POSH complaints: cases, notes (shared with the complainant or internal), evidence files and a timeline.
-- Complaint details, notes and resolutions are stored encrypted (application-level AES-256-GCM).

-- CreateTable
CREATE TABLE "grievance_cases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    -- GRV-0001 for grievances, POSH-0001 for POSH complaints (separate sequences).
    "reference" VARCHAR(16) NOT NULL,
    "category" VARCHAR(16) NOT NULL,
    "subject" VARCHAR(150) NOT NULL,
    -- Encrypted JSON: description, witnesses, reason for a late POSH complaint, interim relief, conciliation request.
    "details_encrypted" TEXT NOT NULL,
    "complainant_id" UUID NOT NULL,
    "respondent_id" UUID,
    "respondent_name" VARCHAR(150),
    "incident_date" DATE,
    "incident_location" VARCHAR(200),
    "priority" VARCHAR(8) NOT NULL DEFAULT 'MEDIUM',
    "status" VARCHAR(14) NOT NULL DEFAULT 'SUBMITTED',
    "assignee_user_id" UUID,
    "submitted_on" DATE NOT NULL,
    "due_on" DATE NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(3),
    "outcome" VARCHAR(18),
    -- Encrypted JSON: summary (shared with the complainant) and actions taken (internal).
    "resolution_encrypted" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_on" DATE,
    "resolved_by_id" UUID,
    "reopened" BOOLEAN NOT NULL DEFAULT false,
    "accepted_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "withdrawn_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "grievance_cases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "grievance_cases_category_check" CHECK ("category" IN ('WORKPLACE', 'MANAGER', 'PAY_BENEFITS', 'DISCRIMINATION', 'HARASSMENT', 'SAFETY', 'POLICY', 'OTHER', 'POSH')),
    CONSTRAINT "grievance_cases_reference_check" CHECK (("category" = 'POSH') = ("reference" LIKE 'POSH-%')),
    CONSTRAINT "grievance_cases_priority_check" CHECK ("priority" IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
    CONSTRAINT "grievance_cases_status_check" CHECK ("status" IN ('SUBMITTED', 'IN_REVIEW', 'INVESTIGATING', 'RESOLVED', 'CLOSED', 'WITHDRAWN')),
    CONSTRAINT "grievance_cases_outcome_check" CHECK ("outcome" IS NULL OR "outcome" IN ('UPHELD', 'PARTIALLY_UPHELD', 'NOT_UPHELD', 'SETTLED')),
    CONSTRAINT "grievance_cases_resolution_check" CHECK (("status" IN ('RESOLVED', 'CLOSED') AND "withdrawn_at" IS NULL) = ("outcome" IS NOT NULL AND "resolved_on" IS NOT NULL)),
    CONSTRAINT "grievance_cases_respondent_check" CHECK ("respondent_id" IS NULL OR "respondent_id" <> "complainant_id"),
    CONSTRAINT "grievance_cases_due_check" CHECK ("due_on" >= "submitted_on")
);

-- CreateTable
CREATE TABLE "grievance_notes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "author_user_id" UUID,
    "from_complainant" BOOLEAN NOT NULL,
    "visibility" VARCHAR(8) NOT NULL,
    "body_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grievance_notes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "grievance_notes_visibility_check" CHECK ("visibility" IN ('SHARED', 'INTERNAL') AND (NOT "from_complainant" OR "visibility" = 'SHARED'))
);

-- CreateTable
CREATE TABLE "grievance_attachments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "uploaded_by_id" UUID,
    "from_complainant" BOOLEAN NOT NULL,
    "visibility" VARCHAR(8) NOT NULL,
    "storage_key" VARCHAR(300) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grievance_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "grievance_attachments_visibility_check" CHECK ("visibility" IN ('SHARED', 'INTERNAL') AND (NOT "from_complainant" OR "visibility" = 'SHARED')),
    CONSTRAINT "grievance_attachments_size_check" CHECK ("size_bytes" > 0)
);

-- CreateTable
CREATE TABLE "grievance_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "type" VARCHAR(20) NOT NULL,
    "from_status" VARCHAR(14),
    "to_status" VARCHAR(14),
    -- Non-confidential wording only (e.g. "Assigned to Priya Rao"); internal events are hidden from the complainant.
    "detail" VARCHAR(300),
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grievance_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "grievance_cases_id_organization_id_key" ON "grievance_cases"("id", "organization_id");
CREATE UNIQUE INDEX "grievance_cases_organization_id_reference_key" ON "grievance_cases"("organization_id", "reference");
CREATE INDEX "grievance_cases_organization_id_status_idx" ON "grievance_cases"("organization_id", "status", "due_on");
CREATE INDEX "grievance_cases_complainant_id_idx" ON "grievance_cases"("complainant_id");
CREATE INDEX "grievance_cases_respondent_id_idx" ON "grievance_cases"("respondent_id");
CREATE INDEX "grievance_cases_assignee_user_id_idx" ON "grievance_cases"("assignee_user_id");
CREATE INDEX "grievance_notes_case_id_idx" ON "grievance_notes"("case_id", "created_at");
CREATE INDEX "grievance_attachments_case_id_idx" ON "grievance_attachments"("case_id");
CREATE INDEX "grievance_events_case_id_idx" ON "grievance_events"("case_id", "created_at");

-- AddForeignKey (organization)
ALTER TABLE "grievance_cases" ADD CONSTRAINT "grievance_cases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grievance_notes" ADD CONSTRAINT "grievance_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grievance_attachments" ADD CONSTRAINT "grievance_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grievance_events" ADD CONSTRAINT "grievance_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (tenant-safe composite references). A complaint keeps the complainant from being deleted; deleting the
-- respondent keeps the case and clears only respondent_id (column lists on SET NULL need PostgreSQL 15 or newer).
ALTER TABLE "grievance_cases" ADD CONSTRAINT "grievance_cases_complainant_id_organization_id_fkey" FOREIGN KEY ("complainant_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grievance_cases" ADD CONSTRAINT "grievance_cases_respondent_id_organization_id_fkey" FOREIGN KEY ("respondent_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE SET NULL ("respondent_id") ON UPDATE CASCADE;
ALTER TABLE "grievance_notes" ADD CONSTRAINT "grievance_notes_case_id_organization_id_fkey" FOREIGN KEY ("case_id", "organization_id") REFERENCES "grievance_cases"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grievance_attachments" ADD CONSTRAINT "grievance_attachments_case_id_organization_id_fkey" FOREIGN KEY ("case_id", "organization_id") REFERENCES "grievance_cases"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grievance_events" ADD CONSTRAINT "grievance_events_case_id_organization_id_fkey" FOREIGN KEY ("case_id", "organization_id") REFERENCES "grievance_cases"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (actors)
ALTER TABLE "grievance_cases" ADD CONSTRAINT "grievance_cases_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grievance_cases" ADD CONSTRAINT "grievance_cases_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grievance_cases" ADD CONSTRAINT "grievance_cases_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grievance_notes" ADD CONSTRAINT "grievance_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grievance_attachments" ADD CONSTRAINT "grievance_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grievance_events" ADD CONSTRAINT "grievance_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
