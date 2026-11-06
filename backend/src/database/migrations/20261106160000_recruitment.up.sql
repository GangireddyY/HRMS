-- Recruitment: requisitions, job openings, candidates, applications (pipeline), interviews with feedback, and offers.

-- CreateTable
CREATE TABLE "job_requisitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "department_id" UUID,
    "designation_id" UUID,
    "location_id" UUID,
    "hiring_manager_id" UUID,
    "employment_type" VARCHAR(20) NOT NULL DEFAULT 'FULL_TIME',
    "openings" SMALLINT NOT NULL DEFAULT 1,
    "hired_count" SMALLINT NOT NULL DEFAULT 0,
    "reason" VARCHAR(20) NOT NULL,
    "justification" VARCHAR(1000) NOT NULL,
    "budget_min" NUMERIC(14,2),
    "budget_max" NUMERIC(14,2),
    "target_date" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "requested_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_requisitions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "job_requisitions_status_check" CHECK ("status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'FILLED')),
    CONSTRAINT "job_requisitions_reason_check" CHECK ("reason" IN ('NEW_ROLE', 'REPLACEMENT', 'EXPANSION')),
    CONSTRAINT "job_requisitions_employment_type_check" CHECK ("employment_type" IN ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN')),
    CONSTRAINT "job_requisitions_openings_check" CHECK ("openings" BETWEEN 1 AND 500 AND "hired_count" BETWEEN 0 AND "openings"),
    CONSTRAINT "job_requisitions_budget_check" CHECK ("budget_min" IS NULL OR "budget_max" IS NULL OR "budget_max" >= "budget_min")
);

-- CreateTable
CREATE TABLE "job_openings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "requisition_id" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "description" TEXT NOT NULL,
    "requirements" TEXT,
    "experience_min" SMALLINT,
    "experience_max" SMALLINT,
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    -- Listed on the public careers page while OPEN.
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "closes_on" DATE,
    "opened_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "job_openings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "job_openings_status_check" CHECK ("status" IN ('DRAFT', 'OPEN', 'ON_HOLD', 'CLOSED')),
    CONSTRAINT "job_openings_experience_check" CHECK (
        ("experience_min" IS NULL OR "experience_min" BETWEEN 0 AND 60) AND ("experience_max" IS NULL OR "experience_max" BETWEEN 0 AND 60)
        AND ("experience_min" IS NULL OR "experience_max" IS NULL OR "experience_max" >= "experience_min")
    )
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(30),
    "current_company" VARCHAR(150),
    "current_title" VARCHAR(150),
    "experience_years" NUMERIC(4,1),
    "current_ctc" NUMERIC(14,2),
    "expected_ctc" NUMERIC(14,2),
    "notice_period_days" SMALLINT,
    "location" VARCHAR(120),
    "linkedin_url" VARCHAR(300),
    "source" VARCHAR(12) NOT NULL DEFAULT 'DIRECT',
    "referred_by_id" UUID,
    "notes" VARCHAR(2000),
    "resume_key" VARCHAR(500),
    "resume_file_name" VARCHAR(255),
    "resume_content_type" VARCHAR(100),
    "resume_size" INTEGER,
    "resume_uploaded_at" TIMESTAMPTZ(3),
    -- When the candidate consented to their data being processed (career-page applications).
    "consent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "candidates_source_check" CHECK ("source" IN ('CAREERS', 'REFERRAL', 'JOB_BOARD', 'LINKEDIN', 'AGENCY', 'DIRECT', 'OTHER')),
    CONSTRAINT "candidates_numbers_check" CHECK (
        ("experience_years" IS NULL OR "experience_years" BETWEEN 0 AND 60) AND ("notice_period_days" IS NULL OR "notice_period_days" BETWEEN 0 AND 365)
        AND ("current_ctc" IS NULL OR "current_ctc" >= 0) AND ("expected_ctc" IS NULL OR "expected_ctc" >= 0)
    ),
    CONSTRAINT "candidates_resume_check" CHECK (("resume_key" IS NULL) = ("resume_file_name" IS NULL))
);

