-- Legal entities: the companies an organization employs people through, each with its country, currency and
-- registrations. Employees and pay groups belong to one; payroll for an entity outside India skips Indian statutory
-- deductions, and payslips carry the entity's currency.
CREATE TABLE "legal_entities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "legal_name" VARCHAR(200) NOT NULL,
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    -- [{ label, value }], e.g. PAN, TAN, GSTIN, EIN.
    "registrations" JSONB NOT NULL DEFAULT '[]',
    "address_line1" VARCHAR(200),
    "address_line2" VARCHAR(200),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "postal_code" VARCHAR(20),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "legal_entities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "legal_entities_country_check" CHECK ("country" ~ '^[A-Z]{2}$'),
    CONSTRAINT "legal_entities_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE UNIQUE INDEX "legal_entities_name_uq" ON "legal_entities"("organization_id", lower("name"));
CREATE UNIQUE INDEX "legal_entities_default_uq" ON "legal_entities"("organization_id") WHERE "is_default";
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employees" ADD COLUMN "legal_entity_id" UUID;
ALTER TABLE "employees" ADD CONSTRAINT "employees_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "employees_legal_entity_idx" ON "employees"("legal_entity_id");
ALTER TABLE "pay_groups" ADD COLUMN "legal_entity_id" UUID;
ALTER TABLE "pay_groups" ADD CONSTRAINT "pay_groups_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Exchange rates into the organization's base currency, by effective date.
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    -- Base-currency units for one unit of "currency".
    "rate" DECIMAL(18, 8) NOT NULL,
    "effective_on" DATE NOT NULL,
    "source" VARCHAR(120),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exchange_rates_rate_check" CHECK ("rate" > 0),
    CONSTRAINT "exchange_rates_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE UNIQUE INDEX "exchange_rates_uq" ON "exchange_rates"("organization_id", "currency", "effective_on");
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Expense claims in another currency: the receipt amount and the rate used; "amount" stays in the pay currency.
ALTER TABLE "reimbursement_claims" ADD COLUMN "currency" CHAR(3);
ALTER TABLE "reimbursement_claims" ADD COLUMN "original_amount" DECIMAL(12, 2);
ALTER TABLE "reimbursement_claims" ADD COLUMN "exchange_rate" DECIMAL(18, 8);

-- The currency a payslip is in (the entity's; null = the organization's).
ALTER TABLE "payslips" ADD COLUMN "currency" CHAR(3);

ALTER TABLE "legal_entities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legal_entities" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "legal_entities" USING ("hrms_tenant_visible"("organization_id")) WITH CHECK ("hrms_tenant_visible"("organization_id"));
ALTER TABLE "exchange_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "exchange_rates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "exchange_rates" USING ("hrms_tenant_visible"("organization_id")) WITH CHECK ("hrms_tenant_visible"("organization_id"));
