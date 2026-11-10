-- Contact details are encrypted at rest (ciphertext is longer than the plain value). Existing plain values stay
-- readable and are encrypted by `npm run db:reencrypt` (run by the release job after migrations).
ALTER TABLE "employees"
    ALTER COLUMN "address" TYPE TEXT,
    ALTER COLUMN "permanent_address" TYPE TEXT,
    ALTER COLUMN "emergency_contact_name" TYPE TEXT,
    ALTER COLUMN "emergency_contact_phone" TYPE TEXT;
