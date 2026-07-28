# Waflo W1 Repair Round 3 Compliance

Date: 2026-07-28
Scope: Checkout end-to-end idempotency and Stripe subscription serialization only

| Requirement | Implementation | Exact verification |
| --- | --- | --- |
| Billing sends a cryptographic Checkout command ID | `apps/merchant-dashboard/components/dashboard-screens.tsx` uses `crypto.randomUUID()` and sends `x-idempotency-key`; action ref suppresses double-clicks and retains uncertain retries | `tests/e2e/platform.spec.ts` — `sends a Checkout command ID, suppresses double clicks, and reuses uncertain retries` |
| Boundary validates command IDs | `apps/api/src/common/validation.ts` and `apps/api/src/billing/billing.controller.ts` require a trimmed UUID and reject missing, malformed, short, and overlong values | `tests/http/boundary.test.ts` — `validates Checkout command IDs at the HTTP boundary before Stripe access` |
| Same-key Checkout callers replay one result | `apps/api/src/billing/billing.service.ts` catches local `P2002`, reads the winning row, checks the plan, and replays its URL/session | `tests/concurrency/stripe-checkout-idempotency.test.ts` — concurrent same-key case; `tests/http/boundary.test.ts` — concurrent HTTP replay |
| Stripe subscription business state serializes by subscription | `apps/api/src/billing/billing.service.ts` retrieves provider state before the transaction and uses `stripe-subscription:<id>` for the invariant lock | `tests/concurrency/stripe-event-ordering.test.ts` — subscription lock serialization and independent locks |
| Same-second events remain authoritative | Freshness uses strict `<`; event ID still provides deduplication | `tests/concurrency/stripe-event-ordering.test.ts` — `applies a different event ID in the same created second using the new provider state` |
| Portal plan policy is explicit | Policy A: the configured Stripe Customer Portal must disable subscription price switching; API requires a configuration ID and still rejects metadata/price mismatch | `tests/http/boundary.test.ts` — Portal has no Checkout idempotency semantics; `STRIPE-PORTAL-PLAN-POLICY.md` |
| Fragment token regression remains covered | Verification, reset, and invitation links use `#token=`; clients clear fragments before async use | `tests/e2e/platform.spec.ts`, `TOKEN-FRAGMENT-REGRESSION.md`, token scan logs |
| Round 3 evidence is isolated | All new Playwright logs and screenshots are written under `artifacts/handoff-round-3/` | `PROCESS-CLEANUP.md` and raw output directory |

No W2 functionality was started.
