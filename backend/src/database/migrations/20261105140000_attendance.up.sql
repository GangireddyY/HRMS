-- Attendance: shifts, holidays, daily records, regularization requests and monthly closing.

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "break_minutes" SMALLINT NOT NULL DEFAULT 60,
    "grace_minutes" SMALLINT NOT NULL DEFAULT 15,
    "half_day_minutes" SMALLINT NOT NULL DEFAULT 240,
    "full_day_minutes" SMALLINT NOT NULL DEFAULT 480,
    "weekly_offs" SMALLINT[] NOT NULL DEFAULT '{0,6}',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shifts_times_check" CHECK ("start_time" <> "end_time"),
    CONSTRAINT "shifts_minutes_check" CHECK (
        "break_minutes" BETWEEN 0 AND 240 AND "grace_minutes" BETWEEN 0 AND 240
        AND "half_day_minutes" BETWEEN 0 AND 1440 AND "full_day_minutes" BETWEEN 1 AND 1440
        AND "half_day_minutes" <= "full_day_minutes"
    ),
    CONSTRAINT "shifts_weekly_offs_check" CHECK ("weekly_offs" <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[])
);

-- AlterTable: assigned shift (NULL = the organization's default shift)
ALTER TABLE "employees" ADD COLUMN "shift_id" UUID;

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "shift_id" UUID,
    "check_in_at" TIMESTAMPTZ(3),
    "check_out_at" TIMESTAMPTZ(3),
    "worked_minutes" INTEGER,
    "late_minutes" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20),
    "source" VARCHAR(20) NOT NULL DEFAULT 'WEB',
    "check_in_ip" VARCHAR(45),
    "check_out_ip" VARCHAR(45),
    "check_in_latitude" NUMERIC(9,6),
    "check_in_longitude" NUMERIC(9,6),
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_records_times_check" CHECK ("check_out_at" IS NULL OR ("check_in_at" IS NOT NULL AND "check_out_at" > "check_in_at")),
    CONSTRAINT "attendance_records_status_check" CHECK ("status" IS NULL OR "status" IN ('PRESENT', 'HALF_DAY', 'ABSENT')),
    CONSTRAINT "attendance_records_source_check" CHECK ("source" IN ('WEB', 'REGULARIZED', 'MANUAL')),
    CONSTRAINT "attendance_records_minutes_check" CHECK ("late_minutes" >= 0 AND ("worked_minutes" IS NULL OR "worked_minutes" >= 0)),
    CONSTRAINT "attendance_records_location_check" CHECK (
        ("check_in_latitude" IS NULL OR "check_in_latitude" BETWEEN -90 AND 90)
        AND ("check_in_longitude" IS NULL OR "check_in_longitude" BETWEEN -180 AND 180)
    )
);

-- CreateTable
CREATE TABLE "attendance_regularizations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "check_in_at" TIMESTAMPTZ(3) NOT NULL,
    "check_out_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendance_regularizations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_regularizations_times_check" CHECK ("check_out_at" > "check_in_at"),
    CONSTRAINT "attendance_regularizations_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'))
);

-- CreateTable: a row means the month is closed (no further changes to its attendance).
CREATE TABLE "attendance_periods" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "year" SMALLINT NOT NULL,
    "month" SMALLINT NOT NULL,
    "closed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by_id" UUID,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendance_periods_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_periods_month_check" CHECK ("month" BETWEEN 1 AND 12 AND "year" BETWEEN 2000 AND 2100)
);

-- CreateIndex
CREATE UNIQUE INDEX "shifts_id_organization_id_key" ON "shifts"("id", "organization_id");
CREATE UNIQUE INDEX "shifts_organization_id_name_key" ON "shifts"("organization_id", lower("name"));
CREATE UNIQUE INDEX "shifts_one_default_per_organization_key" ON "shifts"("organization_id") WHERE "is_default";
CREATE UNIQUE INDEX "holidays_organization_id_date_key" ON "holidays"("organization_id", "date");
CREATE UNIQUE INDEX "attendance_records_employee_id_work_date_key" ON "attendance_records"("employee_id", "work_date");
CREATE INDEX "attendance_records_organization_id_work_date_idx" ON "attendance_records"("organization_id", "work_date");
CREATE INDEX "attendance_regularizations_organization_id_status_idx" ON "attendance_regularizations"("organization_id", "status");
CREATE UNIQUE INDEX "attendance_regularizations_one_pending_key" ON "attendance_regularizations"("employee_id", "work_date") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "attendance_periods_organization_id_year_month_key" ON "attendance_periods"("organization_id", "year", "month");

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_regularizations" ADD CONSTRAINT "attendance_regularizations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_periods" ADD CONSTRAINT "attendance_periods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant-safe composite references (NO ACTION so organization deletes can cascade through).
ALTER TABLE "employees" ADD CONSTRAINT "employees_shift_id_organization_id_fkey" FOREIGN KEY ("shift_id", "organization_id") REFERENCES "shifts"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_shift_id_organization_id_fkey" FOREIGN KEY ("shift_id", "organization_id") REFERENCES "shifts"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "attendance_regularizations" ADD CONSTRAINT "attendance_regularizations_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;

-- Audit columns
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_regularizations" ADD CONSTRAINT "attendance_regularizations_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_regularizations" ADD CONSTRAINT "attendance_regularizations_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_periods" ADD CONSTRAINT "attendance_periods_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
