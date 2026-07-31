# Central operation lock order

All repaired domain paths use PostgreSQL transaction advisory locks in this order:

1. Organization.
2. Program lifecycle.
3. Membership.
4. Command, operation or approval.
5. Device.
6. Wallet pass/provider sequence.

The order is applied to stamp, redeem, reverse, manual adjustment, Membership status changes,
projection rebuild, reward expiry, transfer confirmation and privacy erasure. Multi-Membership
privacy work sorts Memberships deterministically before locking them.

Reversal resolves the Program before locking, includes the Program lifecycle lock, revalidates
organization/billing/program/membership/credential/Location/device state and obeys the same policy
as the original earning or redemption operation. No implicit reversal bypass exists while Program
or billing state is blocked.

The 24-test W4 concurrency suite includes stamp vs redeem, redeem vs redeem, stamp and redeem vs
transfer, stamp vs Program pause, stamp vs Membership suspension, reverse vs archive/new stamp/
redemption, rebuild vs stamp, device revoke vs operation, expiry races, and erasure vs stamp/redeem/
transfer. Each asserts persisted database invariants and contiguous Ledger sequences.

