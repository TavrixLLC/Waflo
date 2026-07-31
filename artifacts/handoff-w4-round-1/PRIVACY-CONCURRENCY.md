# Privacy operation concurrency

Privacy requests have an idempotency key, request fingerprint, lease, attempt count, safe failure
and terminal timestamps. Same-key replay is stable and a different fingerprint conflicts.

Erasure first locks the request, then processes every affected Membership in deterministic order.
For each Membership it follows Organization → Program lifecycle → Membership before appending
`MEMBERSHIP_REVOKED`, revoking credentials/sessions, invalidating Wallet passes and recording audit.
Customer anonymization and final request completion occur only after every Membership is safe.

The Ledger remains immutable and contains no customer PII. The race suite proves erasure against
stamp, redemption and credential transfer: no active credential remains, Membership status is
`REVOKED`, Ledger sequence is contiguous and `MEMBERSHIP_REVOKED` is the final Membership event.
Export and erasure completion/failure/dead-letter paths also write consistent worker audit records.

