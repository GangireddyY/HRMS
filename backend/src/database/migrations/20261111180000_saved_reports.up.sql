-- Report builder: reports people save (columns, filters, grouping), private or shared with the organization.

CREATE TABLE "saved_reports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "dataset" VARCHAR(30) NOT NULL,
    "definition" JSONB NOT NULL,
    -- Shared reports are listed for everyone who may see the dataset (each sees only what their access allows).
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "saved_reports_organization_idx" ON "saved_reports"("organization_id", "owner_id");
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
