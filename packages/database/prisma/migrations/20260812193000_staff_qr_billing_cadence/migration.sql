CREATE TYPE "BillingCadence" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');
CREATE TYPE "BillingEmailStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'DEAD_LETTER', 'CANCELED');
CREATE TYPE "BillingRecoveryStatus" AS ENUM ('NONE', 'GRACE', 'ACTION_REQUIRED', 'RECOVERED', 'EXPIRED');
CREATE TYPE "RefundRequestStatus" AS ENUM ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'REJECTED', 'FAILED');
CREATE TYPE "RefundReason" AS ENUM ('DUPLICATE_CHARGE', 'INCORRECT_CHARGE', 'SERVICE_FAILURE', 'UNAUTHORIZED_PAYMENT', 'OTHER');

ALTER TABLE "users"
ADD COLUMN "interactive_login_allowed" BOOLEAN NOT NULL DEFAULT true;

UPDATE "users"
SET "interactive_login_allowed" = false,
    "password_hash" = NULL,
    "email_verified_at" = NULL
WHERE "normalized_email" LIKE '%@staff.waflo.invalid';

ALTER TABLE "users"
ADD CONSTRAINT "users_staff_identity_login_barrier" CHECK (
  (("normalized_email" LIKE '%@staff.waflo.invalid') = (NOT "interactive_login_allowed"))
  AND (
    "interactive_login_allowed"
    OR ("password_hash" IS NULL AND "email_verified_at" IS NULL)
  )
);

ALTER TABLE "organization_billing_profiles"
ADD COLUMN "selected_cadence" "BillingCadence" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN "billing_name" VARCHAR(160),
ADD COLUMN "billing_email" VARCHAR(254),
ADD COLUMN "billing_country_code" CHAR(2),
ADD COLUMN "billing_address_line_1" VARCHAR(200),
ADD COLUMN "billing_address_line_2" VARCHAR(200),
ADD COLUMN "billing_city" VARCHAR(120),
ADD COLUMN "billing_region" VARCHAR(120),
ADD COLUMN "billing_postal_code" VARCHAR(40),
ADD COLUMN "stripe_identity_synced_at" TIMESTAMPTZ(6);

ALTER TABLE "subscriptions"
ADD COLUMN "cadence" "BillingCadence" NOT NULL DEFAULT 'MONTHLY';

UPDATE "locations"
SET "country_code" = UPPER(BTRIM("country_code"))
WHERE "country_code" IS NOT NULL;

ALTER TABLE "locations"
ADD CONSTRAINT "locations_country_code_iso_shape" CHECK (
  "country_code" IS NULL OR "country_code" ~ '^[A-Z]{2}$'
);

ALTER TABLE "organization_billing_profiles"
ADD CONSTRAINT "billing_profiles_country_code_iso_shape" CHECK (
  "billing_country_code" IS NULL OR "billing_country_code" ~ '^[A-Z]{2}$'
);

CREATE TABLE "billing_invoices" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "stripe_invoice_id" VARCHAR(255) NOT NULL,
  "stripe_subscription_id" VARCHAR(255),
  "stripe_payment_method_id" VARCHAR(255),
  "invoice_number" VARCHAR(120),
  "status" VARCHAR(40) NOT NULL,
  "billing_reason" VARCHAR(80),
  "amount_due" INTEGER NOT NULL,
  "amount_paid" INTEGER NOT NULL,
  "amount_remaining" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "invoice_date" TIMESTAMPTZ(6) NOT NULL,
  "period_start" TIMESTAMPTZ(6),
  "period_end" TIMESTAMPTZ(6),
  "next_payment_attempt_at" TIMESTAMPTZ(6),
  "hosted_invoice_url" TEXT,
  "invoice_pdf_url" TEXT,
  "customer_name" VARCHAR(160),
  "customer_email" VARCHAR(254),
  "payment_method_brand" VARCHAR(40),
  "payment_method_last4" CHAR(4),
  "payment_method_exp_month" INTEGER,
  "payment_method_exp_year" INTEGER,
  "first_failed_at" TIMESTAMPTZ(6),
  "grace_ends_at" TIMESTAMPTZ(6),
  "failure_category" VARCHAR(80),
  "recovery_status" "BillingRecoveryStatus" NOT NULL DEFAULT 'NONE',
  "automatic_retry_eligible" BOOLEAN NOT NULL DEFAULT false,
  "next_recovery_attempt_at" TIMESTAMPTZ(6),
  "recovery_attempt_count" INTEGER NOT NULL DEFAULT 0,
  "recovery_attempt_token" VARCHAR(255),
  "recovery_lease_owner" VARCHAR(120),
  "recovery_lease_expires_at" TIMESTAMPTZ(6),
  "recovery_failure_code" VARCHAR(120),
  "paid_at" TIMESTAMPTZ(6),
  "last_stripe_event_at" TIMESTAMPTZ(6),
  "last_stripe_event_id" VARCHAR(255),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_email_outbox" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "billing_invoice_id" UUID,
  "kind" VARCHAR(80) NOT NULL,
  "dedupe_key" VARCHAR(255) NOT NULL,
  "recipient_email" VARCHAR(254) NOT NULL,
  "locale" "Locale" NOT NULL DEFAULT 'EN',
  "payload" JSONB NOT NULL,
  "status" "BillingEmailStatus" NOT NULL DEFAULT 'PENDING',
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "lease_owner" VARCHAR(120),
  "lease_expires_at" TIMESTAMPTZ(6),
  "sent_at" TIMESTAMPTZ(6),
  "last_failure_code" VARCHAR(120),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "billing_email_outbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_refund_requests" (
  "id" UUID NOT NULL,
  "public_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "billing_invoice_id" UUID NOT NULL,
  "requested_by_user_id" UUID NOT NULL,
  "reviewed_by_user_id" UUID,
  "status" "RefundRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  "reason" "RefundReason" NOT NULL,
  "explanation" VARCHAR(2000),
  "review_note" VARCHAR(2000),
  "requested_amount" INTEGER NOT NULL,
  "approved_amount" INTEGER,
  "currency" CHAR(3) NOT NULL,
  "idempotency_key" VARCHAR(255) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "stripe_refund_id" VARCHAR(255),
  "stripe_payment_intent_id" VARCHAR(255),
  "provider_status" VARCHAR(40),
  "execution_idempotency_key" VARCHAR(255) NOT NULL,
  "execution_lease_owner" VARCHAR(120),
  "execution_lease_expires_at" TIMESTAMPTZ(6),
  "execution_attempt_count" INTEGER NOT NULL DEFAULT 0,
  "failure_code" VARCHAR(120),
  "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMPTZ(6),
  "processing_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "last_stripe_event_at" TIMESTAMPTZ(6),
  "last_stripe_event_id" VARCHAR(255),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "billing_refund_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_refund_amounts_positive" CHECK (
    "requested_amount" > 0 AND ("approved_amount" IS NULL OR "approved_amount" > 0)
  )
);

