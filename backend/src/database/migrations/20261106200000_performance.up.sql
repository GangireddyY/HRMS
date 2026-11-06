-- Performance: review cycles, reviews with goals, self / manager assessments, 360 feedback, calibration, and
-- performance improvement plans with check-ins.

-- CreateTable
CREATE TABLE "performance_cycles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "goals_due" DATE,
    "self_review_due" DATE,
    "manager_review_due" DATE,
    -- Share of the overall score from goals; the rest comes from competencies.
    "goals_weight" SMALLINT NOT NULL DEFAULT 70,
    "competencies" JSONB NOT NULL DEFAULT '[]',
    "rating_labels" JSONB NOT NULL,
    -- Only employees who joined on or before this date take part (null = everyone active at launch).
    "eligibility_cutoff" DATE,
    "department_ids" JSONB,
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "launched_at" TIMESTAMPTZ(3),
    "results_released_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "performance_cycles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "performance_cycles_status_check" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'CLOSED')),
    CONSTRAINT "performance_cycles_period_check" CHECK ("period_end" > "period_start"),
    CONSTRAINT "performance_cycles_weight_check" CHECK ("goals_weight" BETWEEN 0 AND 100)
);

-- CreateTable
CREATE TABLE "performance_reviews" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    -- The employee's manager at launch (HR can reassign); null until someone is assigned.
    "reviewer_id" UUID,
    "stage" VARCHAR(16) NOT NULL DEFAULT 'GOAL_SETTING',
    "goals_submitted_at" TIMESTAMPTZ(3),
    "goals_approved_at" TIMESTAMPTZ(3),
    "goals_return_note" VARCHAR(1000),
    "self_competencies" JSONB NOT NULL DEFAULT '[]',
    "self_comment" TEXT,
    "self_submitted_at" TIMESTAMPTZ(3),
    "manager_competencies" JSONB NOT NULL DEFAULT '[]',
    "manager_comment" TEXT,
    "strengths" TEXT,
    "improvements" TEXT,
    "goal_score" NUMERIC(3,2),
    "competency_score" NUMERIC(3,2),
    "overall_score" NUMERIC(3,2),
    "final_rating" SMALLINT,
    "manager_submitted_at" TIMESTAMPTZ(3),
    "calibrated_rating" SMALLINT,
    "calibration_note" VARCHAR(1000),
    "calibrated_by_id" UUID,
    "calibrated_at" TIMESTAMPTZ(3),
    "acknowledged_at" TIMESTAMPTZ(3),
    "employee_response" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "performance_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "performance_reviews_stage_check" CHECK ("stage" IN ('GOAL_SETTING', 'GOAL_APPROVAL', 'SELF_REVIEW', 'MANAGER_REVIEW', 'COMPLETED', 'ACKNOWLEDGED')),
    CONSTRAINT "performance_reviews_ratings_check" CHECK (
        ("final_rating" IS NULL OR "final_rating" BETWEEN 1 AND 5) AND ("calibrated_rating" IS NULL OR "calibrated_rating" BETWEEN 1 AND 5)
        AND ("overall_score" IS NULL OR "overall_score" BETWEEN 1 AND 5)
    ),
    CONSTRAINT "performance_reviews_not_self_check" CHECK ("reviewer_id" IS NULL OR "reviewer_id" <> "employee_id")
);

-- CreateTable
CREATE TABLE "performance_goals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    -- How success is measured, e.g. "Release v2 by June with < 1% error rate".
    "measure" VARCHAR(500),
    "weight" SMALLINT NOT NULL,
    "due_date" DATE,
    "progress" SMALLINT NOT NULL DEFAULT 0,
    "progress_note" VARCHAR(1000),
    "self_rating" SMALLINT,
    "self_comment" VARCHAR(2000),
    "manager_rating" SMALLINT,
    "manager_comment" VARCHAR(2000),
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "performance_goals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "performance_goals_numbers_check" CHECK (
        "weight" BETWEEN 1 AND 100 AND "progress" BETWEEN 0 AND 100
        AND ("self_rating" IS NULL OR "self_rating" BETWEEN 1 AND 5) AND ("manager_rating" IS NULL OR "manager_rating" BETWEEN 1 AND 5)
    )
);

-- CreateTable
CREATE TABLE "performance_feedback" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "giver_id" UUID NOT NULL,
    "requested_by_id" UUID,
    "status" VARCHAR(10) NOT NULL DEFAULT 'REQUESTED',
    "rating" SMALLINT,
    "strengths" VARCHAR(2000),
    "improvements" VARCHAR(2000),
    "submitted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "performance_feedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "performance_feedback_status_check" CHECK ("status" IN ('REQUESTED', 'SUBMITTED', 'DECLINED')),
    CONSTRAINT "performance_feedback_rating_check" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5)
);

