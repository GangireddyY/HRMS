-- Assets (register, assignment history, requests), HR helpdesk (tickets and conversation) and travel requests.

CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "tag" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "serial_number" VARCHAR(100),
    "model" VARCHAR(150),
    "purchase_date" DATE,
    "purchase_cost" NUMERIC(12,2),
    "warranty_until" DATE,
    "status" VARCHAR(12) NOT NULL DEFAULT 'IN_STOCK',
    "condition" VARCHAR(10) NOT NULL DEFAULT 'GOOD',
    "location_id" UUID,
    "notes" VARCHAR(1000),
    "assigned_employee_id" UUID,
    "assigned_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assets_category_check" CHECK ("category" IN ('LAPTOP', 'DESKTOP', 'MONITOR', 'PHONE', 'TABLET', 'ACCESSORY', 'ID_CARD', 'FURNITURE', 'VEHICLE', 'OTHER')),
    CONSTRAINT "assets_status_check" CHECK ("status" IN ('IN_STOCK', 'ASSIGNED', 'IN_REPAIR', 'RETIRED', 'LOST')),
    CONSTRAINT "assets_condition_check" CHECK ("condition" IN ('NEW', 'GOOD', 'FAIR', 'DAMAGED')),
    CONSTRAINT "assets_assigned_check" CHECK (("status" = 'ASSIGNED') = ("assigned_employee_id" IS NOT NULL)),
    CONSTRAINT "assets_cost_check" CHECK ("purchase_cost" IS NULL OR "purchase_cost" >= 0)
);
CREATE UNIQUE INDEX "assets_id_organization_id_key" ON "assets"("id", "organization_id");
CREATE UNIQUE INDEX "assets_organization_id_tag_key" ON "assets"("organization_id", "tag");
CREATE UNIQUE INDEX "assets_organization_id_serial_key" ON "assets"("organization_id", lower("serial_number")) WHERE "serial_number" IS NOT NULL;
CREATE INDEX "assets_assigned_employee_idx" ON "assets"("assigned_employee_id") WHERE "assigned_employee_id" IS NOT NULL;
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_employee_fkey" FOREIGN KEY ("assigned_employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_location_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "asset_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL,
    "assigned_by_id" UUID,
    "condition_out" VARCHAR(10) NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(3),
    "returned_at" TIMESTAMPTZ(3),
    "returned_by_id" UUID,
    "condition_in" VARCHAR(10),
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_assignments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "asset_assignments_asset_idx" ON "asset_assignments"("asset_id", "assigned_at");
CREATE INDEX "asset_assignments_employee_idx" ON "asset_assignments"("employee_id");
CREATE UNIQUE INDEX "asset_assignments_open_key" ON "asset_assignments"("asset_id") WHERE "returned_at" IS NULL;
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_asset_fkey" FOREIGN KEY ("asset_id", "organization_id") REFERENCES "assets"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_employee_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;

CREATE TABLE "asset_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "asset_id" UUID,
    "review_note" VARCHAR(500),
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "requested_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "asset_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "asset_requests_status_check" CHECK ("status" IN ('PENDING', 'FULFILLED', 'REJECTED', 'CANCELLED'))
);
CREATE INDEX "asset_requests_org_status_idx" ON "asset_requests"("organization_id", "status");
ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_employee_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "asset_requests" ADD CONSTRAINT "asset_requests_asset_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "helpdesk_tickets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "reference" VARCHAR(20) NOT NULL,
    "employee_id" UUID NOT NULL,
    "requested_by_id" UUID,
    "category" VARCHAR(20) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "priority" VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
    "status" VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    "assignee_id" UUID,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "first_response_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "rating" SMALLINT,
    "rating_comment" VARCHAR(500),
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "helpdesk_tickets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "helpdesk_tickets_category_check" CHECK ("category" IN ('PAYROLL', 'LEAVE_ATTENDANCE', 'BENEFITS', 'DOCUMENTS', 'POLICIES', 'IT', 'FACILITIES', 'OTHER')),
    CONSTRAINT "helpdesk_tickets_priority_check" CHECK ("priority" IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
    CONSTRAINT "helpdesk_tickets_status_check" CHECK ("status" IN ('OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED')),
    CONSTRAINT "helpdesk_tickets_rating_check" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5)
);
CREATE UNIQUE INDEX "helpdesk_tickets_id_organization_id_key" ON "helpdesk_tickets"("id", "organization_id");
CREATE UNIQUE INDEX "helpdesk_tickets_organization_id_reference_key" ON "helpdesk_tickets"("organization_id", "reference");
CREATE INDEX "helpdesk_tickets_org_status_idx" ON "helpdesk_tickets"("organization_id", "status", "due_at");
CREATE INDEX "helpdesk_tickets_employee_idx" ON "helpdesk_tickets"("employee_id");
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_employee_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "helpdesk_tickets" ADD CONSTRAINT "helpdesk_tickets_assignee_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "helpdesk_messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_id" UUID,
    "from_agent" BOOLEAN NOT NULL,
    -- Internal notes are seen by agents only.
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "body" VARCHAR(5000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "helpdesk_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "helpdesk_messages_internal_check" CHECK (NOT "internal" OR "from_agent")
);
CREATE INDEX "helpdesk_messages_ticket_idx" ON "helpdesk_messages"("ticket_id", "created_at");
ALTER TABLE "helpdesk_messages" ADD CONSTRAINT "helpdesk_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "helpdesk_messages" ADD CONSTRAINT "helpdesk_messages_ticket_fkey" FOREIGN KEY ("ticket_id", "organization_id") REFERENCES "helpdesk_tickets"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "helpdesk_messages" ADD CONSTRAINT "helpdesk_messages_author_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "travel_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "reference" VARCHAR(20) NOT NULL,
    "employee_id" UUID NOT NULL,
    "requested_by_id" UUID,
    "purpose" VARCHAR(500) NOT NULL,
    "from_city" VARCHAR(100) NOT NULL,
    "to_city" VARCHAR(100) NOT NULL,
    "departure_date" DATE NOT NULL,
    "return_date" DATE NOT NULL,
    "mode" VARCHAR(10) NOT NULL,
    "needs_accommodation" BOOLEAN NOT NULL DEFAULT false,
    "estimated_cost" NUMERIC(12,2) NOT NULL,
    "advance_amount" NUMERIC(12,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" VARCHAR(500),
    "booking_notes" VARCHAR(2000),
    "advance_paid_at" TIMESTAMPTZ(3),
    "advance_reference" VARCHAR(100),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "travel_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "travel_requests_dates_check" CHECK ("return_date" >= "departure_date"),
    CONSTRAINT "travel_requests_mode_check" CHECK ("mode" IN ('FLIGHT', 'TRAIN', 'BUS', 'CAR', 'OTHER')),
    CONSTRAINT "travel_requests_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED')),
    CONSTRAINT "travel_requests_amount_check" CHECK ("estimated_cost" >= 0 AND "advance_amount" >= 0 AND "advance_amount" <= "estimated_cost")
);
CREATE UNIQUE INDEX "travel_requests_organization_id_reference_key" ON "travel_requests"("organization_id", "reference");
CREATE INDEX "travel_requests_org_status_idx" ON "travel_requests"("organization_id", "status", "departure_date");
CREATE INDEX "travel_requests_employee_idx" ON "travel_requests"("employee_id");
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_employee_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
