-- Benefits: plans with coverage options and eligibility, employee enrolments (with a snapshot of the option's cost and
-- cover) and the dependants each enrolment covers.

-- CreateTable
CREATE TABLE "benefit_plans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "type" VARCHAR(12) NOT NULL,
    "provider" VARCHAR(150),
    "policy_number" VARCHAR(80),
    "description" VARCHAR(4000),
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    -- Policy period.
    "coverage_starts_on" DATE NOT NULL,
    "coverage_ends_on" DATE NOT NULL,
    -- Open enrolment window (optional).
    "enrollment_opens_on" DATE,
    "enrollment_closes_on" DATE,
    -- Everyone eligible is covered (enrolled by HR in the default option); can't be waived.
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    -- Eligibility: null / empty = everyone.
    "employment_types" JSONB,
    "department_ids" JSONB,
    "location_ids" JSONB,
    "grade_ids" JSONB,
    "waiting_days" INTEGER NOT NULL DEFAULT 0,
    "max_child_age" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "benefit_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "benefit_plans_type_check" CHECK ("type" IN ('HEALTH', 'LIFE', 'ACCIDENT', 'WELLNESS', 'MEAL', 'TRANSPORT', 'OTHER')),
    CONSTRAINT "benefit_plans_status_check" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
    CONSTRAINT "benefit_plans_coverage_check" CHECK ("coverage_ends_on" > "coverage_starts_on"),
    CONSTRAINT "benefit_plans_enrollment_check" CHECK (("enrollment_opens_on" IS NULL) = ("enrollment_closes_on" IS NULL) AND ("enrollment_closes_on" IS NULL OR "enrollment_closes_on" >= "enrollment_opens_on")),
    CONSTRAINT "benefit_plans_waiting_check" CHECK ("waiting_days" BETWEEN 0 AND 365),
    CONSTRAINT "benefit_plans_child_age_check" CHECK ("max_child_age" IS NULL OR "max_child_age" BETWEEN 1 AND 30)
);

-- CreateTable
CREATE TABLE "benefit_plan_options" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    -- Sum insured / benefit amount (null when not applicable).
    "coverage_amount" DECIMAL(14,2),
    "employee_monthly" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "employer_monthly" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "allowed_relations" JSONB NOT NULL DEFAULT '[]',
    "max_dependents" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "benefit_plan_options_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "benefit_plan_options_amounts_check" CHECK ("employee_monthly" >= 0 AND "employer_monthly" >= 0 AND ("coverage_amount" IS NULL OR "coverage_amount" > 0)),
    CONSTRAINT "benefit_plan_options_dependents_check" CHECK ("max_dependents" BETWEEN 0 AND 10)
);

-- CreateTable
CREATE TABLE "benefit_enrollments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "option_id" UUID,
    "employee_id" UUID NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "reason" VARCHAR(16) NOT NULL,
    "life_event" VARCHAR(20),
    "life_event_date" DATE,
    "note" VARCHAR(1000),
    "effective_from" DATE,
    "effective_to" DATE,
    -- Snapshot of the option when enrolled (later price changes apply to new enrolments only).
    "option_name" VARCHAR(120),
    "coverage_amount" DECIMAL(14,2),
    "employee_monthly" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "employer_monthly" DECIMAL(12,2) NOT NULL DEFAULT 0,
    -- The enrolment this one replaces when it becomes active.
    "replaces_id" UUID,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "benefit_enrollments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "benefit_enrollments_status_check" CHECK ("status" IN ('PENDING', 'ACTIVE', 'WAIVED', 'REJECTED', 'CANCELLED', 'ENDED')),
    CONSTRAINT "benefit_enrollments_reason_check" CHECK ("reason" IN ('OPEN_ENROLLMENT', 'NEW_JOINER', 'LIFE_EVENT', 'HR')),
    CONSTRAINT "benefit_enrollments_life_event_check" CHECK (
        ("reason" = 'LIFE_EVENT') = ("life_event" IS NOT NULL AND "life_event_date" IS NOT NULL)
        AND ("life_event" IS NULL OR "life_event" IN ('MARRIAGE', 'CHILDBIRTH', 'ADOPTION', 'DIVORCE', 'DEATH_OF_DEPENDENT', 'LOSS_OF_OTHER_COVER'))
    ),
    CONSTRAINT "benefit_enrollments_option_check" CHECK (("status" = 'WAIVED') = ("option_id" IS NULL AND "option_name" IS NULL)),
    CONSTRAINT "benefit_enrollments_dates_check" CHECK (("status" IN ('ACTIVE', 'ENDED')) <= ("effective_from" IS NOT NULL) AND ("effective_to" IS NULL OR "effective_to" >= "effective_from")),
    CONSTRAINT "benefit_enrollments_amounts_check" CHECK ("employee_monthly" >= 0 AND "employer_monthly" >= 0)
);

