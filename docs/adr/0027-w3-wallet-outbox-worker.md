# ADR 0027: Wallet outbox and worker

Membership validity must not depend on provider availability. Enrollment and transfer commit WalletCommand outbox rows with the domain transaction, then a separate worker performs provider operations.

Conditional claims, leases, idempotency keys, bounded retry, dead-letter status, and reconciliation make delivery recoverable without holding database transactions across provider calls.
