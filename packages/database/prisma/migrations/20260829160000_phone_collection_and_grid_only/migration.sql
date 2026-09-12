DO $$
BEGIN
  CREATE TYPE "PhoneCollectionMode" AS ENUM ('HIDDEN', 'OPTIONAL', 'REQUIRED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "CustomerContactType" ADD VALUE IF NOT EXISTS 'PHONE';
ALTER TYPE "CustomerConsentType" ADD VALUE IF NOT EXISTS 'MARKETING_PHONE';

ALTER TABLE "program_enrollment_policies"
  ADD COLUMN IF NOT EXISTS "phone_collection_mode" "PhoneCollectionMode" NOT NULL DEFAULT 'OPTIONAL';

-- Published and superseded policy versions are immutable audit snapshots.  The
-- new default makes those rows phone-compatible without rewriting their
-- historical configuration; only an editable draft may carry its legacy mode
-- forward into the current phone-based enrollment contract.
UPDATE "program_enrollment_policies" AS policy
SET "phone_collection_mode" = policy."email_collection_mode"::text::"PhoneCollectionMode"
FROM "loyalty_program_versions" AS version
WHERE version."id" = policy."program_version_id"
  AND version."status" = 'DRAFT'
  AND policy."phone_collection_mode" IS DISTINCT FROM policy."email_collection_mode"::text::"PhoneCollectionMode";
