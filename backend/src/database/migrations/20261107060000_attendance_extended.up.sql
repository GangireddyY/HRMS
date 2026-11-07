-- Attendance: overtime (rules, approvals, payroll pay), work from home with office geofences, shift rosters and
-- rotations, and biometric devices pushing punches.

-- Overtime rules on shifts: worked minutes beyond the threshold (all minutes on a day off) count as overtime.
ALTER TABLE "shifts"
    ADD COLUMN "overtime_enabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "overtime_after_minutes" SMALLINT NOT NULL DEFAULT 540,
    ADD COLUMN "overtime_min_minutes" SMALLINT NOT NULL DEFAULT 30;
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_overtime_check" CHECK ("overtime_after_minutes" BETWEEN 1 AND 1440 AND "overtime_min_minutes" BETWEEN 0 AND 480);

-- Records: overtime worked, where the day was worked from, and the device that captured it.
ALTER TABLE "attendance_records"
    ADD COLUMN "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "work_mode" VARCHAR(6) NOT NULL DEFAULT 'OFFICE',
    ADD COLUMN "device_id" UUID;
ALTER TABLE "attendance_records" DROP CONSTRAINT "attendance_records_source_check";
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_source_check" CHECK ("source" IN ('WEB', 'REGULARIZED', 'MANUAL', 'DEVICE'));
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_overtime_check" CHECK ("overtime_minutes" >= 0);
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_work_mode_check" CHECK ("work_mode" IN ('OFFICE', 'REMOTE'));

-- Office geofence: web punches from further away than the radius are refused (unless working from home that day).
ALTER TABLE "locations"
    ADD COLUMN "latitude" NUMERIC(9,6),
    ADD COLUMN "longitude" NUMERIC(9,6),
    ADD COLUMN "geofence_radius_m" INTEGER;
ALTER TABLE "locations" ADD CONSTRAINT "locations_geofence_check" CHECK (
    ("latitude" IS NULL) = ("longitude" IS NULL)
    AND ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180))
    AND ("geofence_radius_m" IS NULL OR ("latitude" IS NOT NULL AND "geofence_radius_m" BETWEEN 25 AND 50000))
);

-- The employee's user number on biometric devices (falls back to the employee code).
ALTER TABLE "employees" ADD COLUMN "biometric_code" VARCHAR(30);
CREATE UNIQUE INDEX "employees_biometric_code_key" ON "employees"("organization_id", lower("biometric_code")) WHERE "biometric_code" IS NOT NULL;

-- Overtime to approve (one per employee and day), paid by the first payroll run after approval.
CREATE TABLE "attendance_overtime" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "approved_minutes" INTEGER,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" VARCHAR(500),
    "payroll_run_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attendance_overtime_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_overtime_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED')),
    CONSTRAINT "attendance_overtime_minutes_check" CHECK ("minutes" > 0 AND ("approved_minutes" IS NULL OR "approved_minutes" BETWEEN 1 AND "minutes")),
    CONSTRAINT "attendance_overtime_approved_check" CHECK (("status" = 'APPROVED') = ("approved_minutes" IS NOT NULL)),
    CONSTRAINT "attendance_overtime_paid_check" CHECK ("payroll_run_id" IS NULL OR "status" = 'APPROVED')
);

-- Work-from-home requests (a range of days), approved like regularizations.
CREATE TABLE "work_from_home_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "work_from_home_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "work_from_home_requests_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    CONSTRAINT "work_from_home_requests_dates_check" CHECK ("end_date" >= "start_date" AND "end_date" - "start_date" < 31)
);

-- Rotation patterns: a repeating cycle of shifts and days off, e.g. 5 days morning, 2 off, 5 days night, 2 off.
CREATE TABLE "shift_rotations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    -- [{ "shiftId": uuid | null (day off), "days": n }]
    "pattern" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "shift_rotations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shift_rotations_pattern_check" CHECK (jsonb_typeof("pattern") = 'array' AND jsonb_array_length("pattern") BETWEEN 1 AND 20)
);

-- Roster: the shift (or a day off) an employee works on each day of a range, overriding their usual shift.
CREATE TABLE "shift_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    -- NULL = day off.
    "shift_id" UUID,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "rotation_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "shift_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shift_assignments_dates_check" CHECK ("end_date" >= "start_date")
);

-- Biometric / RFID devices: each pushes punches with its own API key (only a hash is stored).
CREATE TABLE "attendance_devices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "location_id" UUID,
    "serial_number" VARCHAR(60),
    "key_prefix" VARCHAR(16) NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "attendance_devices_pkey" PRIMARY KEY ("id")
);

