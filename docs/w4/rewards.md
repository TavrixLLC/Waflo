# Reward entitlements

Crossing a configured threshold appends an unlock event and creates one entitlement identified by
Membership, cycle and Reward Definition. A unique database key prevents duplicate unlocking under
concurrency.

Milestone entitlements appear outside the two-state stamp grid and do not reset progress. They may
allow multiple redemptions when the pinned definition permits it. The final threshold equals the
stamp goal, allows exactly one redemption and never expires.

Additional stamps are rejected while the final entitlement is ready.

