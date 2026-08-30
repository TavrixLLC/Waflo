-- A country change invalidates any incomplete Checkout setup so a stale
-- payment method cannot be confirmed against a different canonical market.
ALTER TABLE "checkout_idempotency_keys"
DROP CONSTRAINT "checkout_onboarding_status_allowed";

ALTER TABLE "checkout_idempotency_keys"
ADD CONSTRAINT "checkout_onboarding_status_allowed" CHECK (
  "status" IN (
    'LEGACY_CHECKOUT',
    'SETUP_PENDING',
    'SETUP_SUCCEEDED',
    'MARKET_INVALIDATED',
    'SUBSCRIPTION_CREATED',
    'FAILED'
  )
);
