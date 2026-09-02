-- Restore the previously valid market-invalidation terminal state after the
-- Checkout Elements setup-status migration expanded the command state machine.
-- This is intentionally forward-only: a deployed Prisma migration must never
-- be edited after its checksum may have been recorded.
ALTER TABLE "checkout_idempotency_keys"
DROP CONSTRAINT IF EXISTS "checkout_onboarding_status_allowed";

ALTER TABLE "checkout_idempotency_keys"
ADD CONSTRAINT "checkout_onboarding_status_allowed" CHECK (
  "status" IN (
    'LEGACY_CHECKOUT',
    'SETUP_PENDING',
    'SETUP_SUCCEEDED',
    'SETUP_COMPLETED',
    'INVALIDATED',
    'MARKET_INVALIDATED',
    'SUBSCRIPTION_CREATED',
    'FAILED'
  )
);
