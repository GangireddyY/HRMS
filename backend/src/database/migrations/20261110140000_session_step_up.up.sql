-- Step-up authentication: sensitive actions (bank file, PF ECR, audit archives) need a fresh MFA code or password.
ALTER TABLE "user_sessions" ADD COLUMN "step_up_at" TIMESTAMPTZ(3);
