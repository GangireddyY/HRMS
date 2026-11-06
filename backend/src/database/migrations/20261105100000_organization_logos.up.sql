-- CreateTable: one logo image per organization (PNG, JPEG or WebP, at most 1 MiB).
CREATE TABLE "organization_logos" (
    "organization_id" UUID NOT NULL,
    "content_type" VARCHAR(50) NOT NULL,
    "data" BYTEA NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "organization_logos_pkey" PRIMARY KEY ("organization_id"),
    CONSTRAINT "organization_logos_content_type_check" CHECK ("content_type" IN ('image/png', 'image/jpeg', 'image/webp')),
    CONSTRAINT "organization_logos_byte_size_check" CHECK ("byte_size" > 0 AND "byte_size" <= 1048576)
);

-- AddForeignKey
ALTER TABLE "organization_logos" ADD CONSTRAINT "organization_logos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_logos" ADD CONSTRAINT "organization_logos_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
