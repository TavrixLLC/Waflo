ALTER TYPE "OAuthAuthorizationIntent" ADD VALUE IF NOT EXISTS 'SIGN_UP';

ALTER TABLE "oauth_authorization_requests"
ADD COLUMN "terms_version" VARCHAR(60),
ADD COLUMN "privacy_version" VARCHAR(60),
ADD COLUMN "legal_accepted_at" TIMESTAMPTZ(6);

ALTER TABLE "organizations"
ADD COLUMN "onboarding_command_id" UUID,
ADD COLUMN "onboarding_request_fingerprint" CHAR(64);

CREATE UNIQUE INDEX "organizations_onboarding_command_id_key"
ON "organizations"("onboarding_command_id");

ALTER TABLE "checkout_idempotency_keys"
ADD COLUMN "selected_cadence" "BillingCadence" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN "request_fingerprint" CHAR(64),
ADD COLUMN "stripe_customer_id" VARCHAR(255),
ADD COLUMN "stripe_setup_intent_id" VARCHAR(255),
ADD COLUMN "stripe_payment_method_id" VARCHAR(255),
ADD COLUMN "stripe_subscription_id" VARCHAR(255),
ADD COLUMN "status" VARCHAR(40) NOT NULL DEFAULT 'LEGACY_CHECKOUT',
ADD COLUMN "expires_at" TIMESTAMPTZ(6),
ADD COLUMN "completed_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "checkout_idempotency_keys_stripe_setup_intent_id_key"
ON "checkout_idempotency_keys"("stripe_setup_intent_id");

CREATE UNIQUE INDEX "checkout_idempotency_keys_stripe_subscription_id_key"
ON "checkout_idempotency_keys"("stripe_subscription_id");

CREATE INDEX "checkout_idempotency_keys_organization_id_status_expires_at_idx"
ON "checkout_idempotency_keys"("organization_id", "status", "expires_at");

ALTER TABLE "checkout_idempotency_keys"
ADD CONSTRAINT "checkout_onboarding_status_allowed" CHECK (
  "status" IN (
    'LEGACY_CHECKOUT',
    'SETUP_PENDING',
    'SETUP_SUCCEEDED',
    'SUBSCRIPTION_CREATED',
    'FAILED'
  )
);
