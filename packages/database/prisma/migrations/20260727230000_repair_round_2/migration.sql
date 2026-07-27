-- W1 Repair Round 2 migration
-- 1. Add IGNORED_STALE to WebhookProcessingStatus enum
ALTER TYPE "WebhookProcessingStatus" ADD VALUE IF NOT EXISTS 'IGNORED_STALE';

-- 2. Provider freshness metadata on subscriptions (prevents stale Stripe events overwriting newer state)
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "last_applied_stripe_event_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "last_applied_stripe_event_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "last_provider_sync_at" TIMESTAMPTZ(6);

-- 3. Checkout idempotency keys table
CREATE TABLE IF NOT EXISTS "checkout_idempotency_keys" (
  "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id"   UUID NOT NULL,
  "idempotency_key"   VARCHAR(255) NOT NULL,
  "plan_code"         VARCHAR(40) NOT NULL,
  "stripe_session_id" VARCHAR(255),
  "stripe_session_url" TEXT,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "checkout_idempotency_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "checkout_idempotency_keys_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "checkout_idempotency_keys_organization_id_idempotency_key_key"
  ON "checkout_idempotency_keys" ("organization_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "checkout_idempotency_keys_organization_id_created_at_idx"
  ON "checkout_idempotency_keys" ("organization_id", "created_at");

-- 4. The [status, leaseExpiresAt] index was already created physically by migration
-- 20260727190000_repair_round_1_invariants as processed_webhook_events_status_lease_expires_at_idx.
-- This migration does not re-create it; the declarative @@index is now reflected in schema.prisma.
-- Verify the index exists:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'processed_webhook_events'
--   AND indexname = 'processed_webhook_events_status_lease_expires_at_idx';
