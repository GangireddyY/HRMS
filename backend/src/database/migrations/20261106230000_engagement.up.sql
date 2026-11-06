-- Engagement: announcements and events (acknowledgements, RSVPs), surveys (anonymous answers kept apart from who took
-- part), recognition, and a suggestions box.

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "category" VARCHAR(12) NOT NULL DEFAULT 'GENERAL',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "requires_ack" BOOLEAN NOT NULL DEFAULT false,
    -- Audience: null / empty = everyone; otherwise employees in these departments / locations.
    "department_ids" JSONB,
    "location_ids" JSONB,
    "event_starts_at" TIMESTAMPTZ(3),
    "event_ends_at" TIMESTAMPTZ(3),
    "event_location" VARCHAR(300),
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "announcements_category_check" CHECK ("category" IN ('GENERAL', 'POLICY', 'EVENT', 'CELEBRATION', 'ALERT')),
    CONSTRAINT "announcements_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    CONSTRAINT "announcements_event_check" CHECK (
        ("category" = 'EVENT') = ("event_starts_at" IS NOT NULL)
        AND ("event_ends_at" IS NULL OR ("event_starts_at" IS NOT NULL AND "event_ends_at" > "event_starts_at"))
    )
);

-- CreateTable
CREATE TABLE "announcement_responses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "announcement_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(3),
    "rsvp" VARCHAR(10),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "announcement_responses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "announcement_responses_rsvp_check" CHECK ("rsvp" IS NULL OR "rsvp" IN ('GOING', 'MAYBE', 'NOT_GOING'))
);

-- CreateTable
CREATE TABLE "surveys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "anonymous" BOOLEAN NOT NULL DEFAULT true,
    "department_ids" JSONB,
    "status" VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    "opened_at" TIMESTAMPTZ(3),
    "closes_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "surveys_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "surveys_status_check" CHECK ("status" IN ('DRAFT', 'OPEN', 'CLOSED'))
);

-- CreateTable
CREATE TABLE "survey_questions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "survey_id" UUID NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "prompt" VARCHAR(500) NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "survey_questions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "survey_questions_type_check" CHECK ("type" IN ('RATING', 'NPS', 'CHOICE', 'TEXT')),
    CONSTRAINT "survey_questions_options_check" CHECK (("type" = 'CHOICE') = (jsonb_array_length("options") >= 2))
);

-- CreateTable: who responded (no link to the answers).
CREATE TABLE "survey_participants" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "survey_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    -- Day only, so participation can't be matched to an anonymous response by time.
    "responded_on" DATE NOT NULL,

    CONSTRAINT "survey_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable: answers (employee_id only for non-anonymous surveys).
CREATE TABLE "survey_responses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "survey_id" UUID NOT NULL,
    "employee_id" UUID,
    "answers" JSONB NOT NULL,
    "submitted_on" DATE NOT NULL,

    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recognitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "giver_id" UUID NOT NULL,
    "badge" VARCHAR(20) NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recognitions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recognitions_badge_check" CHECK ("badge" IN ('TEAMWORK', 'INNOVATION', 'CUSTOMER_FIRST', 'OWNERSHIP', 'EXCELLENCE', 'HELPING_HAND'))
);

-- CreateTable
CREATE TABLE "recognition_recipients" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "recognition_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,

    CONSTRAINT "recognition_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suggestions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    -- Null when submitted anonymously.
    "employee_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "category" VARCHAR(12) NOT NULL,
    "status" VARCHAR(14) NOT NULL DEFAULT 'NEW',
    "response" VARCHAR(2000),
    "responded_by_id" UUID,
    "responded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suggestions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "suggestions_category_check" CHECK ("category" IN ('WORKPLACE', 'PROCESS', 'PRODUCT', 'CULTURE', 'BENEFITS', 'OTHER')),
    CONSTRAINT "suggestions_status_check" CHECK ("status" IN ('NEW', 'UNDER_REVIEW', 'ACCEPTED', 'IMPLEMENTED', 'DECLINED'))
);

-- CreateIndex
CREATE UNIQUE INDEX "announcements_id_organization_id_key" ON "announcements"("id", "organization_id");
CREATE INDEX "announcements_organization_id_status_idx" ON "announcements"("organization_id", "status", "published_at");
CREATE UNIQUE INDEX "announcement_responses_announcement_id_employee_id_key" ON "announcement_responses"("announcement_id", "employee_id");
CREATE UNIQUE INDEX "surveys_id_organization_id_key" ON "surveys"("id", "organization_id");
CREATE INDEX "survey_questions_survey_id_idx" ON "survey_questions"("survey_id", "sort_order");
CREATE UNIQUE INDEX "survey_participants_survey_id_employee_id_key" ON "survey_participants"("survey_id", "employee_id");
CREATE INDEX "survey_responses_survey_id_idx" ON "survey_responses"("survey_id");
CREATE UNIQUE INDEX "survey_responses_survey_id_employee_id_key" ON "survey_responses"("survey_id", "employee_id") WHERE "employee_id" IS NOT NULL;
CREATE UNIQUE INDEX "recognitions_id_organization_id_key" ON "recognitions"("id", "organization_id");
CREATE INDEX "recognitions_organization_id_created_at_idx" ON "recognitions"("organization_id", "created_at");
CREATE UNIQUE INDEX "recognition_recipients_recognition_id_employee_id_key" ON "recognition_recipients"("recognition_id", "employee_id");
CREATE INDEX "recognition_recipients_employee_id_idx" ON "recognition_recipients"("employee_id");
CREATE INDEX "suggestions_organization_id_status_idx" ON "suggestions"("organization_id", "status");

-- AddForeignKey (organization)
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "announcement_responses" ADD CONSTRAINT "announcement_responses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "survey_questions" ADD CONSTRAINT "survey_questions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "survey_participants" ADD CONSTRAINT "survey_participants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recognitions" ADD CONSTRAINT "recognitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recognition_recipients" ADD CONSTRAINT "recognition_recipients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (tenant-safe composite references). Engagement data goes with the employee when they are deleted.
ALTER TABLE "announcement_responses" ADD CONSTRAINT "announcement_responses_announcement_id_organization_id_fkey" FOREIGN KEY ("announcement_id", "organization_id") REFERENCES "announcements"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "announcement_responses" ADD CONSTRAINT "announcement_responses_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "survey_questions" ADD CONSTRAINT "survey_questions_survey_id_organization_id_fkey" FOREIGN KEY ("survey_id", "organization_id") REFERENCES "surveys"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "survey_participants" ADD CONSTRAINT "survey_participants_survey_id_organization_id_fkey" FOREIGN KEY ("survey_id", "organization_id") REFERENCES "surveys"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "survey_participants" ADD CONSTRAINT "survey_participants_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_survey_id_organization_id_fkey" FOREIGN KEY ("survey_id", "organization_id") REFERENCES "surveys"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recognitions" ADD CONSTRAINT "recognitions_giver_id_organization_id_fkey" FOREIGN KEY ("giver_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recognition_recipients" ADD CONSTRAINT "recognition_recipients_recognition_id_organization_id_fkey" FOREIGN KEY ("recognition_id", "organization_id") REFERENCES "recognitions"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recognition_recipients" ADD CONSTRAINT "recognition_recipients_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (actors)
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_responded_by_id_fkey" FOREIGN KEY ("responded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
