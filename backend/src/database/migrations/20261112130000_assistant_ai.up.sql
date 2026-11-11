-- The AI assistant sends questions and the data its tools look up to the configured model provider, so each
-- organization opts in.
ALTER TABLE "organizations" ADD COLUMN "assistant_ai_enabled" BOOLEAN NOT NULL DEFAULT false;
