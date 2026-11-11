-- Custom fields: the organization defines extra employee fields (typed, optionally required, sensitive or editable by
-- the employee); values live on the employee record.

CREATE TABLE "custom_field_definitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity" VARCHAR(20) NOT NULL DEFAULT 'EMPLOYEE',
    "key" VARCHAR(40) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "type" VARCHAR(12) NOT NULL,
    "options" VARCHAR(80)[] NOT NULL DEFAULT '{}',
    "required" BOOLEAN NOT NULL DEFAULT false,
    -- Only people who see bank and statutory identifiers (and the employee) see the value.
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "employee_editable" BOOLEAN NOT NULL DEFAULT false,
    "section" VARCHAR(60),
    "help_text" VARCHAR(200),
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "custom_field_definitions_entity_check" CHECK ("entity" IN ('EMPLOYEE')),
    CONSTRAINT "custom_field_definitions_type_check" CHECK ("type" IN ('TEXT', 'LONG_TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'MULTI_SELECT', 'EMAIL', 'URL')),
    CONSTRAINT "custom_field_definitions_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,39}$')
);
CREATE UNIQUE INDEX "custom_field_definitions_org_entity_key_key" ON "custom_field_definitions"("organization_id", "entity", "key");
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employees" ADD COLUMN "custom_fields" JSONB NOT NULL DEFAULT '{}';
