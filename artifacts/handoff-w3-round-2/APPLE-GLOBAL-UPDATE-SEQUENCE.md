# Apple global update sequence

## Storage and allocation

Migration `20260729213000_w3_round2_apple_update_sequence` creates
`apple_pass_update_sequence AS BIGINT`, adds
`wallet_pass_instances.apple_update_sequence BIGINT`, backfills existing Apple passes in
stable creation order, and indexes `(provider, apple_update_sequence)`.

A database trigger assigns a sequence to every newly inserted Apple pass. A check
constraint requires Apple rows to have a sequence and non-Apple rows to have none.

Apple-visible UPDATE, INVALIDATE, and RECONCILE orchestration acquires the global
`apple-pass-update-sequence` PostgreSQL advisory lock before the per-pass state lock.
The sequence is allocated only after confirming the deterministic Wallet command does
not already exist. Thus:

- commit order and sequence order agree;
- concurrent updates to different Apple passes receive distinct values;
- duplicate command replay returns the original command and allocates no value;
- Google commands do not consume the Apple sequence;
- transfer invalidation receives a later sequence;
- APNs push idempotency is keyed by the global sequence.

The legacy per-pass `updateTag` remains temporarily for migration compatibility, but the
Apple web service and push orchestration no longer use it as the collection cursor.
All API and audit serialization converts the `BIGINT` to a decimal string, avoiding
JavaScript number precision loss.

## Updated serials

An absent or empty `passesUpdatedSince` is treated as `0`, so the initial request
returns all registered Apple passes. A supplied value must be decimal digits in the
range `0..9223372036854775807`; malformed, signed, negative, or overflowing values
receive HTTP 400 with `APPLE_UPDATE_TAG_INVALID`.

The endpoint selects every active registration whose pass has
`appleUpdateSequence > passesUpdatedSince`, orders it by that sequence, and returns the
latest value as the decimal-string `lastUpdated`. There is no fixed `take: 500` cap.

## Conformance basis

This follows Apple's documented collection-cursor contract: the client supplies its
previous `lastUpdated` value and the service returns serial numbers changed since that
tag plus a developer-defined new tag.

- <https://developer.apple.com/documentation/walletpasses/get-the-list-of-updatable-passes>
- <https://developer.apple.com/documentation/walletpasses/serialnumbers>
- <https://developer.apple.com/documentation/WalletPasses/adding-a-web-service-to-update-passes>

Focused PostgreSQL evidence is in
`raw-test-output/w3-round2-focused-concurrency.txt`. It proves the interleaved
A-then-B poll, duplicate A replay, concurrent distinct values, transfer invalidation,
malformed/overflow rejection, and 502 updated registered passes without omission.

