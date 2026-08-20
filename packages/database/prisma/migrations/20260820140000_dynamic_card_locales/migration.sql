BEGIN;

ALTER TABLE "loyalty_program_versions"
ADD COLUMN "default_card_locale" VARCHAR(35) NOT NULL DEFAULT 'en';

CREATE TABLE "program_version_locales" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "locale" VARCHAR(35) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "program_name" VARCHAR(120),
    "short_description" VARCHAR(240),
    "full_description" TEXT,
    "reward_summary" VARCHAR(240),
    "join_instructions" TEXT,
    "terms_and_conditions" TEXT,
    "completion_message" VARCHAR(240),
    "reward_unlocked_message" VARCHAR(240),
    "paused_message" VARCHAR(240),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "program_version_locales_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "program_locale_reward_translations" (
    "id" UUID NOT NULL,
    "reward_id" UUID NOT NULL,
    "program_version_locale_id" UUID NOT NULL,
    "name" VARCHAR(120),
    "description" VARCHAR(240),
    "redemption_instructions" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "program_locale_reward_translations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "program_version_locales_version_id_locale_key"
ON "program_version_locales"("version_id", "locale");

CREATE INDEX "program_version_locales_version_id_enabled_position_idx"
ON "program_version_locales"("version_id", "enabled", "position");

CREATE UNIQUE INDEX "program_locale_reward_translations_reward_id_program_version_locale_id_key"
ON "program_locale_reward_translations"("reward_id", "program_version_locale_id");

CREATE INDEX "program_locale_reward_translations_program_version_locale_id_idx"
ON "program_locale_reward_translations"("program_version_locale_id");

ALTER TABLE "program_version_locales"
ADD CONSTRAINT "program_version_locales_version_id_fkey"
FOREIGN KEY ("version_id") REFERENCES "loyalty_program_versions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "program_locale_reward_translations"
ADD CONSTRAINT "program_locale_reward_translations_reward_id_fkey"
FOREIGN KEY ("reward_id") REFERENCES "reward_definitions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "program_locale_reward_translations"
ADD CONSTRAINT "program_locale_reward_translations_program_version_locale_id_fkey"
FOREIGN KEY ("program_version_locale_id") REFERENCES "program_version_locales"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve the current authoritative primary locale for every historical
-- version. Existing product values are EN/AR and are normalized to BCP-47.
-- The existing immutability guard intentionally rejects every update to a
-- published/superseded row. Disable only that trigger inside this transaction
-- while backfilling the newly-added column, then restore it before commit.
ALTER TABLE "loyalty_program_versions"
DISABLE TRIGGER "loyalty_program_version_tenant_guard";

UPDATE "loyalty_program_versions" AS version
SET "default_card_locale" = CASE
  WHEN policy."primary_customer_locale"::text = 'AR'
    AND EXISTS (
      SELECT 1 FROM "program_translations" AS translation
      WHERE translation."version_id" = version."id"
        AND translation."locale"::text = 'AR'
    ) THEN 'ar'
  WHEN EXISTS (
    SELECT 1 FROM "program_translations" AS translation
    WHERE translation."version_id" = version."id"
      AND translation."locale"::text = 'EN'
  ) THEN 'en'
  WHEN EXISTS (
    SELECT 1 FROM "program_translations" AS translation
    WHERE translation."version_id" = version."id"
      AND translation."locale"::text = 'AR'
  ) THEN 'ar'
  ELSE 'en'
END
FROM "program_enrollment_policies" AS policy
WHERE policy."program_version_id" = version."id";

ALTER TABLE "loyalty_program_versions"
ENABLE TRIGGER "loyalty_program_version_tenant_guard";

-- Existing contracts required meaningful EN and AR rows, so both retain their
-- enabled status and deterministic order without inventing any translations.
INSERT INTO "program_version_locales" (
  "id", "version_id", "locale", "enabled", "position", "program_name",
  "short_description", "full_description", "reward_summary", "join_instructions",
  "terms_and_conditions", "completion_message", "reward_unlocked_message",
  "paused_message", "created_at", "updated_at"
)
SELECT
  "id", "version_id",
  CASE WHEN "locale"::text = 'AR' THEN 'ar' ELSE 'en' END,
  true,
  CASE WHEN "locale"::text = 'EN' THEN 0 ELSE 1 END,
  "program_name", "short_description", "full_description", "reward_summary",
  "join_instructions", "terms_and_conditions", "completion_message",
  "reward_unlocked_message", "paused_message", "created_at", "updated_at"
FROM "program_translations";

INSERT INTO "program_locale_reward_translations" (
  "id", "reward_id", "program_version_locale_id", "name", "description",
  "redemption_instructions", "created_at", "updated_at"
)
SELECT
  reward_translation."id",
  reward_translation."reward_id",
  version_locale."id",
  reward_translation."name",
  reward_translation."description",
  reward_translation."redemption_instructions",
  reward_translation."created_at",
  reward_translation."updated_at"
FROM "reward_translations" AS reward_translation
JOIN "reward_definitions" AS reward
  ON reward."id" = reward_translation."reward_id"
JOIN "program_version_locales" AS version_locale
  ON version_locale."version_id" = reward."version_id"
  AND version_locale."locale" = CASE
    WHEN reward_translation."locale"::text = 'AR' THEN 'ar'
    ELSE 'en'
  END;

-- Apply the established draft/live immutability boundary to the new dynamic
-- locale rows. Backfill completes before these guards are installed.
CREATE TRIGGER "program_version_locales_immutable_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "program_version_locales"
FOR EACH ROW EXECUTE FUNCTION "waflo_reject_protected_child_change"();

CREATE TRIGGER "program_locale_reward_translations_immutable_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "program_locale_reward_translations"
FOR EACH ROW EXECUTE FUNCTION "waflo_reject_protected_reward_child_change"();

COMMIT;
