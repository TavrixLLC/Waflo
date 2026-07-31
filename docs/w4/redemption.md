# Redemption and cycle reset

Redemption locks the Membership and entitlement, verifies Location permissions, expiry,
redemption count and any manager-approval requirement, then appends `REWARD_REDEEMED`.

A milestone redemption changes only entitlement state. A final redemption additionally appends
`CYCLE_RESET`; only then does current progress become zero, completed cycles increment, and the
main grid return to all empty. Before that commit, an 8/8 card stays fully filled.

Duplicate redemption is prevented by locked state, entitlement sequence constraints and command
idempotency.

