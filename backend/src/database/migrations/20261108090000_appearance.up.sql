-- Organization brand color (lowercase #rrggbb); the web app derives an accessible palette from it.
ALTER TABLE "organizations" ADD COLUMN "brand_color" VARCHAR(7);
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_brand_color_check" CHECK ("brand_color" IS NULL OR "brand_color" ~ '^#[0-9a-f]{6}$');

-- Per-user appearance (theme, mode, sidebar, region formats), so every device shows the same choices.
ALTER TABLE "users" ADD COLUMN "preferences" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "users" ADD CONSTRAINT "users_preferences_object_check" CHECK (jsonb_typeof("preferences") = 'object');
