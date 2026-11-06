-- Onboarding (checklist templates, cases and tasks) and probation confirmation reviews.

-- AlterTable: when the employee's probation was confirmed (NULL = not confirmed yet).
ALTER TABLE "employees" ADD COLUMN "confirmed_on" DATE;
UPDATE "employees" e SET "confirmed_on" = c."effective_date"
FROM (SELECT "employee_id", MAX("effective_date") AS "effective_date" FROM "employee_lifecycle_events" WHERE "type" = 'CONFIRMATION' GROUP BY "employee_id") c
WHERE c."employee_id" = e."id";

-- AlterTable: lifecycle history records probation extensions.
ALTER TABLE "employee_lifecycle_events" DROP CONSTRAINT "employee_lifecycle_events_type_check";
ALTER TABLE "employee_lifecycle_events" ADD CONSTRAINT "employee_lifecycle_events_type_check"
    CHECK ("type" IN ('JOINED', 'TRANSFER', 'PROMOTION', 'MANAGER_CHANGE', 'STATUS_CHANGE', 'CONFIRMATION', 'PROBATION_EXTENDED'));

-- CreateTable
CREATE TABLE "onboarding_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "onboarding_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_template_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(1000),
    "assignee" VARCHAR(10) NOT NULL,
    -- Set for "upload this document" tasks (completed when HR verifies the document).
    "document_category" VARCHAR(30),
    "due_offset_days" SMALLINT NOT NULL DEFAULT 0,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "onboarding_template_tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onboarding_template_tasks_assignee_check" CHECK ("assignee" IN ('EMPLOYEE', 'MANAGER', 'HR')),
    CONSTRAINT "onboarding_template_tasks_document_check" CHECK ("document_category" IS NULL OR "assignee" = 'EMPLOYEE'),
    CONSTRAINT "onboarding_template_tasks_offset_check" CHECK ("due_offset_days" BETWEEN -180 AND 365)
);

-- CreateTable
CREATE TABLE "onboarding_cases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "template_id" UUID,
    "status" VARCHAR(12) NOT NULL DEFAULT 'IN_PROGRESS',
    "joining_date" DATE NOT NULL,
    "buddy_id" UUID,
    "notes" VARCHAR(1000),
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "onboarding_cases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onboarding_cases_status_check" CHECK ("status" IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    CONSTRAINT "onboarding_cases_buddy_check" CHECK ("buddy_id" IS NULL OR "buddy_id" <> "employee_id")
);

-- CreateTable
CREATE TABLE "onboarding_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(1000),
    "assignee" VARCHAR(10) NOT NULL,
    "document_category" VARCHAR(30),
    -- The employee document submitted for this task (an employee_documents row of the same organization).
    "document_id" UUID,
    "due_date" DATE NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "note" VARCHAR(500),
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "onboarding_tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onboarding_tasks_assignee_check" CHECK ("assignee" IN ('EMPLOYEE', 'MANAGER', 'HR')),
    CONSTRAINT "onboarding_tasks_document_check" CHECK ("document_category" IS NULL OR "assignee" = 'EMPLOYEE'),
    CONSTRAINT "onboarding_tasks_status_check" CHECK ("status" IN ('PENDING', 'DONE', 'SKIPPED')),
    CONSTRAINT "onboarding_tasks_completion_check" CHECK (("status" = 'PENDING') = ("completed_at" IS NULL))
);

-- CreateTable
CREATE TABLE "probation_reviews" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "probation_end_date" DATE NOT NULL,
    "recommendation" VARCHAR(10) NOT NULL,
    "extend_to" DATE,
    "comments" VARCHAR(1000) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "submitted_by_id" UUID,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "probation_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "probation_reviews_recommendation_check" CHECK ("recommendation" IN ('CONFIRM', 'EXTEND')),
    CONSTRAINT "probation_reviews_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    CONSTRAINT "probation_reviews_extend_check" CHECK (("recommendation" = 'EXTEND') = ("extend_to" IS NOT NULL) AND ("extend_to" IS NULL OR "extend_to" > "probation_end_date"))
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_templates_id_organization_id_key" ON "onboarding_templates"("id", "organization_id");
CREATE UNIQUE INDEX "onboarding_templates_organization_id_name_key" ON "onboarding_templates"("organization_id", lower("name"));
CREATE UNIQUE INDEX "onboarding_templates_one_default_key" ON "onboarding_templates"("organization_id") WHERE "is_default";
CREATE INDEX "onboarding_template_tasks_template_id_idx" ON "onboarding_template_tasks"("template_id", "sort_order");
CREATE UNIQUE INDEX "onboarding_cases_id_organization_id_key" ON "onboarding_cases"("id", "organization_id");
CREATE UNIQUE INDEX "onboarding_cases_one_open_per_employee_key" ON "onboarding_cases"("employee_id") WHERE "status" = 'IN_PROGRESS';
CREATE INDEX "onboarding_cases_organization_id_status_idx" ON "onboarding_cases"("organization_id", "status", "joining_date");
CREATE INDEX "onboarding_tasks_case_id_idx" ON "onboarding_tasks"("case_id", "sort_order");
CREATE UNIQUE INDEX "probation_reviews_one_pending_key" ON "probation_reviews"("employee_id") WHERE "status" = 'PENDING';
CREATE INDEX "probation_reviews_organization_id_status_idx" ON "probation_reviews"("organization_id", "status");

-- AddForeignKey (organization)
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "onboarding_template_tasks" ADD CONSTRAINT "onboarding_template_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "onboarding_cases" ADD CONSTRAINT "onboarding_cases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "probation_reviews" ADD CONSTRAINT "probation_reviews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (tenant-safe composite references)
ALTER TABLE "onboarding_template_tasks" ADD CONSTRAINT "onboarding_template_tasks_template_id_organization_id_fkey" FOREIGN KEY ("template_id", "organization_id") REFERENCES "onboarding_templates"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "onboarding_cases" ADD CONSTRAINT "onboarding_cases_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "onboarding_cases" ADD CONSTRAINT "onboarding_cases_buddy_id_organization_id_fkey" FOREIGN KEY ("buddy_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_case_id_organization_id_fkey" FOREIGN KEY ("case_id", "organization_id") REFERENCES "onboarding_cases"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "probation_reviews" ADD CONSTRAINT "probation_reviews_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;

-- AddForeignKey (actors)
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "onboarding_cases" ADD CONSTRAINT "onboarding_cases_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "onboarding_cases" ADD CONSTRAINT "onboarding_cases_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "probation_reviews" ADD CONSTRAINT "probation_reviews_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "probation_reviews" ADD CONSTRAINT "probation_reviews_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