-- CreateTable
CREATE TABLE "benefit_enrollment_dependents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "family_member_id" UUID,
    -- Snapshot for the insurer's census.
    "name" VARCHAR(120) NOT NULL,
    "relationship" VARCHAR(20) NOT NULL,
    "date_of_birth" DATE,
    "gender" VARCHAR(20),

    CONSTRAINT "benefit_enrollment_dependents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "benefit_enrollment_dependents_relationship_check" CHECK ("relationship" IN ('SPOUSE', 'CHILD', 'FATHER', 'MOTHER'))
);

-- CreateIndex
CREATE UNIQUE INDEX "benefit_plans_id_organization_id_key" ON "benefit_plans"("id", "organization_id");
CREATE INDEX "benefit_plans_organization_id_status_idx" ON "benefit_plans"("organization_id", "status");
CREATE UNIQUE INDEX "benefit_plan_options_id_organization_id_key" ON "benefit_plan_options"("id", "organization_id");
CREATE INDEX "benefit_plan_options_plan_id_idx" ON "benefit_plan_options"("plan_id", "sort_order");
CREATE UNIQUE INDEX "benefit_plan_options_default_key" ON "benefit_plan_options"("plan_id") WHERE "is_default";
CREATE UNIQUE INDEX "benefit_enrollments_id_organization_id_key" ON "benefit_enrollments"("id", "organization_id");
CREATE INDEX "benefit_enrollments_plan_id_status_idx" ON "benefit_enrollments"("plan_id", "status");
CREATE INDEX "benefit_enrollments_employee_id_idx" ON "benefit_enrollments"("employee_id", "status");
-- One current choice per employee and plan; a pending change may sit next to the active enrolment it replaces.
CREATE UNIQUE INDEX "benefit_enrollments_live_key" ON "benefit_enrollments"("plan_id", "employee_id") WHERE "status" IN ('ACTIVE', 'WAIVED');
CREATE UNIQUE INDEX "benefit_enrollments_pending_key" ON "benefit_enrollments"("plan_id", "employee_id") WHERE "status" = 'PENDING';
CREATE INDEX "benefit_enrollment_dependents_enrollment_id_idx" ON "benefit_enrollment_dependents"("enrollment_id");
CREATE UNIQUE INDEX "employee_family_members_id_organization_id_key" ON "employee_family_members"("id", "organization_id");

-- AddForeignKey (organization)
ALTER TABLE "benefit_plans" ADD CONSTRAINT "benefit_plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "benefit_plan_options" ADD CONSTRAINT "benefit_plan_options_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "benefit_enrollments" ADD CONSTRAINT "benefit_enrollments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "benefit_enrollment_dependents" ADD CONSTRAINT "benefit_enrollment_dependents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (tenant-safe composite references). Enrolments keep an employee and the option they chose from being
-- deleted; removing a family member keeps the coverage record (snapshot) and clears only family_member_id.
ALTER TABLE "benefit_plan_options" ADD CONSTRAINT "benefit_plan_options_plan_id_organization_id_fkey" FOREIGN KEY ("plan_id", "organization_id") REFERENCES "benefit_plans"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "benefit_enrollments" ADD CONSTRAINT "benefit_enrollments_plan_id_organization_id_fkey" FOREIGN KEY ("plan_id", "organization_id") REFERENCES "benefit_plans"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "benefit_enrollments" ADD CONSTRAINT "benefit_enrollments_option_id_organization_id_fkey" FOREIGN KEY ("option_id", "organization_id") REFERENCES "benefit_plan_options"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "benefit_enrollments" ADD CONSTRAINT "benefit_enrollments_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "benefit_enrollments" ADD CONSTRAINT "benefit_enrollments_replaces_id_organization_id_fkey" FOREIGN KEY ("replaces_id", "organization_id") REFERENCES "benefit_enrollments"("id", "organization_id") ON DELETE SET NULL ("replaces_id") ON UPDATE CASCADE;
ALTER TABLE "benefit_enrollment_dependents" ADD CONSTRAINT "benefit_enrollment_dependents_enrollment_id_organization_id_fkey" FOREIGN KEY ("enrollment_id", "organization_id") REFERENCES "benefit_enrollments"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "benefit_enrollment_dependents" ADD CONSTRAINT "benefit_enrollment_dependents_family_member_id_organization_id_fkey" FOREIGN KEY ("family_member_id", "organization_id") REFERENCES "employee_family_members"("id", "organization_id") ON DELETE SET NULL ("family_member_id") ON UPDATE CASCADE;

-- AddForeignKey (actors)
ALTER TABLE "benefit_plans" ADD CONSTRAINT "benefit_plans_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "benefit_plans" ADD CONSTRAINT "benefit_plans_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "benefit_enrollments" ADD CONSTRAINT "benefit_enrollments_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "benefit_enrollments" ADD CONSTRAINT "benefit_enrollments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
