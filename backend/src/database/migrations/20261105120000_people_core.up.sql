-- Organization structure and employee master data.
-- Every reference between these tables is a composite (id, organization_id) foreign key, so a row can never
-- point at another organization's department, designation, location, manager or user.

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(30),
    "parent_id" UUID,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "departments_not_own_parent_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id")
);

-- CreateTable
CREATE TABLE "designations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "level" SMALLINT,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "designations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "designations_level_check" CHECK ("level" IS NULL OR ("level" BETWEEN 1 AND 50))
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(30),
    "address_line1" VARCHAR(200),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "country" CHAR(2),
    "timezone" VARCHAR(64),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID,
    "employee_code" VARCHAR(30) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "work_email" VARCHAR(254),
    "personal_email" VARCHAR(254),
    "phone" VARCHAR(30),
    "date_of_birth" DATE,
    "gender" VARCHAR(20),
    "date_of_joining" DATE NOT NULL,
    "employment_type" VARCHAR(20) NOT NULL DEFAULT 'FULL_TIME',
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "department_id" UUID,
    "designation_id" UUID,
    "location_id" UUID,
    "manager_id" UUID,
    "probation_end_date" DATE,
    "exit_date" DATE,
    "address" VARCHAR(500),
    "emergency_contact_name" VARCHAR(120),
    "emergency_contact_phone" VARCHAR(30),
    "pan_encrypted" TEXT,
    "uan_encrypted" TEXT,
    "bank_account_encrypted" TEXT,
    "bank_account_last4" VARCHAR(4),
    "bank_ifsc" VARCHAR(11),
    "bank_name" VARCHAR(100),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employees_not_own_manager_check" CHECK ("manager_id" IS NULL OR "manager_id" <> "id"),
    CONSTRAINT "employees_gender_check" CHECK ("gender" IS NULL OR "gender" IN ('MALE', 'FEMALE', 'NON_BINARY', 'UNDISCLOSED')),
    CONSTRAINT "employees_employment_type_check" CHECK ("employment_type" IN ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN')),
    CONSTRAINT "employees_status_check" CHECK ("status" IN ('ACTIVE', 'ON_NOTICE', 'EXITED')),
    CONSTRAINT "employees_exit_date_check" CHECK ("exit_date" IS NULL OR "exit_date" >= "date_of_joining")
);

-- CreateTable
CREATE TABLE "employee_lifecycle_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "effective_date" DATE NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "employee_lifecycle_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_lifecycle_events_type_check" CHECK ("type" IN ('JOINED', 'TRANSFER', 'PROMOTION', 'MANAGER_CHANGE', 'STATUS_CHANGE', 'CONFIRMATION'))
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_id_organization_id_key" ON "departments"("id", "organization_id");
CREATE UNIQUE INDEX "departments_organization_id_name_key" ON "departments"("organization_id", lower("name"));
CREATE UNIQUE INDEX "departments_organization_id_code_key" ON "departments"("organization_id", lower("code")) WHERE "code" IS NOT NULL;
CREATE UNIQUE INDEX "designations_id_organization_id_key" ON "designations"("id", "organization_id");
CREATE UNIQUE INDEX "designations_organization_id_name_key" ON "designations"("organization_id", lower("name"));
CREATE UNIQUE INDEX "locations_id_organization_id_key" ON "locations"("id", "organization_id");
CREATE UNIQUE INDEX "locations_organization_id_name_key" ON "locations"("organization_id", lower("name"));
CREATE UNIQUE INDEX "employees_id_organization_id_key" ON "employees"("id", "organization_id");
CREATE UNIQUE INDEX "employees_organization_id_employee_code_key" ON "employees"("organization_id", lower("employee_code"));
CREATE UNIQUE INDEX "employees_membership_id_key" ON "employees"("membership_id") WHERE "membership_id" IS NOT NULL;
CREATE INDEX "employees_organization_id_manager_id_idx" ON "employees"("organization_id", "manager_id");
CREATE INDEX "employees_organization_id_department_id_idx" ON "employees"("organization_id", "department_id");
CREATE INDEX "employees_organization_id_status_idx" ON "employees"("organization_id", "status");
CREATE INDEX "employee_lifecycle_events_employee_id_effective_date_idx" ON "employee_lifecycle_events"("employee_id", "effective_date");

-- AddForeignKey (organization)
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "designations" ADD CONSTRAINT "designations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_lifecycle_events" ADD CONSTRAINT "employee_lifecycle_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (tenant-safe composite references; NO ACTION so organization deletes can cascade through)
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_organization_id_fkey" FOREIGN KEY ("parent_id", "organization_id") REFERENCES "departments"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_membership_id_organization_id_fkey" FOREIGN KEY ("membership_id", "organization_id") REFERENCES "organization_memberships"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_organization_id_fkey" FOREIGN KEY ("department_id", "organization_id") REFERENCES "departments"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_designation_id_organization_id_fkey" FOREIGN KEY ("designation_id", "organization_id") REFERENCES "designations"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_location_id_organization_id_fkey" FOREIGN KEY ("location_id", "organization_id") REFERENCES "locations"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_organization_id_fkey" FOREIGN KEY ("manager_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "employee_lifecycle_events" ADD CONSTRAINT "employee_lifecycle_events_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (audit columns)
ALTER TABLE "departments" ADD CONSTRAINT "departments_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "designations" ADD CONSTRAINT "designations_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "locations" ADD CONSTRAINT "locations_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_lifecycle_events" ADD CONSTRAINT "employee_lifecycle_events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
