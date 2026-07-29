# W3 concurrency invariants

The focused PostgreSQL suites are `tests/integration/w3-customer-wallet.test.ts` and `tests/concurrency/w3-customer-wallet.test.ts`.

## Enrollment and issuance

- Concurrent same-key/same-fingerprint enrollment returns 201/201 and one Customer, Membership, progress projection, and active credential.
- Same key/different fingerprint is a stable conflict.
- Different keys with only the same display name create distinct Customers by policy.
- Provider command leases ensure one provider call; expired leases recover; temporary failures retry; permanent failures dead-letter.
- Public image generation uses conditional object writes plus a database uniqueness winner; a cache hit performs no render/storage rewrite.

## Session, registration, transfer

- Customer session rotation is advisory-lock serialized; the old session has an explicit revoked/already-rotated outcome.
- Apple registration has one active device/pass pair, encrypted push-token replacement, replay-safe unregister, and reactivation.
- Equivalent simultaneous transfer completions both return compatible 201 success, with one active new credential, one transferred old credential, and one append-only event.
- Suspension/revocation/issuance races never yield more than one active credential or duplicate provider identity.

## Lifecycle

A 61-pass job with batch size 17 proves checkpoint, page replay, interruption/resume, one deterministic command per snapshot pass, one Apple tag increment, completion audit, and explicit exclusion of a post-snapshot pass.

Sanitized result files are under `evidence/`.