CREATE UNIQUE INDEX "billing_invoices_stripe_invoice_id_key" ON "billing_invoices"("stripe_invoice_id");
CREATE INDEX "billing_invoices_organization_id_invoice_date_idx" ON "billing_invoices"("organization_id", "invoice_date" DESC);
CREATE INDEX "billing_invoice_recovery_due_idx" ON "billing_invoices"("recovery_status", "next_recovery_attempt_at", "recovery_lease_expires_at");
CREATE UNIQUE INDEX "billing_email_outbox_dedupe_key_key" ON "billing_email_outbox"("dedupe_key");
CREATE INDEX "billing_email_delivery_due_idx" ON "billing_email_outbox"("status", "available_at", "lease_expires_at");
CREATE INDEX "billing_email_outbox_organization_id_created_at_idx" ON "billing_email_outbox"("organization_id", "created_at" DESC);
CREATE UNIQUE INDEX "billing_refund_requests_public_id_key" ON "billing_refund_requests"("public_id");
CREATE UNIQUE INDEX "billing_refund_requests_stripe_refund_id_key" ON "billing_refund_requests"("stripe_refund_id");
CREATE UNIQUE INDEX "billing_refund_requests_execution_idempotency_key_key" ON "billing_refund_requests"("execution_idempotency_key");
CREATE UNIQUE INDEX "billing_refund_requests_organization_id_idempotency_key_key" ON "billing_refund_requests"("organization_id", "idempotency_key");
CREATE UNIQUE INDEX "billing_refund_one_active_request_per_invoice" ON "billing_refund_requests"("billing_invoice_id")
WHERE "status" IN ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING');
CREATE INDEX "billing_refund_requests_organization_id_created_at_idx" ON "billing_refund_requests"("organization_id", "created_at" DESC);
CREATE INDEX "billing_refund_requests_billing_invoice_id_status_idx" ON "billing_refund_requests"("billing_invoice_id", "status");
CREATE INDEX "billing_refund_requests_status_execution_lease_expires_at_idx" ON "billing_refund_requests"("status", "execution_lease_expires_at");

ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_email_outbox" ADD CONSTRAINT "billing_email_outbox_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_email_outbox" ADD CONSTRAINT "billing_email_outbox_billing_invoice_id_fkey"
FOREIGN KEY ("billing_invoice_id") REFERENCES "billing_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing_refund_requests" ADD CONSTRAINT "billing_refund_requests_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_refund_requests" ADD CONSTRAINT "billing_refund_requests_billing_invoice_id_fkey"
FOREIGN KEY ("billing_invoice_id") REFERENCES "billing_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_refund_requests" ADD CONSTRAINT "billing_refund_requests_requested_by_user_id_fkey"
FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_refund_requests" ADD CONSTRAINT "billing_refund_requests_reviewed_by_user_id_fkey"
FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE FUNCTION waflo_reject_synthetic_staff_interactive_auth() RETURNS trigger AS $$
DECLARE target_user_id UUID;
BEGIN
  target_user_id := NEW.user_id;
  IF EXISTS (
    SELECT 1 FROM "users"
    WHERE "id" = target_user_id AND NOT "interactive_login_allowed"
  ) THEN
    RAISE EXCEPTION 'synthetic staff identities cannot use interactive authentication';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sessions_reject_synthetic_staff" BEFORE INSERT OR UPDATE ON "sessions"
FOR EACH ROW EXECUTE FUNCTION waflo_reject_synthetic_staff_interactive_auth();
CREATE TRIGGER "external_identities_reject_synthetic_staff" BEFORE INSERT OR UPDATE ON "external_identities"
FOR EACH ROW EXECUTE FUNCTION waflo_reject_synthetic_staff_interactive_auth();
CREATE TRIGGER "email_verification_tokens_reject_synthetic_staff" BEFORE INSERT OR UPDATE ON "email_verification_tokens"
FOR EACH ROW EXECUTE FUNCTION waflo_reject_synthetic_staff_interactive_auth();
CREATE TRIGGER "password_reset_tokens_reject_synthetic_staff" BEFORE INSERT OR UPDATE ON "password_reset_tokens"
FOR EACH ROW EXECUTE FUNCTION waflo_reject_synthetic_staff_interactive_auth();
