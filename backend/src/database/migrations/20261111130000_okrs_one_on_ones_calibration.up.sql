-- OKRs (objectives, key results, check-ins), 1:1 meetings between managers and their people, and calibration aids
-- (a target rating distribution per cycle and a potential rating per review for the 9-box).

CREATE TABLE "okr_objectives" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "level" VARCHAR(12) NOT NULL,
    "owner_employee_id" UUID,
    "department_id" UUID,
    "parent_id" UUID,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" VARCHAR(8) NOT NULL DEFAULT 'ACTIVE',
    -- Weighted progress of the key results (0–100) and the latest check-in health, kept current on every change.
    "progress" SMALLINT NOT NULL DEFAULT 0,
    "health" VARCHAR(10),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "okr_objectives_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "okr_objectives_level_check" CHECK ("level" IN ('COMPANY', 'DEPARTMENT', 'INDIVIDUAL')),
    CONSTRAINT "okr_objectives_department_check" CHECK (("level" = 'DEPARTMENT') = ("department_id" IS NOT NULL)),
    CONSTRAINT "okr_objectives_owner_check" CHECK ("level" <> 'INDIVIDUAL' OR "owner_employee_id" IS NOT NULL),
    CONSTRAINT "okr_objectives_period_check" CHECK ("period_end" >= "period_start"),
    CONSTRAINT "okr_objectives_status_check" CHECK ("status" IN ('ACTIVE', 'CLOSED', 'DROPPED')),
    CONSTRAINT "okr_objectives_progress_check" CHECK ("progress" BETWEEN 0 AND 100),
    CONSTRAINT "okr_objectives_health_check" CHECK ("health" IS NULL OR "health" IN ('ON_TRACK', 'AT_RISK', 'OFF_TRACK'))
);
CREATE UNIQUE INDEX "okr_objectives_id_organization_id_key" ON "okr_objectives"("id", "organization_id");
CREATE INDEX "okr_objectives_org_period_idx" ON "okr_objectives"("organization_id", "period_start", "period_end");
CREATE INDEX "okr_objectives_owner_idx" ON "okr_objectives"("owner_employee_id") WHERE "owner_employee_id" IS NOT NULL;
CREATE INDEX "okr_objectives_parent_idx" ON "okr_objectives"("parent_id") WHERE "parent_id" IS NOT NULL;
ALTER TABLE "okr_objectives" ADD CONSTRAINT "okr_objectives_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "okr_objectives" ADD CONSTRAINT "okr_objectives_owner_fkey" FOREIGN KEY ("owner_employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "okr_objectives" ADD CONSTRAINT "okr_objectives_department_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "okr_objectives" ADD CONSTRAINT "okr_objectives_parent_fkey" FOREIGN KEY ("parent_id", "organization_id") REFERENCES "okr_objectives"("id", "organization_id") ON UPDATE CASCADE;

CREATE TABLE "okr_key_results" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "objective_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "metric" VARCHAR(10) NOT NULL,
    "start_value" NUMERIC(14,2) NOT NULL DEFAULT 0,
    "target_value" NUMERIC(14,2) NOT NULL,
    "current_value" NUMERIC(14,2) NOT NULL DEFAULT 0,
    "unit" VARCHAR(20),
    "weight" SMALLINT NOT NULL DEFAULT 1,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "last_check_in_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "okr_key_results_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "okr_key_results_metric_check" CHECK ("metric" IN ('NUMBER', 'PERCENT', 'CURRENCY', 'MILESTONE')),
    CONSTRAINT "okr_key_results_target_check" CHECK ("target_value" <> "start_value"),
    CONSTRAINT "okr_key_results_weight_check" CHECK ("weight" BETWEEN 1 AND 10)
);
CREATE UNIQUE INDEX "okr_key_results_id_organization_id_key" ON "okr_key_results"("id", "organization_id");
CREATE INDEX "okr_key_results_objective_idx" ON "okr_key_results"("objective_id", "sort_order");
ALTER TABLE "okr_key_results" ADD CONSTRAINT "okr_key_results_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "okr_key_results" ADD CONSTRAINT "okr_key_results_objective_fkey" FOREIGN KEY ("objective_id", "organization_id") REFERENCES "okr_objectives"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "okr_check_ins" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key_result_id" UUID NOT NULL,
    "value" NUMERIC(14,2) NOT NULL,
    "health" VARCHAR(10) NOT NULL,
    "note" VARCHAR(1000),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "okr_check_ins_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "okr_check_ins_health_check" CHECK ("health" IN ('ON_TRACK', 'AT_RISK', 'OFF_TRACK'))
);
CREATE INDEX "okr_check_ins_key_result_idx" ON "okr_check_ins"("key_result_id", "created_at");
ALTER TABLE "okr_check_ins" ADD CONSTRAINT "okr_check_ins_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "okr_check_ins" ADD CONSTRAINT "okr_check_ins_key_result_fkey" FOREIGN KEY ("key_result_id", "organization_id") REFERENCES "okr_key_results"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "one_on_ones" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "manager_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_minutes" SMALLINT NOT NULL DEFAULT 30,
    "status" VARCHAR(10) NOT NULL DEFAULT 'SCHEDULED',
    -- Seen by both; private notes are the manager's only.
    "shared_notes" TEXT,
    "manager_notes" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "one_on_ones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "one_on_ones_people_check" CHECK ("manager_id" <> "employee_id"),
    CONSTRAINT "one_on_ones_status_check" CHECK ("status" IN ('SCHEDULED', 'DONE', 'CANCELLED')),
    CONSTRAINT "one_on_ones_duration_check" CHECK ("duration_minutes" BETWEEN 5 AND 480)
);
CREATE UNIQUE INDEX "one_on_ones_id_organization_id_key" ON "one_on_ones"("id", "organization_id");
CREATE INDEX "one_on_ones_pair_idx" ON "one_on_ones"("manager_id", "employee_id", "scheduled_at");
CREATE INDEX "one_on_ones_employee_idx" ON "one_on_ones"("employee_id", "scheduled_at");
ALTER TABLE "one_on_ones" ADD CONSTRAINT "one_on_ones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "one_on_ones" ADD CONSTRAINT "one_on_ones_manager_fkey" FOREIGN KEY ("manager_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "one_on_ones" ADD CONSTRAINT "one_on_ones_employee_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;

CREATE TABLE "one_on_one_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "added_by_id" UUID,
    "owner_employee_id" UUID,
    "due_date" DATE,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "done_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_on_one_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "one_on_one_items_kind_check" CHECK ("kind" IN ('TOPIC', 'ACTION'))
);
CREATE INDEX "one_on_one_items_meeting_idx" ON "one_on_one_items"("meeting_id", "created_at");
ALTER TABLE "one_on_one_items" ADD CONSTRAINT "one_on_one_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "one_on_one_items" ADD CONSTRAINT "one_on_one_items_meeting_fkey" FOREIGN KEY ("meeting_id", "organization_id") REFERENCES "one_on_ones"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Calibration: the share of people expected at each rating (1 → 5, summing to 100), and potential (1–3) for the 9-box.
ALTER TABLE "performance_cycles" ADD COLUMN "target_distribution" JSONB;
ALTER TABLE "performance_reviews"
    ADD COLUMN "potential" SMALLINT,
    ADD COLUMN "potential_set_by_id" UUID,
    ADD COLUMN "potential_set_at" TIMESTAMPTZ(3),
    ADD CONSTRAINT "performance_reviews_potential_check" CHECK ("potential" IS NULL OR "potential" BETWEEN 1 AND 3);
