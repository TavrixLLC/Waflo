# Stripe Subscription Locking

After signature verification and event claim, supported subscription events retrieve the current Stripe subscription before opening the database transaction. Business-state application then runs under `stripe-subscription:<subscription-id>` with a transaction-scoped advisory lock. The exact processing lease is revalidated inside that transaction. Subscription, billing profile, organization plan, audit, and processed-event completion remain atomic. Provider retrieval failure marks the event retryable and applies no snapshot.

Different subscriptions use different advisory keys and can proceed independently. Notification delivery remains post-commit.

Coverage: `tests/concurrency/stripe-event-ordering.test.ts` lock serialization and independent-lock tests; `tests/concurrency/stripe-webhook.test.ts` and the ordering suite provider-failure/lease coverage.
