-- Training: courses with optional assessments, dated sessions, enrolments (self or assigned), assessment attempts
-- and certificates with expiry.

-- CreateTable
CREATE TABLE "training_courses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(20) NOT NULL,
    "delivery" VARCHAR(12) NOT NULL,
    "duration_hours" NUMERIC(5,1),
    "provider" VARCHAR(120),
    -- Learning material for self-paced courses (or pre-reading).
    "content_url" VARCHAR(500),
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    -- Anyone with training.enroll can join from the catalog (otherwise assignment only).
    "self_enrollment" BOOLEAN NOT NULL DEFAULT true,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "has_assessment" BOOLEAN NOT NULL DEFAULT false,
    "pass_mark" SMALLINT NOT NULL DEFAULT 70,
    "max_attempts" SMALLINT NOT NULL DEFAULT 3,
    -- Certificates expire this many months after completion (null = never).
    "validity_months" SMALLINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "training_courses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "training_courses_category_check" CHECK ("category" IN ('TECHNICAL', 'SOFT_SKILLS', 'LEADERSHIP', 'COMPLIANCE', 'ONBOARDING', 'SAFETY', 'OTHER')),
    CONSTRAINT "training_courses_delivery_check" CHECK ("delivery" IN ('CLASSROOM', 'VIRTUAL', 'SELF_PACED')),
    CONSTRAINT "training_courses_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    CONSTRAINT "training_courses_numbers_check" CHECK (
        ("duration_hours" IS NULL OR "duration_hours" > 0) AND "pass_mark" BETWEEN 1 AND 100
        AND "max_attempts" BETWEEN 1 AND 20 AND ("validity_months" IS NULL OR "validity_months" BETWEEN 1 AND 120)
    )
);

-- CreateTable
CREATE TABLE "training_questions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "prompt" VARCHAR(1000) NOT NULL,
    "options" JSONB NOT NULL,
    "correct_index" SMALLINT NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "training_questions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "training_questions_options_check" CHECK (jsonb_typeof("options") = 'array' AND jsonb_array_length("options") BETWEEN 2 AND 6),
    CONSTRAINT "training_questions_correct_check" CHECK ("correct_index" >= 0 AND "correct_index" < jsonb_array_length("options"))
);

-- CreateTable
CREATE TABLE "training_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    -- Room or meeting link.
    "location" VARCHAR(300),
    "trainer" VARCHAR(120),
    "capacity" SMALLINT,
    "status" VARCHAR(10) NOT NULL DEFAULT 'SCHEDULED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "training_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "training_sessions_status_check" CHECK ("status" IN ('SCHEDULED', 'COMPLETED', 'CANCELLED')),
    CONSTRAINT "training_sessions_times_check" CHECK ("ends_at" > "starts_at"),
    CONSTRAINT "training_sessions_capacity_check" CHECK ("capacity" IS NULL OR "capacity" BETWEEN 1 AND 10000)
);

-- CreateTable
CREATE TABLE "training_enrollments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "session_id" UUID,
    "source" VARCHAR(10) NOT NULL,
    "assigned_by_id" UUID,
    "due_date" DATE,
    "status" VARCHAR(12) NOT NULL DEFAULT 'ENROLLED',
    "started_at" TIMESTAMPTZ(3),
    "attended" BOOLEAN NOT NULL DEFAULT false,
    "marked_done" BOOLEAN NOT NULL DEFAULT false,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "best_score" SMALLINT,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(3),
    "completed_on" DATE,
    "certificate_number" VARCHAR(20),
    "expires_on" DATE,
    "feedback_rating" SMALLINT,
    "feedback_comment" VARCHAR(2000),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "training_enrollments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "training_enrollments_status_check" CHECK ("status" IN ('ENROLLED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'NO_SHOW', 'CANCELLED')),
    CONSTRAINT "training_enrollments_source_check" CHECK ("source" IN ('SELF', 'ASSIGNED')),
    CONSTRAINT "training_enrollments_numbers_check" CHECK (
        "attempts" >= 0 AND ("best_score" IS NULL OR "best_score" BETWEEN 0 AND 100)
        AND ("feedback_rating" IS NULL OR "feedback_rating" BETWEEN 1 AND 5)
    ),
    CONSTRAINT "training_enrollments_completed_check" CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "training_attempts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "answers" JSONB NOT NULL,
    "correct" SMALLINT NOT NULL,
    "total" SMALLINT NOT NULL,
    "score" SMALLINT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "training_attempts_score_check" CHECK ("score" BETWEEN 0 AND 100 AND "correct" BETWEEN 0 AND "total")
);

-- CreateIndex
CREATE UNIQUE INDEX "training_courses_id_organization_id_key" ON "training_courses"("id", "organization_id");
CREATE UNIQUE INDEX "training_courses_organization_id_code_key" ON "training_courses"("organization_id", "code");
CREATE INDEX "training_courses_organization_id_status_idx" ON "training_courses"("organization_id", "status");
CREATE INDEX "training_questions_course_id_idx" ON "training_questions"("course_id", "sort_order");
CREATE UNIQUE INDEX "training_sessions_id_organization_id_key" ON "training_sessions"("id", "organization_id");
CREATE INDEX "training_sessions_course_id_idx" ON "training_sessions"("course_id", "starts_at");
CREATE UNIQUE INDEX "training_enrollments_id_organization_id_key" ON "training_enrollments"("id", "organization_id");
CREATE UNIQUE INDEX "training_enrollments_one_open_key" ON "training_enrollments"("course_id", "employee_id") WHERE "status" IN ('ENROLLED', 'IN_PROGRESS');
CREATE INDEX "training_enrollments_employee_id_idx" ON "training_enrollments"("employee_id", "status");
CREATE INDEX "training_enrollments_session_id_idx" ON "training_enrollments"("session_id");
CREATE INDEX "training_enrollments_expires_on_idx" ON "training_enrollments"("organization_id", "expires_on") WHERE "expires_on" IS NOT NULL;
CREATE UNIQUE INDEX "training_enrollments_certificate_number_key" ON "training_enrollments"("certificate_number") WHERE "certificate_number" IS NOT NULL;
CREATE INDEX "training_attempts_enrollment_id_idx" ON "training_attempts"("enrollment_id", "created_at");

-- AddForeignKey (organization)
ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_questions" ADD CONSTRAINT "training_questions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_attempts" ADD CONSTRAINT "training_attempts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (tenant-safe composite references)
ALTER TABLE "training_questions" ADD CONSTRAINT "training_questions_course_id_organization_id_fkey" FOREIGN KEY ("course_id", "organization_id") REFERENCES "training_courses"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_course_id_organization_id_fkey" FOREIGN KEY ("course_id", "organization_id") REFERENCES "training_courses"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_course_id_organization_id_fkey" FOREIGN KEY ("course_id", "organization_id") REFERENCES "training_courses"("id", "organization_id") ON UPDATE CASCADE;
-- Training records keep the employee from being deleted.
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_session_id_organization_id_fkey" FOREIGN KEY ("session_id", "organization_id") REFERENCES "training_sessions"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "training_attempts" ADD CONSTRAINT "training_attempts_enrollment_id_organization_id_fkey" FOREIGN KEY ("enrollment_id", "organization_id") REFERENCES "training_enrollments"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (actors)
ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "training_enrollments" ADD CONSTRAINT "training_enrollments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
