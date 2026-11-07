-- Skill matrix: a skills catalog, each employee's self-rated and verified levels (1–5), the skills each designation
-- needs, and the skills courses teach (completing a course raises the verified level).

CREATE TABLE "skills" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "category" VARCHAR(10) NOT NULL,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "skills_category_check" CHECK ("category" IN ('TECHNICAL', 'TOOL', 'DOMAIN', 'SOFT', 'LANGUAGE', 'OTHER'))
);

CREATE TABLE "employee_skills" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    -- The employee's own rating.
    "level" SMALLINT,
    -- Confirmed by a manager / HR, or earned by completing a course.
    "verified_level" SMALLINT,
    "verified_by_id" UUID,
    "verified_at" TIMESTAMPTZ(3),
    "verified_source" VARCHAR(8),
    "notes" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employee_skills_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_skills_level_check" CHECK (("level" IS NULL OR "level" BETWEEN 1 AND 5) AND ("verified_level" IS NULL OR "verified_level" BETWEEN 1 AND 5) AND ("level" IS NOT NULL OR "verified_level" IS NOT NULL)),
    CONSTRAINT "employee_skills_verified_check" CHECK (("verified_level" IS NULL) = ("verified_source" IS NULL) AND ("verified_source" IS NULL OR "verified_source" IN ('MANAGER', 'TRAINING')))
);

CREATE TABLE "designation_skills" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "designation_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "required_level" SMALLINT NOT NULL,

    CONSTRAINT "designation_skills_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "designation_skills_level_check" CHECK ("required_level" BETWEEN 1 AND 5)
);

CREATE TABLE "training_course_skills" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "level" SMALLINT NOT NULL,

    CONSTRAINT "training_course_skills_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "training_course_skills_level_check" CHECK ("level" BETWEEN 1 AND 5)
);

-- CreateIndex
CREATE UNIQUE INDEX "skills_id_organization_id_key" ON "skills"("id", "organization_id");
CREATE UNIQUE INDEX "skills_organization_id_name_key" ON "skills"("organization_id", lower("name"));
CREATE UNIQUE INDEX "employee_skills_employee_id_skill_id_key" ON "employee_skills"("employee_id", "skill_id");
CREATE INDEX "employee_skills_skill_id_idx" ON "employee_skills"("skill_id");
CREATE UNIQUE INDEX "designation_skills_designation_id_skill_id_key" ON "designation_skills"("designation_id", "skill_id");
CREATE UNIQUE INDEX "training_course_skills_course_id_skill_id_key" ON "training_course_skills"("course_id", "skill_id");
CREATE INDEX "training_course_skills_skill_id_idx" ON "training_course_skills"("skill_id");

-- AddForeignKey (organization)
ALTER TABLE "skills" ADD CONSTRAINT "skills_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "designation_skills" ADD CONSTRAINT "designation_skills_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_course_skills" ADD CONSTRAINT "training_course_skills_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (tenant-safe composite references). Skills in use can't be deleted (deactivate them instead).
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_skill_id_organization_id_fkey" FOREIGN KEY ("skill_id", "organization_id") REFERENCES "skills"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "designation_skills" ADD CONSTRAINT "designation_skills_designation_id_organization_id_fkey" FOREIGN KEY ("designation_id", "organization_id") REFERENCES "designations"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "designation_skills" ADD CONSTRAINT "designation_skills_skill_id_organization_id_fkey" FOREIGN KEY ("skill_id", "organization_id") REFERENCES "skills"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "training_course_skills" ADD CONSTRAINT "training_course_skills_course_id_organization_id_fkey" FOREIGN KEY ("course_id", "organization_id") REFERENCES "training_courses"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "training_course_skills" ADD CONSTRAINT "training_course_skills_skill_id_organization_id_fkey" FOREIGN KEY ("skill_id", "organization_id") REFERENCES "skills"("id", "organization_id") ON UPDATE CASCADE;

-- AddForeignKey (actors)
ALTER TABLE "skills" ADD CONSTRAINT "skills_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