-- Every punch received from a device (duplicates are ignored).
CREATE TABLE "attendance_punches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "punched_at" TIMESTAMPTZ(3) NOT NULL,
    "direction" VARCHAR(4) NOT NULL DEFAULT 'AUTO',
    "work_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_punches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_punches_direction_check" CHECK ("direction" IN ('IN', 'OUT', 'AUTO'))
);

-- Payroll: overtime pay = approved hours × hourly rate (monthly basis ÷ 26 days ÷ 8 hours) × multiplier.
ALTER TABLE "payroll_settings"
    ADD COLUMN "overtime_multiplier" NUMERIC(3,1) NOT NULL DEFAULT 2.0,
    ADD COLUMN "overtime_basis" VARCHAR(5) NOT NULL DEFAULT 'GROSS';
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_overtime_check" CHECK ("overtime_multiplier" BETWEEN 1 AND 5 AND "overtime_basis" IN ('BASIC', 'GROSS'));

-- CreateIndex
CREATE UNIQUE INDEX "attendance_overtime_employee_id_work_date_key" ON "attendance_overtime"("employee_id", "work_date");
CREATE INDEX "attendance_overtime_organization_id_status_idx" ON "attendance_overtime"("organization_id", "status", "work_date");
CREATE INDEX "work_from_home_requests_employee_id_idx" ON "work_from_home_requests"("employee_id", "start_date");
CREATE INDEX "work_from_home_requests_organization_id_status_idx" ON "work_from_home_requests"("organization_id", "status");
CREATE UNIQUE INDEX "shift_rotations_id_organization_id_key" ON "shift_rotations"("id", "organization_id");
CREATE UNIQUE INDEX "shift_rotations_organization_id_name_key" ON "shift_rotations"("organization_id", lower("name"));
CREATE INDEX "shift_assignments_employee_id_idx" ON "shift_assignments"("employee_id", "start_date", "end_date");
CREATE UNIQUE INDEX "attendance_devices_id_organization_id_key" ON "attendance_devices"("id", "organization_id");
CREATE UNIQUE INDEX "attendance_devices_key_prefix_key" ON "attendance_devices"("key_prefix");
CREATE UNIQUE INDEX "attendance_devices_organization_id_name_key" ON "attendance_devices"("organization_id", lower("name"));
CREATE UNIQUE INDEX "attendance_punches_employee_id_punched_at_key" ON "attendance_punches"("employee_id", "punched_at");
CREATE INDEX "attendance_punches_device_id_idx" ON "attendance_punches"("device_id", "created_at");
CREATE UNIQUE INDEX "attendance_records_id_organization_id_key" ON "attendance_records"("id", "organization_id");

-- AddForeignKey (organization)
ALTER TABLE "attendance_overtime" ADD CONSTRAINT "attendance_overtime_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_from_home_requests" ADD CONSTRAINT "work_from_home_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shift_rotations" ADD CONSTRAINT "shift_rotations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (tenant-safe composite references; NO ACTION so organization deletes cascade through)
ALTER TABLE "attendance_overtime" ADD CONSTRAINT "attendance_overtime_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "attendance_overtime" ADD CONSTRAINT "attendance_overtime_record_id_organization_id_fkey" FOREIGN KEY ("record_id", "organization_id") REFERENCES "attendance_records"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_overtime" ADD CONSTRAINT "attendance_overtime_payroll_run_id_organization_id_fkey" FOREIGN KEY ("payroll_run_id", "organization_id") REFERENCES "payroll_runs"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "work_from_home_requests" ADD CONSTRAINT "work_from_home_requests_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shift_id_organization_id_fkey" FOREIGN KEY ("shift_id", "organization_id") REFERENCES "shifts"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_rotation_id_organization_id_fkey" FOREIGN KEY ("rotation_id", "organization_id") REFERENCES "shift_rotations"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_location_id_organization_id_fkey" FOREIGN KEY ("location_id", "organization_id") REFERENCES "locations"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_device_id_organization_id_fkey" FOREIGN KEY ("device_id", "organization_id") REFERENCES "attendance_devices"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_device_id_organization_id_fkey" FOREIGN KEY ("device_id", "organization_id") REFERENCES "attendance_devices"("id", "organization_id") ON UPDATE CASCADE;

-- AddForeignKey (actors)
ALTER TABLE "attendance_overtime" ADD CONSTRAINT "attendance_overtime_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_from_home_requests" ADD CONSTRAINT "work_from_home_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_from_home_requests" ADD CONSTRAINT "work_from_home_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shift_rotations" ADD CONSTRAINT "shift_rotations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
