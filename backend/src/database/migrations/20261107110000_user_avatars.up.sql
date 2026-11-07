-- Profile photos: one per user (an account, across organizations), stored as a square WebP of at most 512 KiB.
CREATE TABLE "user_avatars" (
    "user_id" UUID NOT NULL,
    "content_type" VARCHAR(50) NOT NULL,
    "data" BYTEA NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_avatars_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "user_avatars_content_type_check" CHECK ("content_type" IN ('image/webp')),
    CONSTRAINT "user_avatars_byte_size_check" CHECK ("byte_size" > 0 AND "byte_size" <= 524288)
);
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Versioned, API-relative URL of the current photo (changes with the content).
ALTER TABLE "users" ADD COLUMN "avatar_url" VARCHAR(200);
