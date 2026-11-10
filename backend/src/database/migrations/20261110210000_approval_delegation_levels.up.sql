-- Approval delegation: while it runs, the delegate approves what the delegator could (manager-level approvals only).
CREATE TABLE "approval_delegations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "delegator_membership_id" UUID NOT NULL,
    "delegate_membership_id" UUID NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "reason" VARCHAR(300),
    "created_by_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "approval_delegations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "approval_delegations_dates_check" CHECK ("ends_on" >= "starts_on"),
    CONSTRAINT "approval_delegations_people_check" CHECK ("delegator_membership_id" <> "delegate_membership_id")
);
CREATE INDEX "approval_delegations_delegate_idx" ON "approval_delegations"("delegate_membership_id", "starts_on", "ends_on") WHERE "revoked_at" IS NULL;
CREATE INDEX "approval_delegations_delegator_idx" ON "approval_delegations"("delegator_membership_id", "ends_on");
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegator_fkey" FOREIGN KEY ("delegator_membership_id") REFERENCES "organization_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegate_fkey" FOREIGN KEY ("delegate_membership_id") REFERENCES "organization_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Two-level leave approval: the manager, then someone with department- or organization-wide reach (HR); optionally only
-- for requests longer than a number of days.
ALTER TABLE "leave_types" ADD COLUMN "approval_levels" SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN "second_approval_min_days" NUMERIC(5,1),
    ADD CONSTRAINT "leave_types_approval_levels_check" CHECK ("approval_levels" BETWEEN 1 AND 2),
    ADD CONSTRAINT "leave_types_second_approval_check" CHECK ("second_approval_min_days" IS NULL OR ("second_approval_min_days" > 0 AND "approval_levels" = 2));

ALTER TABLE "leave_requests" ADD COLUMN "approval_level" SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN "approval_levels" SMALLINT NOT NULL DEFAULT 1,
    -- [{ level, userId, name, at, note }] for each approval given so far.
    ADD COLUMN "approval_trail" JSONB NOT NULL DEFAULT '[]',
    ADD CONSTRAINT "leave_requests_approval_level_check" CHECK ("approval_levels" BETWEEN 1 AND 2 AND "approval_level" BETWEEN 1 AND "approval_levels");
