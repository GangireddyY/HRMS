-- Compensation budgets: an increase pool per department for a review cycle's salary hikes.
CREATE TABLE "compensation_budgets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    -- Null = people without a department.
    "department_id" UUID,
    -- Total annual CTC increase the department may give in the cycle.
    "amount" DECIMAL(14, 2) NOT NULL,
    "note" VARCHAR(500),
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "compensation_budgets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "compensation_budgets_amount_check" CHECK ("amount" >= 0)
);
CREATE UNIQUE INDEX "compensation_budgets_pool_uq" ON "compensation_budgets"("cycle_id", COALESCE("department_id", '00000000-0000-0000-0000-000000000000'::uuid));
ALTER TABLE "compensation_budgets" ADD CONSTRAINT "compensation_budgets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compensation_budgets" ADD CONSTRAINT "compensation_budgets_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "performance_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compensation_budgets" ADD CONSTRAINT "compensation_budgets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Succession planning: critical roles (with their current holder, or vacant) and the people who could step in.
CREATE TABLE "succession_plans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "incumbent_employee_id" UUID,
    "department_id" UUID,
    "criticality" VARCHAR(6) NOT NULL DEFAULT 'HIGH',
    "risk_of_loss" VARCHAR(6) NOT NULL DEFAULT 'MEDIUM',
    "notes" VARCHAR(2000),
    "review_by" DATE,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "succession_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "succession_plans_criticality_check" CHECK ("criticality" IN ('LOW', 'MEDIUM', 'HIGH')),
    CONSTRAINT "succession_plans_risk_check" CHECK ("risk_of_loss" IN ('LOW', 'MEDIUM', 'HIGH'))
);
CREATE UNIQUE INDEX "succession_plans_incumbent_uq" ON "succession_plans"("incumbent_employee_id") WHERE "incumbent_employee_id" IS NOT NULL;
CREATE INDEX "succession_plans_organization_idx" ON "succession_plans"("organization_id", "department_id");
ALTER TABLE "succession_plans" ADD CONSTRAINT "succession_plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "succession_plans" ADD CONSTRAINT "succession_plans_incumbent_fkey" FOREIGN KEY ("incumbent_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "succession_plans" ADD CONSTRAINT "succession_plans_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "succession_candidates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "readiness" VARCHAR(16) NOT NULL,
    "rank" SMALLINT NOT NULL DEFAULT 1,
    "development_notes" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "succession_candidates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "succession_candidates_readiness_check" CHECK ("readiness" IN ('READY_NOW', 'ONE_TO_TWO_YEARS', 'THREE_PLUS_YEARS'))
);
CREATE UNIQUE INDEX "succession_candidates_uq" ON "succession_candidates"("plan_id", "employee_id");
ALTER TABLE "succession_candidates" ADD CONSTRAINT "succession_candidates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "succession_candidates" ADD CONSTRAINT "succession_candidates_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "succession_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "succession_candidates" ADD CONSTRAINT "succession_candidates_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "compensation_budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compensation_budgets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "compensation_budgets" USING ("hrms_tenant_visible"("organization_id")) WITH CHECK ("hrms_tenant_visible"("organization_id"));
ALTER TABLE "succession_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "succession_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "succession_plans" USING ("hrms_tenant_visible"("organization_id")) WITH CHECK ("hrms_tenant_visible"("organization_id"));
ALTER TABLE "succession_candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "succession_candidates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "succession_candidates" USING ("hrms_tenant_visible"("organization_id")) WITH CHECK ("hrms_tenant_visible"("organization_id"));
