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

UPDATE "program_enrollment_policies"
SET "phone_collection_mode" = "email_collection_mode"::text::"PhoneCollectionMode";
