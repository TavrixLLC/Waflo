ALTER TYPE "ProgramTestEventType" ADD VALUE IF NOT EXISTS 'TEST_REWARD_RELOCKED';

ALTER TABLE "program_test_sessions"
  ADD COLUMN "version_revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "validation_fingerprint" CHAR(64);

UPDATE "program_test_sessions" s
SET
  "version_revision" = v."revision",
  "validation_fingerprint" = v."validation_fingerprint"
FROM "loyalty_program_versions" v
WHERE v."id" = s."version_id";
