# Authoritative reward expiry

Reward expiry no longer performs a direct bulk entitlement update. Each due entitlement receives one
persisted `RewardExpiryCommand` carrying public ID, organization/program/membership/entitlement IDs,
idempotency key, request fingerprint, status, lease, attempt count, safe failure and timestamps.

The worker claims only a bounded page. Processing takes locks in this order: Organization, Program
lifecycle, Membership and expiry command. It then re-reads the entitlement and accepts only a due
milestone entitlement in an expirable state. A final reward is completed with the stable
`FINAL_REWARD_NON_EXPIRING` outcome and is never expired.

One transaction appends `REWARD_EXPIRED` to the authoritative Membership Ledger, reduces the
projection, marks the entitlement expired, coalesces one Wallet update, records `reward.expired` and
completes the command. Expiry and redemption share the Membership lock. A provider outage therefore
cannot roll back the business event; delivery remains in the Wallet outbox retry/dead-letter flow.

Focused concurrency proof covers two workers, replay, suspension, redemption, transfer, unique
Ledger sequence, single Wallet command and final-reward non-expiry. Failure proof covers provider
outage after the authoritative commit.

