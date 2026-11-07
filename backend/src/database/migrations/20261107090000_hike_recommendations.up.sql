-- Salary-hike recommendations after a review cycle: the cycle's merit guidelines and budget, and one recommendation
-- per reviewed employee taken through approval to a salary revision.

ALTER TABLE "performance_cycles"
    -- [{ rating, min, target, max }] in % of the annual CTC.
    ADD COLUMN "merit_matrix" JSONB,
    ADD COLUMN "hike_budget_percent" DECIMAL(5,2),
    ADD COLUMN "hike_effective_from" DATE;
ALTER TABLE "performance_cycles" ADD CONSTRAINT "performance_cycles_hike_check" CHECK (
    ("merit_matrix" IS NULL OR jsonb_typeof("merit_matrix") = 'array')
    AND ("hike_budget_percent" IS NULL OR "hike_budget_percent" BETWEEN 0 AND 100)
);

CREATE TABLE "hike_recommendations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    -- The final (calibrated) rating when the recommendation was made.
    "rating" SMALLINT NOT NULL,
    "current_ctc" DECIMAL(14,2),
    "percent" DECIMAL(5,2) NOT NULL,
    "new_ctc" DECIMAL(14,2),
    "promotion" BOOLEAN NOT NULL DEFAULT false,
    "justification" VARCHAR(1000),
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "recommended_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" VARCHAR(1000),
    "salary_id" UUID,
    "applied_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hike_recommendations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hike_recommendations_status_check" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'APPLIED')),
    CONSTRAINT "hike_recommendations_values_check" CHECK ("rating" BETWEEN 1 AND 5 AND "percent" BETWEEN 0 AND 100),
    CONSTRAINT "hike_recommendations_applied_check" CHECK (("status" = 'APPLIED') = ("salary_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "hike_recommendations_cycle_id_employee_id_key" ON "hike_recommendations"("cycle_id", "employee_id");
CREATE UNIQUE INDEX "hike_recommendations_review_id_key" ON "hike_recommendations"("review_id");
CREATE INDEX "hike_recommendations_organization_id_status_idx" ON "hike_recommendations"("organization_id", "status");

ALTER TABLE "hike_recommendations" ADD CONSTRAINT "hike_recommendations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hike_recommendations" ADD CONSTRAINT "hike_recommendations_cycle_id_organization_id_fkey" FOREIGN KEY ("cycle_id", "organization_id") REFERENCES "performance_cycles"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hike_recommendations" ADD CONSTRAINT "hike_recommendations_review_id_organization_id_fkey" FOREIGN KEY ("review_id", "organization_id") REFERENCES "performance_reviews"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hike_recommendations" ADD CONSTRAINT "hike_recommendations_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "hike_recommendations" ADD CONSTRAINT "hike_recommendations_salary_id_fkey" FOREIGN KEY ("salary_id") REFERENCES "employee_salaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hike_recommendations" ADD CONSTRAINT "hike_recommendations_recommended_by_id_fkey" FOREIGN KEY ("recommended_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hike_recommendations" ADD CONSTRAINT "hike_recommendations_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
