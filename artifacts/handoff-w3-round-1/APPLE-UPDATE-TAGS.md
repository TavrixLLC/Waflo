# Apple update tags

`packages/database/src/wallet-state-change.ts` is the central pass-state change path.

For each deterministic state-change idempotency key it takes an advisory lock and, in one transaction:

- increments the Apple `updateTag` exactly once;
- leaves Google without an Apple-only tag increment;
- marks `UPDATE_PENDING` or `INVALIDATION_PENDING`;
- creates the deterministic Wallet command;
- records a safe audit event.

Replaying the same event records replay behavior without incrementing the tag again. Program sync, transfer invalidation, and reconcile use this path. Worker status updates are conditional so concurrent issuance/update/reconcile cannot overwrite invalidation pending state.

Tests prove monotonic duplicate handling, updated serial queries, updated pass correspondence, transfer invalidation, and Program batch sync.

Apple's device update flow and update-tag query behavior follow the official [Adding a web service to update passes](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes) and [Getting the list of updatable passes](https://developer.apple.com/documentation/walletpasses/get-the-list-of-updatable-passes) documentation.
