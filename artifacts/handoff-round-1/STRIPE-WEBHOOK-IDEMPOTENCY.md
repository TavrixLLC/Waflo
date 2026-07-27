# Stripe Webhook Idempotency and Policy

## Claim and lease

- `(provider, externalEventId)` remains unique.
- First delivery creates a `PROCESSING` row with a two-minute lease.
- A concurrent delivery sees the active lease and returns as a duplicate.
- `FAILED`, lease-less, or lease-expired rows can be claimed atomically with `updateMany`.
- Attempt count increments only on re-claim.
- Before applying business state, the transaction verifies exact lease ownership.
- Business changes, audit entry, and `PROCESSED` transition commit in one invariant-locked transaction.
- Failure changes only the owned lease to `FAILED`, preserving safe retry.
- Subscription-status notifications run only after the business transaction commits.
- A downstream notification failure is recorded with recipient counts only; it cannot roll back or
  falsely fail an already-processed Stripe event.

## Validation

- Price IDs map only through configured Starter, Growth, and Scale price IDs.
- Metadata plans must be in the catalog and match the configured price.
- Stripe customer and organization metadata must resolve to the same billing profile.
- Unknown customers, unknown prices, invalid plans, and mismatches return stable errors.
- Period timestamps come from the supported subscription item fields.

## Downgrade policy

Stripe remains the subscription source of truth. If Stripe applies a lower plan while usage is over limit, Waflo:

1. preserves all existing resources;
2. updates the provider-backed plan and status;
3. records usage, limits, and `preserve_resources_and_block_new_capacity` in the audit entry;
4. blocks future capacity additions until usage is remediated.

Waflo never auto-archives locations or removes members during a webhook.

## Tests

`tests/concurrency/stripe-webhook.test.ts` covers concurrent duplicates, failed retry, expired lease
recovery, customer/organization mismatch, invalid plan, plan/price mismatch, unknown price, period
persistence, post-commit status notification, one audit application, and over-limit resource
preservation.
