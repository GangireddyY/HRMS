-- Exit letters (relieving letter, experience certificate) issued once an exit is completed, and the alumni network
-- former employees can join.

-- CreateTable
CREATE TABLE "exit_letters" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "type" VARCHAR(12) NOT NULL,
    -- REL-0001 / EXP-0001, numbered separately per organization.
    "reference" VARCHAR(20) NOT NULL,
    "letter_date" DATE NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    -- Plain text; paragraphs separated by blank lines. Fixed once issued.
    "body" TEXT NOT NULL,
    "signatory_name" VARCHAR(200) NOT NULL,
    "signatory_title" VARCHAR(200),
    "issued_by_id" UUID,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_by_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exit_letters_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exit_letters_type_check" CHECK ("type" IN ('RELIEVING', 'EXPERIENCE')),
    CONSTRAINT "exit_letters_body_check" CHECK (char_length("body") BETWEEN 1 AND 10000),
    CONSTRAINT "exit_letters_revoked_check" CHECK (("revoked_at" IS NULL) = ("revoked_reason" IS NULL))
);

-- CreateTable
CREATE TABLE "alumni_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    -- Opting out keeps the row but hides the contact details from HR.
    "opted_in" BOOLEAN NOT NULL DEFAULT true,
    "personal_email" VARCHAR(254),
    "phone" VARCHAR(30),
    "linkedin_url" VARCHAR(255),
    "current_company" VARCHAR(200),
    "current_title" VARCHAR(200),
    "city" VARCHAR(100),
    "open_to_opportunities" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "alumni_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exit_letters_id_organization_id_key" ON "exit_letters"("id", "organization_id");
CREATE UNIQUE INDEX "exit_letters_reference_key" ON "exit_letters"("organization_id", "reference");
CREATE UNIQUE INDEX "exit_letters_active_key" ON "exit_letters"("case_id", "type") WHERE "revoked_at" IS NULL;
CREATE INDEX "exit_letters_employee_id_idx" ON "exit_letters"("employee_id");
CREATE UNIQUE INDEX "alumni_profiles_employee_id_key" ON "alumni_profiles"("employee_id");
CREATE INDEX "alumni_profiles_organization_id_idx" ON "alumni_profiles"("organization_id", "opted_in");

-- AddForeignKey (organization)
ALTER TABLE "exit_letters" ADD CONSTRAINT "exit_letters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "alumni_profiles" ADD CONSTRAINT "alumni_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (tenant-safe composite references). Letters stay with their exit case; a profile belongs to the person.
ALTER TABLE "exit_letters" ADD CONSTRAINT "exit_letters_case_id_organization_id_fkey" FOREIGN KEY ("case_id", "organization_id") REFERENCES "exit_cases"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exit_letters" ADD CONSTRAINT "exit_letters_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "alumni_profiles" ADD CONSTRAINT "alumni_profiles_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (actors)
ALTER TABLE "exit_letters" ADD CONSTRAINT "exit_letters_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "exit_letters" ADD CONSTRAINT "exit_letters_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
