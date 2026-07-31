# Durable operation idempotency

W4 operations claim their command in a short durable transaction before starting the domain
transaction. The row stores the request fingerprint, processing lease owner/expiry and attempt
count. The domain transaction may complete the Ledger/projection result, but a terminal error is
persisted afterward in a separate transaction so rollback cannot erase the failed claim.

The replay contract is:

| Stored state | Same fingerprint | Different fingerprint |
| --- | --- | --- |
| Completed | Return original result | `OPERATION_IDEMPOTENCY_CONFLICT` |
| Failed | Return the same stable failure | `OPERATION_IDEMPOTENCY_CONFLICT` |
| Processing, live lease | Stable processing response | `OPERATION_IDEMPOTENCY_CONFLICT` |
| Processing, expired lease | One claimant recovers it | `OPERATION_IDEMPOTENCY_CONFLICT` |

The policy applies to stamp, redeem, reverse, manual adjustment, Membership status, projection
rebuild and privacy commands. Approval consumption also requires exactly one conditional update.
Tests cover daily cap, currency, Location and approval failures, same/different payload replay,
crash recovery, concurrent retries and audit rollback.

