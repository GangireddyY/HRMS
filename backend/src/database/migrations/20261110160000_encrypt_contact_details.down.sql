-- Encrypted values don't fit the old lengths; they are cleared rather than truncated into garbage.
UPDATE "employees" SET "address" = NULL WHERE "address" ~ '^[vk][0-9]+:';
UPDATE "employees" SET "permanent_address" = NULL WHERE "permanent_address" ~ '^[vk][0-9]+:';
UPDATE "employees" SET "emergency_contact_name" = NULL WHERE "emergency_contact_name" ~ '^[vk][0-9]+:';
UPDATE "employees" SET "emergency_contact_phone" = NULL WHERE "emergency_contact_phone" ~ '^[vk][0-9]+:';
ALTER TABLE "employees"
    ALTER COLUMN "address" TYPE VARCHAR(500),
    ALTER COLUMN "permanent_address" TYPE VARCHAR(500),
    ALTER COLUMN "emergency_contact_name" TYPE VARCHAR(120),
    ALTER COLUMN "emergency_contact_phone" TYPE VARCHAR(30);
