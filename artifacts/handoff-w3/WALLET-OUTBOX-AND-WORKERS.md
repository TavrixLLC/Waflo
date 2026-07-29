# Wallet outbox and workers

Enrollment and transfer commit provider-neutral `WalletCommand` rows. The worker dispatches due IDs through Redis, conditionally claims a typed Prisma row, holds a lease, and invokes one provider adapter.

Temporary/rate-limit/unavailable errors retry with exponential backoff and jitter. Permanent errors dead-letter. Unique identities and provider idempotency keys make duplicate delivery safe. Reconciliation repairs missing provider state.

Structured logs contain only safe IDs, provider, command type, normalized category, attempt, and duration.