-- CreateTable
CREATE TABLE "performance_pips" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "owner_id" UUID,
    "review_id" UUID,
    "reason" VARCHAR(2000) NOT NULL,
    -- [{ title, measure, met: boolean | null }]
    "objectives" JSONB NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
    "outcome_note" VARCHAR(2000),
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_id" UUID,
    "acknowledged_at" TIMESTAMPTZ(3),
    "employee_comment" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "performance_pips_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "performance_pips_status_check" CHECK ("status" IN ('ACTIVE', 'SUCCESSFUL', 'UNSUCCESSFUL', 'CANCELLED')),
    CONSTRAINT "performance_pips_dates_check" CHECK ("end_date" > "start_date"),
    CONSTRAINT "performance_pips_not_self_check" CHECK ("owner_id" IS NULL OR "owner_id" <> "employee_id")
);

-- CreateTable
CREATE TABLE "pip_check_ins" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "pip_id" UUID NOT NULL,
    "check_in_date" DATE NOT NULL,
    "progress" VARCHAR(12) NOT NULL,
    "note" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "pip_check_ins_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pip_check_ins_progress_check" CHECK ("progress" IN ('ON_TRACK', 'SOME_PROGRESS', 'OFF_TRACK'))
);

-- CreateIndex
CREATE UNIQUE INDEX "performance_cycles_id_organization_id_key" ON "performance_cycles"("id", "organization_id");
CREATE INDEX "performance_cycles_organization_id_status_idx" ON "performance_cycles"("organization_id", "status");
CREATE UNIQUE INDEX "performance_reviews_id_organization_id_key" ON "performance_reviews"("id", "organization_id");
CREATE UNIQUE INDEX "performance_reviews_cycle_id_employee_id_key" ON "performance_reviews"("cycle_id", "employee_id");
CREATE INDEX "performance_reviews_reviewer_id_idx" ON "performance_reviews"("reviewer_id");
CREATE INDEX "performance_reviews_employee_id_idx" ON "performance_reviews"("employee_id");
CREATE INDEX "performance_goals_review_id_idx" ON "performance_goals"("review_id", "sort_order");
CREATE UNIQUE INDEX "performance_feedback_review_id_giver_id_key" ON "performance_feedback"("review_id", "giver_id");
CREATE INDEX "performance_feedback_giver_id_idx" ON "performance_feedback"("giver_id", "status");
CREATE UNIQUE INDEX "performance_pips_id_organization_id_key" ON "performance_pips"("id", "organization_id");
CREATE UNIQUE INDEX "performance_pips_one_active_key" ON "performance_pips"("employee_id") WHERE "status" = 'ACTIVE';
CREATE INDEX "pip_check_ins_pip_id_idx" ON "pip_check_ins"("pip_id", "check_in_date");

-- AddForeignKey (organization)
ALTER TABLE "performance_cycles" ADD CONSTRAINT "performance_cycles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_goals" ADD CONSTRAINT "performance_goals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_feedback" ADD CONSTRAINT "performance_feedback_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_pips" ADD CONSTRAINT "performance_pips_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pip_check_ins" ADD CONSTRAINT "pip_check_ins_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (tenant-safe composite references)
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_cycle_id_organization_id_fkey" FOREIGN KEY ("cycle_id", "organization_id") REFERENCES "performance_cycles"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Reviews and PIPs keep the employee from being deleted (performance records).
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_reviewer_id_organization_id_fkey" FOREIGN KEY ("reviewer_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "performance_goals" ADD CONSTRAINT "performance_goals_review_id_organization_id_fkey" FOREIGN KEY ("review_id", "organization_id") REFERENCES "performance_reviews"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_feedback" ADD CONSTRAINT "performance_feedback_review_id_organization_id_fkey" FOREIGN KEY ("review_id", "organization_id") REFERENCES "performance_reviews"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_feedback" ADD CONSTRAINT "performance_feedback_giver_id_organization_id_fkey" FOREIGN KEY ("giver_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_pips" ADD CONSTRAINT "performance_pips_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "performance_pips" ADD CONSTRAINT "performance_pips_owner_id_organization_id_fkey" FOREIGN KEY ("owner_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "performance_pips" ADD CONSTRAINT "performance_pips_review_id_organization_id_fkey" FOREIGN KEY ("review_id", "organization_id") REFERENCES "performance_reviews"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "pip_check_ins" ADD CONSTRAINT "pip_check_ins_pip_id_organization_id_fkey" FOREIGN KEY ("pip_id", "organization_id") REFERENCES "performance_pips"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (actors)
ALTER TABLE "performance_cycles" ADD CONSTRAINT "performance_cycles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_calibrated_by_id_fkey" FOREIGN KEY ("calibrated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "performance_feedback" ADD CONSTRAINT "performance_feedback_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "performance_pips" ADD CONSTRAINT "performance_pips_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "performance_pips" ADD CONSTRAINT "performance_pips_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pip_check_ins" ADD CONSTRAINT "pip_check_ins_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