-- CreateTable
CREATE TABLE "job_applications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "stage" VARCHAR(12) NOT NULL DEFAULT 'APPLIED',
    "stage_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rejection_reason" VARCHAR(500),
    "source" VARCHAR(12) NOT NULL DEFAULT 'DIRECT',
    "hired_employee_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "job_applications_stage_check" CHECK ("stage" IN ('APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN')),
    CONSTRAINT "job_applications_source_check" CHECK ("source" IN ('CAREERS', 'REFERRAL', 'JOB_BOARD', 'LINKEDIN', 'AGENCY', 'DIRECT', 'OTHER')),
    CONSTRAINT "job_applications_hired_check" CHECK (("stage" = 'HIRED') = ("hired_employee_id" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "application_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "from_stage" VARCHAR(12),
    "to_stage" VARCHAR(12) NOT NULL,
    "note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "application_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interviews" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "round_name" VARCHAR(120) NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_minutes" SMALLINT NOT NULL DEFAULT 60,
    "mode" VARCHAR(10) NOT NULL DEFAULT 'VIDEO',
    "location" VARCHAR(500),
    "status" VARCHAR(10) NOT NULL DEFAULT 'SCHEDULED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "interviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "interviews_mode_check" CHECK ("mode" IN ('IN_PERSON', 'VIDEO', 'PHONE')),
    CONSTRAINT "interviews_status_check" CHECK ("status" IN ('SCHEDULED', 'COMPLETED', 'CANCELLED')),
    CONSTRAINT "interviews_duration_check" CHECK ("duration_minutes" BETWEEN 10 AND 480)
);

-- CreateTable: panel members; feedback is filled in by each panelist.
CREATE TABLE "interview_panelists" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "interview_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "rating" SMALLINT,
    "recommendation" VARCHAR(16),
    "feedback" VARCHAR(4000),
    "submitted_at" TIMESTAMPTZ(3),

    CONSTRAINT "interview_panelists_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "interview_panelists_rating_check" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5),
    CONSTRAINT "interview_panelists_recommendation_check" CHECK ("recommendation" IS NULL OR "recommendation" IN ('STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE')),
    CONSTRAINT "interview_panelists_feedback_check" CHECK (("submitted_at" IS NULL) = ("recommendation" IS NULL) AND ("submitted_at" IS NULL) = ("rating" IS NULL))
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "designation_id" UUID,
    "department_id" UUID,
    "location_id" UUID,
    "annual_ctc" NUMERIC(14,2) NOT NULL,
    "joining_date" DATE NOT NULL,
    "expires_on" DATE,
    "notes" VARCHAR(2000),
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "released_at" TIMESTAMPTZ(3),
    "responded_at" TIMESTAMPTZ(3),
    "decline_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "offers_status_check" CHECK ("status" IN ('DRAFT', 'RELEASED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN')),
    CONSTRAINT "offers_ctc_check" CHECK ("annual_ctc" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "job_requisitions_id_organization_id_key" ON "job_requisitions"("id", "organization_id");
CREATE UNIQUE INDEX "job_requisitions_organization_id_code_key" ON "job_requisitions"("organization_id", "code");
CREATE INDEX "job_requisitions_organization_id_status_idx" ON "job_requisitions"("organization_id", "status");
CREATE UNIQUE INDEX "job_openings_id_organization_id_key" ON "job_openings"("id", "organization_id");
CREATE UNIQUE INDEX "job_openings_requisition_id_key" ON "job_openings"("requisition_id");
CREATE INDEX "job_openings_public_idx" ON "job_openings"("organization_id", "status") WHERE "is_public";
CREATE UNIQUE INDEX "candidates_id_organization_id_key" ON "candidates"("id", "organization_id");
CREATE UNIQUE INDEX "candidates_organization_id_email_key" ON "candidates"("organization_id", lower("email"));
CREATE INDEX "candidates_organization_id_phone_idx" ON "candidates"("organization_id", "phone") WHERE "phone" IS NOT NULL;
CREATE UNIQUE INDEX "candidates_resume_key_key" ON "candidates"("resume_key") WHERE "resume_key" IS NOT NULL;
CREATE UNIQUE INDEX "job_applications_id_organization_id_key" ON "job_applications"("id", "organization_id");
CREATE UNIQUE INDEX "job_applications_job_id_candidate_id_key" ON "job_applications"("job_id", "candidate_id");
CREATE INDEX "job_applications_job_id_stage_idx" ON "job_applications"("job_id", "stage");
CREATE INDEX "application_events_application_id_idx" ON "application_events"("application_id", "created_at");
CREATE UNIQUE INDEX "interviews_id_organization_id_key" ON "interviews"("id", "organization_id");
CREATE INDEX "interviews_application_id_idx" ON "interviews"("application_id", "scheduled_at");
CREATE UNIQUE INDEX "interview_panelists_interview_id_employee_id_key" ON "interview_panelists"("interview_id", "employee_id");
CREATE INDEX "interview_panelists_employee_id_idx" ON "interview_panelists"("employee_id");
CREATE UNIQUE INDEX "offers_one_open_per_application_key" ON "offers"("application_id") WHERE "status" IN ('DRAFT', 'RELEASED', 'ACCEPTED');

-- AddForeignKey (organization)
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interview_panelists" ADD CONSTRAINT "interview_panelists_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (tenant-safe composite references)
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_department_id_organization_id_fkey" FOREIGN KEY ("department_id", "organization_id") REFERENCES "departments"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_designation_id_organization_id_fkey" FOREIGN KEY ("designation_id", "organization_id") REFERENCES "designations"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_location_id_organization_id_fkey" FOREIGN KEY ("location_id", "organization_id") REFERENCES "locations"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_hiring_manager_id_organization_id_fkey" FOREIGN KEY ("hiring_manager_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_requisition_id_organization_id_fkey" FOREIGN KEY ("requisition_id", "organization_id") REFERENCES "job_requisitions"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_referred_by_id_organization_id_fkey" FOREIGN KEY ("referred_by_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_job_id_organization_id_fkey" FOREIGN KEY ("job_id", "organization_id") REFERENCES "job_openings"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_candidate_id_organization_id_fkey" FOREIGN KEY ("candidate_id", "organization_id") REFERENCES "candidates"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_hired_employee_id_organization_id_fkey" FOREIGN KEY ("hired_employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_organization_id_fkey" FOREIGN KEY ("application_id", "organization_id") REFERENCES "job_applications"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_organization_id_fkey" FOREIGN KEY ("application_id", "organization_id") REFERENCES "job_applications"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interview_panelists" ADD CONSTRAINT "interview_panelists_interview_id_organization_id_fkey" FOREIGN KEY ("interview_id", "organization_id") REFERENCES "interviews"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interview_panelists" ADD CONSTRAINT "interview_panelists_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_application_id_organization_id_fkey" FOREIGN KEY ("application_id", "organization_id") REFERENCES "job_applications"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_designation_id_organization_id_fkey" FOREIGN KEY ("designation_id", "organization_id") REFERENCES "designations"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_department_id_organization_id_fkey" FOREIGN KEY ("department_id", "organization_id") REFERENCES "departments"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_location_id_organization_id_fkey" FOREIGN KEY ("location_id", "organization_id") REFERENCES "locations"("id", "organization_id") ON UPDATE CASCADE;

-- AddForeignKey (actors)
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
