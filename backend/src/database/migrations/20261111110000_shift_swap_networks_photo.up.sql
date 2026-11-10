-- Office networks and punch photos per location, and shift swaps between colleagues.

ALTER TABLE "locations"
    -- IP addresses or CIDR ranges web punch-ins must come from (empty = anywhere); work-from-home days are exempt.
    ADD COLUMN "allowed_networks" VARCHAR(50)[],
    ADD COLUMN "punch_photo_required" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "attendance_records" ADD COLUMN "check_in_photo_key" VARCHAR(300);

CREATE TABLE "shift_swaps" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "colleague_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    -- What each was due to work that day when asked (null = day off), so a roster change since is caught.
    "requester_shift_id" UUID,
    "colleague_shift_id" UUID,
    "reason" VARCHAR(500) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'ASKED',
    "colleague_responded_at" TIMESTAMPTZ(3),
    "colleague_note" VARCHAR(500),
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" VARCHAR(500),
    "requested_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shift_swaps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shift_swaps_people_check" CHECK ("requester_id" <> "colleague_id"),
    CONSTRAINT "shift_swaps_status_check" CHECK ("status" IN ('ASKED', 'PENDING', 'APPROVED', 'DECLINED', 'REJECTED', 'CANCELLED'))
);
CREATE INDEX "shift_swaps_requester_idx" ON "shift_swaps"("requester_id", "work_date");
CREATE INDEX "shift_swaps_colleague_idx" ON "shift_swaps"("colleague_id", "work_date");
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_requester_fkey" FOREIGN KEY ("requester_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_colleague_fkey" FOREIGN KEY ("colleague_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_requester_shift_fkey" FOREIGN KEY ("requester_shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_colleague_shift_fkey" FOREIGN KEY ("colleague_shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
