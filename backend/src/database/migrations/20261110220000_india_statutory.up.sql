-- Labour welfare fund (state-wise, deducted in the months the state prescribes) and investment-proof verification.
ALTER TABLE "payroll_settings" ADD COLUMN "lwf_enabled" BOOLEAN NOT NULL DEFAULT false,
    -- Calendar month (1–12) from which tax uses only accepted proofs; null = declarations are trusted all year.
    ADD COLUMN "proofs_from_month" SMALLINT,
    ADD CONSTRAINT "payroll_settings_proofs_from_month_check" CHECK ("proofs_from_month" IS NULL OR "proofs_from_month" BETWEEN 1 AND 12);

-- ESIC insurance (IP) number, for the monthly ESI return.
ALTER TABLE "employees" ADD COLUMN "esi_number" VARCHAR(17);

CREATE TABLE "tax_declaration_proofs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "financial_year" SMALLINT NOT NULL,
    "section" VARCHAR(12) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "amount" NUMERIC(12,2) NOT NULL,
    "storage_key" VARCHAR(300) NOT NULL,
    "file_name" VARCHAR(200) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'SUBMITTED',
    "accepted_amount" NUMERIC(12,2),
    "review_note" VARCHAR(500),
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_declaration_proofs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tax_declaration_proofs_section_check" CHECK ("section" IN ('80C', '80CCD1B', '80D', 'HRA', 'HOME_LOAN')),
    CONSTRAINT "tax_declaration_proofs_status_check" CHECK ("status" IN ('SUBMITTED', 'ACCEPTED', 'REJECTED')),
    CONSTRAINT "tax_declaration_proofs_amount_check" CHECK ("amount" > 0 AND ("accepted_amount" IS NULL OR ("accepted_amount" >= 0 AND "accepted_amount" <= "amount"))),
    CONSTRAINT "tax_declaration_proofs_accepted_check" CHECK (("status" = 'ACCEPTED') = ("accepted_amount" IS NOT NULL))
);
CREATE INDEX "tax_declaration_proofs_employee_idx" ON "tax_declaration_proofs"("employee_id", "financial_year");
CREATE INDEX "tax_declaration_proofs_status_idx" ON "tax_declaration_proofs"("organization_id", "financial_year", "status");
ALTER TABLE "tax_declaration_proofs" ADD CONSTRAINT "tax_declaration_proofs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tax_declaration_proofs" ADD CONSTRAINT "tax_declaration_proofs_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON UPDATE CASCADE;
ALTER TABLE "tax_declaration_proofs" ADD CONSTRAINT "tax_declaration_proofs_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tax_declaration_proofs" ADD CONSTRAINT "tax_declaration_proofs_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
