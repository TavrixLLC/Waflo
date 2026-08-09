CREATE TYPE "ExternalIdentityProvider" AS ENUM ('GOOGLE', 'APPLE');
CREATE TYPE "OAuthAuthorizationIntent" AS ENUM ('SIGN_IN', 'LINK');
CREATE TYPE "MerchantAccountRequestType" AS ENUM ('DEACTIVATION', 'DELETION');
CREATE TYPE "MerchantAccountRequestStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
CREATE TYPE "CustomerPrivacyDisposition" AS ENUM ('DELETED', 'ANONYMIZED', 'RETAINED_BY_POLICY');

ALTER TYPE "UserStatus" ADD VALUE 'DEACTIVATED';

ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
ALTER TABLE "users"
  ADD COLUMN "deactivated_at" TIMESTAMPTZ(6),
  ADD COLUMN "deletion_requested_at" TIMESTAMPTZ(6);

ALTER TABLE "customer_privacy_requests"
  ALTER COLUMN "requested_by_user_id" DROP NOT NULL,
  ADD COLUMN "requested_by_customer_session_id" UUID,
  ADD COLUMN "identity_validated_at" TIMESTAMPTZ(6),
  ADD COLUMN "outcome_disposition" "CustomerPrivacyDisposition",
  ADD COLUMN "retention_notice_code" VARCHAR(120);

ALTER TABLE "subscriptions"
  ADD COLUMN "reconciliation_lease_owner" VARCHAR(120),
  ADD COLUMN "reconciliation_lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "reconciliation_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reconciliation_failure_code" VARCHAR(120);

CREATE TABLE "external_identities" (
  "id" UUID NOT NULL,
  "provider" "ExternalIdentityProvider" NOT NULL,
  "issuer" VARCHAR(255) NOT NULL,
  "provider_subject" VARCHAR(255) NOT NULL,
  "user_id" UUID NOT NULL,
  "provider_email" VARCHAR(254),
  "email_verified" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauth_authorization_requests" (
  "id" UUID NOT NULL,
  "state_hash" CHAR(64) NOT NULL,
  "provider" "ExternalIdentityProvider" NOT NULL,
  "intent" "OAuthAuthorizationIntent" NOT NULL,
  "user_id" UUID,
  "reauthenticated_session_id" UUID,
  "nonce_hash" CHAR(64) NOT NULL,
  "code_verifier_ciphertext" TEXT NOT NULL,
  "allow_registration" BOOLEAN NOT NULL DEFAULT false,
  "locale" "Locale" NOT NULL DEFAULT 'EN',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "oauth_authorization_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "merchant_account_lifecycle_requests" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "request_type" "MerchantAccountRequestType" NOT NULL,
  "status" "MerchantAccountRequestStatus" NOT NULL DEFAULT 'PENDING',
  "idempotency_key" VARCHAR(255) NOT NULL,
  "identity_validated_at" TIMESTAMPTZ(6) NOT NULL,
  "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  "outcome_disposition" "CustomerPrivacyDisposition",
  "retention_notice_code" VARCHAR(120),
  "safe_failure_code" VARCHAR(120),
  CONSTRAINT "merchant_account_lifecycle_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "worker_heartbeats" (
  "worker_code" VARCHAR(60) NOT NULL,
  "instance_id" VARCHAR(120) NOT NULL,
  "started_at" TIMESTAMPTZ(6) NOT NULL,
  "last_loop_at" TIMESTAMPTZ(6) NOT NULL,
  "last_success_at" TIMESTAMPTZ(6),
  "last_failure_at" TIMESTAMPTZ(6),
  "safe_failure_code" VARCHAR(120),
  "backlog_count" INTEGER,
  "oldest_backlog_at" TIMESTAMPTZ(6),
  "stopping_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("worker_code")
);

CREATE UNIQUE INDEX "external_identities_provider_issuer_provider_subject_key"
  ON "external_identities"("provider", "issuer", "provider_subject");
CREATE UNIQUE INDEX "external_identities_user_id_provider_key"
  ON "external_identities"("user_id", "provider");
CREATE INDEX "external_identities_provider_email_idx"
  ON "external_identities"("provider_email");
CREATE UNIQUE INDEX "oauth_authorization_requests_state_hash_key"
  ON "oauth_authorization_requests"("state_hash");
CREATE INDEX "oauth_authorization_requests_provider_expires_at_consumed_at_idx"
  ON "oauth_authorization_requests"("provider", "expires_at", "consumed_at");
CREATE INDEX "oauth_authorization_requests_user_id_created_at_idx"
  ON "oauth_authorization_requests"("user_id", "created_at");
CREATE INDEX "oauth_authorization_requests_reauthenticated_session_id_idx"
  ON "oauth_authorization_requests"("reauthenticated_session_id");
CREATE UNIQUE INDEX "merchant_account_lifecycle_requests_user_id_idempotency_key_key"
  ON "merchant_account_lifecycle_requests"("user_id", "idempotency_key");
CREATE INDEX "merchant_account_lifecycle_requests_status_requested_at_idx"
  ON "merchant_account_lifecycle_requests"("status", "requested_at");
CREATE INDEX "worker_heartbeats_last_loop_at_idx" ON "worker_heartbeats"("last_loop_at");
CREATE INDEX "subscriptions_reconciliation_lease_expires_at_last_provider_sync_at_idx"
  ON "subscriptions"("reconciliation_lease_expires_at", "last_provider_sync_at");

ALTER TABLE "external_identities"
  ADD CONSTRAINT "external_identities_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_authorization_requests"
  ADD CONSTRAINT "oauth_authorization_requests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merchant_account_lifecycle_requests"
  ADD CONSTRAINT "merchant_account_lifecycle_requests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
