-- Skills on a candidate: picked from the resume when it's uploaded, editable by recruiters, searchable.
ALTER TABLE "candidates" ADD COLUMN "skills" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_skills_check" CHECK (jsonb_typeof("skills") = 'array' AND jsonb_array_length("skills") <= 50);
