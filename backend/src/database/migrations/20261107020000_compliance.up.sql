-- Compliance: policies (versioned, with an optional PDF), employee acknowledgements, and statutory obligations with the
-- filings made against their due dates.

-- CreateTable
CREATE TABLE "policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "category" VARCHAR(16) NOT NULL,
    "summary" VARCHAR(1000),
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "owner_user_id" UUID,
    -- Audience: null / empty = everyone.
    "department_ids" JSONB,
    "location_ids" JSONB,
    "employment_types" JSONB,
    "requires_ack" BOOLEAN NOT NULL DEFAULT true,
    "ack_due_days" INTEGER NOT NULL DEFAULT 14,
    "review_months" INTEGER,
    "next_review_on" DATE,
    "current_version_id" UUID,
    "last_reminded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "policies_category_check" CHECK ("category" IN ('CODE_OF_CONDUCT', 'HR', 'LEAVE', 'IT_SECURITY', 'DATA_PRIVACY', 'HEALTH_SAFETY', 'ANTI_BRIBERY', 'POSH', 'TRAVEL', 'OTHER')),
    CONSTRAINT "policies_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
    CONSTRAINT "policies_ack_due_check" CHECK ("ack_due_days" BETWEEN 1 AND 365),
    CONSTRAINT "policies_review_check" CHECK ("review_months" IS NULL OR "review_months" BETWEEN 1 AND 60),
    CONSTRAINT "policies_published_check" CHECK (("status" = 'DRAFT') = ("current_version_id" IS NULL))
);

-- CreateTable
CREATE TABLE "policy_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "content" TEXT,
    "file_key" VARCHAR(300),
    "file_name" VARCHAR(255),
    "file_size" INTEGER,
    "change_summary" VARCHAR(1000),
    -- Whether everyone must acknowledge this version again (a material change).
    "reacknowledge" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" DATE,
    "published_at" TIMESTAMPTZ(3),
    "published_on" DATE,
    "published_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "policy_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "policy_versions_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
    CONSTRAINT "policy_versions_published_check" CHECK (("status" = 'DRAFT') = ("published_on" IS NULL)),
    CONSTRAINT "policy_versions_file_check" CHECK (("file_key" IS NULL) = ("file_name" IS NULL) AND ("file_key" IS NULL) = ("file_size" IS NULL))
);

-- CreateTable
CREATE TABLE "policy_acknowledgements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Evidence of the acknowledgement.
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(512),

    CONSTRAINT "policy_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_obligations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "category" VARCHAR(10) NOT NULL,
    "authority" VARCHAR(150),
    "description" VARCHAR(2000),
    -- Yearly schedule of due dates as "MM-DD" (a day past the month's end means its last day).
    "due_dates" JSONB NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "owner_user_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "compliance_obligations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "compliance_obligations_category_check" CHECK ("category" IN ('PF', 'ESI', 'TDS', 'PT', 'LWF', 'GRATUITY', 'POSH', 'LABOUR', 'OTHER')),
    CONSTRAINT "compliance_obligations_dates_check" CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on")
);

-- CreateTable
CREATE TABLE "compliance_filings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "due_on" DATE NOT NULL,
    "completed_on" DATE NOT NULL,
    "reference" VARCHAR(120),
    "note" VARCHAR(1000),
    "file_key" VARCHAR(300),
    "file_name" VARCHAR(255),
    "file_type" VARCHAR(100),
    "file_size" INTEGER,
    "completed_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_filings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "compliance_filings_file_check" CHECK (("file_key" IS NULL) = ("file_name" IS NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "policies_id_organization_id_key" ON "policies"("id", "organization_id");
CREATE INDEX "policies_organization_id_status_idx" ON "policies"("organization_id", "status");
CREATE UNIQUE INDEX "policy_versions_id_organization_id_key" ON "policy_versions"("id", "organization_id");
CREATE UNIQUE INDEX "policy_versions_policy_id_version_key" ON "policy_versions"("policy_id", "version");
CREATE UNIQUE INDEX "policy_versions_one_draft_key" ON "policy_versions"("policy_id") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "policy_versions_one_published_key" ON "policy_versions"("policy_id") WHERE "status" = 'PUBLISHED';
CREATE UNIQUE INDEX "policy_acknowledgements_version_id_employee_id_key" ON "policy_acknowledgements"("version_id", "employee_id");
CREATE INDEX "policy_acknowledgements_policy_id_employee_id_idx" ON "policy_acknowledgements"("policy_id", "employee_id");
CREATE UNIQUE INDEX "compliance_obligations_id_organization_id_key" ON "compliance_obligations"("id", "organization_id");
CREATE UNIQUE INDEX "compliance_filings_obligation_id_due_on_key" ON "compliance_filings"("obligation_id", "due_on");

-- AddForeignKey (organization)
ALTER TABLE "policies" ADD CONSTRAINT "policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "policy_acknowledgements" ADD CONSTRAINT "policy_acknowledgements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_filings" ADD CONSTRAINT "compliance_filings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (tenant-safe composite references). Acknowledgements are evidence: they keep the employee and the
-- policy version from being deleted.
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_id_organization_id_fkey" FOREIGN KEY ("policy_id", "organization_id") REFERENCES "policies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "policies" ADD CONSTRAINT "policies_current_version_id_organization_id_fkey" FOREIGN KEY ("current_version_id", "organization_id") REFERENCES "policy_versions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "policy_acknowledgements" ADD CONSTRAINT "policy_acknowledgements_policy_id_organization_id_fkey" FOREIGN KEY ("policy_id", "organization_id") REFERENCES "policies"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "policy_acknowledgements" ADD CONSTRAINT "policy_acknowledgements_version_id_organization_id_fkey" FOREIGN KEY ("version_id", "organization_id") REFERENCES "policy_versions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "policy_acknowledgements" ADD CONSTRAINT "policy_acknowledgements_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "compliance_filings" ADD CONSTRAINT "compliance_filings_obligation_id_organization_id_fkey" FOREIGN KEY ("obligation_id", "organization_id") REFERENCES "compliance_obligations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (actors)
ALTER TABLE "policies" ADD CONSTRAINT "policies_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "policies" ADD CONSTRAINT "policies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "compliance_filings" ADD CONSTRAINT "compliance_filings_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
