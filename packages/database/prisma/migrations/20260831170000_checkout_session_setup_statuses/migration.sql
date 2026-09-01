-- Checkout Elements setup sessions complete before the later onboarding
-- confirmation creates a trial subscription. Preserve historical command
-- states while permitting the explicit completion and identity-invalidation
-- states used by that two-step state machine.
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
    'SUBSCRIPTION_CREATED',
    'FAILED'
  )
);
