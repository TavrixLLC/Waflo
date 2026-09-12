CREATE TYPE "AppleTokenRevocationStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'DEAD_LETTER'
);
CREATE TYPE "AppleTokenRevocationReason" AS ENUM ('UNLINK', 'ACCOUNT_DELETION');
CREATE TYPE "AppleTokenType" AS ENUM ('REFRESH_TOKEN', 'ACCESS_TOKEN');

-- Outstanding pre-repair flows cannot be browser-bound retroactively. Invalidate
-- them during deployment and require users to initiate a fresh authorization.
ALTER TABLE "oauth_authorization_requests"
  ADD COLUMN "browser_binding_hash" CHAR(64);
UPDATE "oauth_authorization_requests"
SET
  "browser_binding_hash" = "state_hash",
  "consumed_at" = COALESCE("consumed_at", CURRENT_TIMESTAMP);
ALTER TABLE "oauth_authorization_requests"
  ALTER COLUMN "browser_binding_hash" SET NOT NULL;

-- Both spellings are valid Google token issuers, but they represent one issuer
-- namespace. Never silently merge an impossible cross-account collision.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "external_identities"
    WHERE
      "provider" = 'GOOGLE'
      AND "issuer" IN ('https://accounts.google.com', 'accounts.google.com')
    GROUP BY "provider_subject"
    HAVING COUNT(DISTINCT "user_id") > 1
  ) THEN
    RAISE EXCEPTION
      'Google issuer canonicalization collision: one Google subject is attached to multiple Waflo users';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "external_identities"
    WHERE
      "provider" = 'GOOGLE'
      AND "issuer" NOT IN ('https://accounts.google.com', 'accounts.google.com')
  ) THEN
    RAISE EXCEPTION
      'Google issuer canonicalization found an unsupported persisted issuer';
  END IF;
END
$$;

UPDATE "external_identities"
SET "issuer" = 'https://accounts.google.com'
WHERE "provider" = 'GOOGLE' AND "issuer" = 'accounts.google.com';

ALTER TABLE "external_identities"
  ADD COLUMN "email_forwarding_enabled" BOOLEAN,
  ADD CONSTRAINT "external_identities_google_issuer_canonical_check"
    CHECK ("provider" <> 'GOOGLE' OR "issuer" = 'https://accounts.google.com');

CREATE TABLE "apple_authorization_credentials" (
  "id" UUID NOT NULL,
  "external_identity_id" UUID NOT NULL,
  "refresh_token_encrypted" TEXT,
  "refresh_token_key_version" INTEGER,
  "access_token_encrypted" TEXT,
  "access_token_key_version" INTEGER,
  "access_token_expires_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "apple_authorization_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "apple_authorization_credentials_has_token_check" CHECK (
    "refresh_token_encrypted" IS NOT NULL OR "access_token_encrypted" IS NOT NULL
  ),
  CONSTRAINT "apple_authorization_credentials_refresh_key_check" CHECK (
    ("refresh_token_encrypted" IS NULL) = ("refresh_token_key_version" IS NULL)
  ),
  CONSTRAINT "apple_authorization_credentials_access_key_check" CHECK (
    ("access_token_encrypted" IS NULL) = ("access_token_key_version" IS NULL)
  )
);

CREATE UNIQUE INDEX "apple_authorization_credentials_external_identity_id_key"
  ON "apple_authorization_credentials"("external_identity_id");

ALTER TABLE "apple_authorization_credentials"
  ADD CONSTRAINT "apple_authorization_credentials_external_identity_id_fkey"
  FOREIGN KEY ("external_identity_id") REFERENCES "external_identities"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "apple_token_revocation_jobs" (
  "id" UUID NOT NULL,
  "idempotency_key" VARCHAR(255) NOT NULL,
  "encryption_context_id" UUID NOT NULL,
  "token_encrypted" TEXT,
  "token_key_version" INTEGER NOT NULL,
  "token_type" "AppleTokenType" NOT NULL,
  "reason" "AppleTokenRevocationReason" NOT NULL,
  "status" "AppleTokenRevocationStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_owner" VARCHAR(120),
  "lease_expires_at" TIMESTAMPTZ(6),
  "last_failure_code" VARCHAR(120),
  "completed_at" TIMESTAMPTZ(6),
  "token_cleared_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "apple_token_revocation_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "apple_token_revocation_jobs_token_lifecycle_check" CHECK (
    ("status" IN ('PENDING', 'PROCESSING') AND "token_encrypted" IS NOT NULL AND "token_cleared_at" IS NULL)
    OR
    ("status" IN ('COMPLETED', 'DEAD_LETTER') AND "token_encrypted" IS NULL AND "token_cleared_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "apple_token_revocation_jobs_idempotency_key_key"
  ON "apple_token_revocation_jobs"("idempotency_key");
CREATE INDEX "apple_token_revocation_jobs_status_next_attempt_at_lease_expires_at_idx"
  ON "apple_token_revocation_jobs"("status", "next_attempt_at", "lease_expires_at");

CREATE TABLE "apple_server_notifications" (
  "id" UUID NOT NULL,
  "notification_id" VARCHAR(255) NOT NULL,
  "event_type" VARCHAR(40) NOT NULL,
  "provider_subject" VARCHAR(255) NOT NULL,
  "event_time" TIMESTAMPTZ(6) NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "apple_server_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "apple_server_notifications_notification_id_key"
  ON "apple_server_notifications"("notification_id");
CREATE INDEX "apple_server_notifications_provider_subject_event_time_idx"
  ON "apple_server_notifications"("provider_subject", "event_time");
