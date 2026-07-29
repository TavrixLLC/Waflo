# Wallet workers

`apps/wallet-worker` owns Wallet command dispatch, provider calls, retries, APNs notification work, asset rendering, and reconciliation. It exposes no customer HTTP routes.

The dispatcher moves due outbox IDs to Redis. Consumers claim commands with a conditional database update, establish a lease, and then reload the typed Prisma row. This prevents duplicate execution and safely recovers expired leases.

Commands use exponential backoff with jitter. Temporary, rate-limit, and provider-unavailable errors retry until the configured maximum; permanent validation/auth/signing failures dead-letter. Idempotency keys and unique provider identities make repeat execution safe.

The worker reconciles missing provider state rather than trusting queue delivery. Structured logs contain command IDs, provider, command type, normalized error category, and timing, but never PII, QR material, tokens, certificates, or provider credentials.
