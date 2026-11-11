-- Configurable approval chains: per kind of request, ordered steps (manager, skip-level, permission holders, a named
-- person) with optional deadlines, chosen by conditions (days, amount, department, leave type, category).
CREATE TABLE "approval_chains" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subject" VARCHAR(12) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    -- Lower first; the first active chain whose conditions match applies.
    "priority" SMALLINT NOT NULL DEFAULT 100,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "steps" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "approval_chains_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "approval_chains_subject_check" CHECK ("subject" IN ('LEAVE', 'EXPENSE', 'TRAVEL', 'EXIT', 'OFFER'))
);
CREATE INDEX "approval_chains_lookup_idx" ON "approval_chains"("organization_id", "subject", "priority");
ALTER TABLE "approval_chains" ADD CONSTRAINT "approval_chains_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One per request that a chain applies to: the approvers resolved when it was made, where it stands, the decisions.
CREATE TABLE "approval_instances" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subject" VARCHAR(12) NOT NULL,
    "subject_id" UUID NOT NULL,
    "chain_id" UUID,
    "chain_name" VARCHAR(120) NOT NULL,
    "requester_membership_id" UUID,
    -- [{ label, approverMembershipIds, escalatedMembershipIds, slaHours }]
    "steps" JSONB NOT NULL,
    "current_step" SMALLINT NOT NULL DEFAULT 0,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "step_started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMPTZ(3),
    "escalated_at" TIMESTAMPTZ(3),
    -- [{ step, membershipId, name, decision, note, at, onBehalfOf }]
    "decisions" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "approval_instances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "approval_instances_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'))
);
CREATE UNIQUE INDEX "approval_instances_subject_uq" ON "approval_instances"("organization_id", "subject", "subject_id");
CREATE INDEX "approval_instances_due_idx" ON "approval_instances"("status", "due_at") WHERE "status" = 'PENDING';
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "approval_chains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_chains" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "approval_chains" USING ("hrms_tenant_visible"("organization_id")) WITH CHECK ("hrms_tenant_visible"("organization_id"));
ALTER TABLE "approval_instances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_instances" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "approval_instances" USING ("hrms_tenant_visible"("organization_id")) WITH CHECK ("hrms_tenant_visible"("organization_id"));
