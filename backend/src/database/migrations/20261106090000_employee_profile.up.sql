-- Grades, cost centers and the remaining employee profile sections: personal details, identity numbers,
-- family, education, previous employment and documents. Same tenant-safe composite foreign keys as people_core.

-- CreateTable
CREATE TABLE "grades" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(30),
    "level" SMALLINT,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "grades_level_check" CHECK ("level" IS NULL OR ("level" BETWEEN 1 AND 50))
);

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "employees"
    ADD COLUMN "grade_id" UUID,
    ADD COLUMN "cost_center_id" UUID,
    ADD COLUMN "marital_status" VARCHAR(20),
    ADD COLUMN "blood_group" VARCHAR(3),
    ADD COLUMN "nationality" CHAR(2),
    ADD COLUMN "permanent_address" VARCHAR(500),
    ADD COLUMN "notice_period_days" SMALLINT,
    ADD COLUMN "aadhaar_encrypted" TEXT,
    ADD COLUMN "aadhaar_last4" VARCHAR(4),
    ADD COLUMN "passport_encrypted" TEXT,
    ADD COLUMN "passport_expiry" DATE,
    ADD CONSTRAINT "employees_marital_status_check" CHECK ("marital_status" IS NULL OR "marital_status" IN ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'SEPARATED', 'UNDISCLOSED')),
    ADD CONSTRAINT "employees_blood_group_check" CHECK ("blood_group" IS NULL OR "blood_group" IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    ADD CONSTRAINT "employees_notice_period_days_check" CHECK ("notice_period_days" IS NULL OR ("notice_period_days" BETWEEN 0 AND 365));

-- CreateTable
CREATE TABLE "employee_family_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "relationship" VARCHAR(20) NOT NULL,
    "date_of_birth" DATE,
    "gender" VARCHAR(20),
    "phone" VARCHAR(30),
    "is_dependent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "employee_family_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_family_members_relationship_check" CHECK ("relationship" IN ('SPOUSE', 'CHILD', 'FATHER', 'MOTHER', 'SIBLING', 'OTHER')),
    CONSTRAINT "employee_family_members_gender_check" CHECK ("gender" IS NULL OR "gender" IN ('MALE', 'FEMALE', 'NON_BINARY', 'UNDISCLOSED'))
);

-- CreateTable
CREATE TABLE "employee_education" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "level" VARCHAR(20) NOT NULL,
    "qualification" VARCHAR(120) NOT NULL,
    "specialization" VARCHAR(120),
    "institution" VARCHAR(200) NOT NULL,
    "start_year" SMALLINT,
    "end_year" SMALLINT,
    "score" VARCHAR(30),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "employee_education_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_education_level_check" CHECK ("level" IN ('SECONDARY', 'HIGHER_SECONDARY', 'DIPLOMA', 'BACHELORS', 'MASTERS', 'DOCTORATE', 'CERTIFICATION', 'OTHER')),
    CONSTRAINT "employee_education_years_check" CHECK (
        ("start_year" IS NULL OR "start_year" BETWEEN 1950 AND 2100)
        AND ("end_year" IS NULL OR "end_year" BETWEEN 1950 AND 2100)
        AND ("start_year" IS NULL OR "end_year" IS NULL OR "end_year" >= "start_year")
    )
);

-- CreateTable
CREATE TABLE "employee_experience" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "company" VARCHAR(200) NOT NULL,
    "designation" VARCHAR(120) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "location" VARCHAR(120),
    "description" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "employee_experience_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_experience_dates_check" CHECK ("end_date" >= "start_date")
);

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "expiry_date" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "review_note" VARCHAR(500),
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_documents_category_check" CHECK ("category" IN ('IDENTITY', 'ADDRESS', 'EDUCATION', 'EXPERIENCE', 'OFFER_LETTER', 'CONTRACT', 'CERTIFICATION', 'MEDICAL', 'OTHER')),
    CONSTRAINT "employee_documents_status_check" CHECK ("status" IN ('PENDING', 'VERIFIED', 'REJECTED')),
    CONSTRAINT "employee_documents_content_type_check" CHECK ("content_type" IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
    CONSTRAINT "employee_documents_byte_size_check" CHECK ("byte_size" > 0 AND "byte_size" <= 10485760),
    CONSTRAINT "employee_documents_review_check" CHECK (("status" = 'PENDING') = ("reviewed_at" IS NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "grades_id_organization_id_key" ON "grades"("id", "organization_id");
CREATE UNIQUE INDEX "grades_organization_id_name_key" ON "grades"("organization_id", lower("name"));
CREATE UNIQUE INDEX "grades_organization_id_code_key" ON "grades"("organization_id", lower("code")) WHERE "code" IS NOT NULL;
CREATE UNIQUE INDEX "cost_centers_id_organization_id_key" ON "cost_centers"("id", "organization_id");
CREATE UNIQUE INDEX "cost_centers_organization_id_code_key" ON "cost_centers"("organization_id", lower("code"));
CREATE INDEX "employees_organization_id_grade_id_idx" ON "employees"("organization_id", "grade_id");
CREATE INDEX "employees_organization_id_cost_center_id_idx" ON "employees"("organization_id", "cost_center_id");
CREATE INDEX "employee_family_members_employee_id_idx" ON "employee_family_members"("employee_id");
CREATE INDEX "employee_education_employee_id_idx" ON "employee_education"("employee_id");
CREATE INDEX "employee_experience_employee_id_idx" ON "employee_experience"("employee_id");
CREATE INDEX "employee_documents_employee_id_idx" ON "employee_documents"("employee_id", "created_at");
CREATE INDEX "employee_documents_organization_id_expiry_date_idx" ON "employee_documents"("organization_id", "expiry_date") WHERE "expiry_date" IS NOT NULL;
CREATE UNIQUE INDEX "employee_documents_storage_key_key" ON "employee_documents"("storage_key");

-- AddForeignKey (organization)
ALTER TABLE "grades" ADD CONSTRAINT "grades_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_family_members" ADD CONSTRAINT "employee_family_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_education" ADD CONSTRAINT "employee_education_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_experience" ADD CONSTRAINT "employee_experience_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (tenant-safe composite references)
ALTER TABLE "employees" ADD CONSTRAINT "employees_grade_id_organization_id_fkey" FOREIGN KEY ("grade_id", "organization_id") REFERENCES "grades"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_cost_center_id_organization_id_fkey" FOREIGN KEY ("cost_center_id", "organization_id") REFERENCES "cost_centers"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "employee_family_members" ADD CONSTRAINT "employee_family_members_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_education" ADD CONSTRAINT "employee_education_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_experience" ADD CONSTRAINT "employee_experience_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Documents block deleting the employee (files must be removed through the API so storage is cleaned up).
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;

-- AddForeignKey (audit columns)
ALTER TABLE "grades" ADD CONSTRAINT "grades_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
