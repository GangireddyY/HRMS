-- Log archives are stored write-once (S3 Object Lock); the date until which the file can't be deleted or changed.
ALTER TABLE "log_archives" ADD COLUMN "locked_until" TIMESTAMPTZ(3);
