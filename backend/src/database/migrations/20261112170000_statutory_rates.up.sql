-- Statutory rates as data, so a yearly change (a Finance Act, an EPFO or ESIC notification) needs no release. Both
-- tables are national, not organization-owned. Payroll for a month uses the contribution rates in force on its first
-- day, and a financial year's tax rules when entered (otherwise the built-in ones).
CREATE TABLE "statutory_contribution_rates" (
    "id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "pf_rate" DECIMAL(6,4) NOT NULL,
    "eps_rate" DECIMAL(6,4) NOT NULL,
    "pf_wage_ceiling" INTEGER NOT NULL,
    "esi_employee_rate" DECIMAL(6,4) NOT NULL,
    "esi_employer_rate" DECIMAL(6,4) NOT NULL,
    "esi_wage_limit" INTEGER NOT NULL,
    "source" VARCHAR(300),
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "statutory_contribution_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "statutory_contribution_rates_values_check" CHECK (
        "pf_rate" BETWEEN 0 AND 0.5 AND "eps_rate" BETWEEN 0 AND "pf_rate"
        AND "esi_employee_rate" BETWEEN 0 AND 0.5 AND "esi_employer_rate" BETWEEN 0 AND 0.5
        AND "pf_wage_ceiling" > 0 AND "esi_wage_limit" > 0)
);
CREATE UNIQUE INDEX "statutory_contribution_rates_effective_from_uq" ON "statutory_contribution_rates"("effective_from");
ALTER TABLE "statutory_contribution_rates" ADD CONSTRAINT "statutory_contribution_rates_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The rates in force today (PF wage ceiling from 1 Sep 2014; ESI 0.75% / 3.25% from 1 Jul 2019, ₹21,000 limit).
INSERT INTO "statutory_contribution_rates" ("id", "effective_from", "pf_rate", "eps_rate", "pf_wage_ceiling", "esi_employee_rate", "esi_employer_rate", "esi_wage_limit", "source", "updated_at")
VALUES ('6f1d2c4e-0000-4000-8000-000000000001', '2019-07-01', 0.12, 0.0833, 15000, 0.0075, 0.0325, 21000, 'EPF ceiling notification of 1 Sep 2014; ESIC rate notification of 13 Jun 2019', CURRENT_TIMESTAMP);

CREATE TABLE "statutory_tax_rules" (
    "financial_year" SMALLINT NOT NULL,
    "rules" JSONB NOT NULL,
    "source" VARCHAR(300),
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "statutory_tax_rules_pkey" PRIMARY KEY ("financial_year"),
    CONSTRAINT "statutory_tax_rules_year_check" CHECK ("financial_year" BETWEEN 2025 AND 2100)
);
ALTER TABLE "statutory_tax_rules" ADD CONSTRAINT "statutory_tax_rules_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
