-- How payroll runs post to the organization's accounts (Tally journal export): ledger names per slot, earning
-- components with their own ledgers, and whether expense lines are split by department cost centre.
CREATE TABLE "accounting_settings" (
    "organization_id" UUID NOT NULL,
    "tally_company" VARCHAR(100),
    "voucher_type" VARCHAR(60) NOT NULL DEFAULT 'Journal',
    "cost_centres" BOOLEAN NOT NULL DEFAULT false,
    "cost_category" VARCHAR(100) NOT NULL DEFAULT 'Primary Cost Category',
    -- { SLOT: ledger name }; missing slots use the default name.
    "ledgers" JSONB NOT NULL DEFAULT '{}',
    -- { COMPONENT_CODE: ledger name }
    "earning_ledgers" JSONB NOT NULL DEFAULT '{}',
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounting_settings_pkey" PRIMARY KEY ("organization_id")
);
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "accounting_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounting_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "accounting_settings" USING ("hrms_tenant_visible"("organization_id")) WITH CHECK ("hrms_tenant_visible"("organization_id"));
