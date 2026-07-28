# Stripe Same-Second Events

Freshness is now strictly older-only:

```text
if event.created < lastApplied.created: ignored_stale
else: apply authoritative current provider state
```

A different event ID in the same second is not stale. The same event ID remains deduplicated by `ProcessedWebhookEvent`.

Coverage: `tests/concurrency/stripe-event-ordering.test.ts` — `applies a different event ID in the same created second using the new provider state`, plus the existing strictly older stale-event tests.
