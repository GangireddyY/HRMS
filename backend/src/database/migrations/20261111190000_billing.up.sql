-- Billing (manual): each organization's subscription, the invoices the platform issues, and payments recorded against them.

CREATE TABLE "organization_subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'TRIAL',
    "billing_cycle" VARCHAR(10) NOT NULL DEFAULT 'MONTHLY',
    -- Overrides of the plan: null = the plan's user limit / monthly price.
    "seats" INTEGER,
    "price_per_month" DECIMAL(12,2),
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_rate_pct" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "payment_terms_days" SMALLINT NOT NULL DEFAULT 15,
    "trial_ends_on" DATE,
    -- The next invoice covers the period starting here.
    "next_period_start" DATE,
    "billing_name" VARCHAR(200),
    "billing_email" VARCHAR(254),
    "billing_address" VARCHAR(500),
    "billing_tax_id" VARCHAR(20),
    "notes" VARCHAR(1000),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "organization_subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "organization_subscriptions_status_check" CHECK ("status" IN ('TRIAL', 'ACTIVE', 'CANCELLED')),
    CONSTRAINT "organization_subscriptions_cycle_check" CHECK ("billing_cycle" IN ('MONTHLY', 'QUARTERLY', 'ANNUAL')),
    CONSTRAINT "organization_subscriptions_seats_check" CHECK ("seats" IS NULL OR "seats" > 0),
    CONSTRAINT "organization_subscriptions_price_check" CHECK ("price_per_month" IS NULL OR "price_per_month" >= 0),
    CONSTRAINT "organization_subscriptions_discount_check" CHECK ("discount_pct" >= 0 AND "discount_pct" <= 100),
    CONSTRAINT "organization_subscriptions_tax_check" CHECK ("tax_rate_pct" >= 0 AND "tax_rate_pct" <= 100),
    CONSTRAINT "organization_subscriptions_terms_check" CHECK ("payment_terms_days" >= 0 AND "payment_terms_days" <= 90)
);
CREATE UNIQUE INDEX "organization_subscriptions_organization_uq" ON "organization_subscriptions"("organization_id");
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    -- Assigned when issued (INV-2026-0001).
    "number" VARCHAR(30),
    "status" VARCHAR(8) NOT NULL DEFAULT 'DRAFT',
    "period_start" DATE,
    "period_end" DATE,
    "issue_date" DATE,
    "due_date" DATE,
    "currency" CHAR(3) NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_rate_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    -- Who it was billed to, as of issuing.
    "bill_to" JSONB,
    "notes" VARCHAR(1000),
    "issued_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "updated_by_id" UUID,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoices_status_check" CHECK ("status" IN ('DRAFT', 'ISSUED', 'PAID', 'VOID')),
    CONSTRAINT "invoices_paid_check" CHECK ("amount_paid" >= 0 AND "amount_paid" <= "total"),
    CONSTRAINT "invoices_number_check" CHECK ("status" = 'DRAFT' OR "number" IS NOT NULL OR "status" = 'VOID')
);
CREATE UNIQUE INDEX "invoices_number_uq" ON "invoices"("number") WHERE "number" IS NOT NULL;
-- One live invoice per subscription period.
CREATE UNIQUE INDEX "invoices_period_uq" ON "invoices"("organization_id", "period_start") WHERE "status" <> 'VOID' AND "period_start" IS NOT NULL;
CREATE INDEX "invoices_organization_idx" ON "invoices"("organization_id", "created_at");
CREATE INDEX "invoices_status_idx" ON "invoices"("status", "due_date");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "invoice_payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" VARCHAR(16) NOT NULL,
    "reference" VARCHAR(100),
    "note" VARCHAR(500),
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoice_payments_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "invoice_payments_method_check" CHECK ("method" IN ('BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD', 'CASH', 'OTHER'))
);
CREATE INDEX "invoice_payments_invoice_idx" ON "invoice_payments"("invoice_id");
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
