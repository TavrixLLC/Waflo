# Checkout Concurrency

The local `checkout_idempotency_keys` unique constraint remains the single command record. Concurrent callers may both receive the same Stripe session before either local insert commits. The losing insert now catches only Prisma `P2002`, reads the winning row, verifies the plan, and returns the winning URL and session ID. A mismatched plan returns `CHECKOUT_IDEMPOTENCY_KEY_CONFLICT` with HTTP 409. Stripe's provider idempotency key remains enabled.

Coverage:

- `tests/concurrency/stripe-checkout-idempotency.test.ts` requires both concurrent promises to fulfill, both non-null values to match, and exactly one row.
- `tests/http/boundary.test.ts` performs the same replay through two real Fastify HTTP requests.
