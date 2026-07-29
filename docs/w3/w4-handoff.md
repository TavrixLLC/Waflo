# W4 handoff

W3 supplies immutable Membership identity, version pinning, a zeroed progress projection, a revocable active credential, Wallet pass identities, and idempotent Wallet update commands.

W4 may add the authoritative loyalty ledger, real stamp issuance, reward redemption, staff authorization/scanning, reversal rules, and transactionally updated progress projections. It must continue using server-side credential validation and the exact two-state filled/empty grid.

W4 must not reinterpret `MembershipProgressProjection` as an event ledger. It should add ledger/event models and update the projection from committed events. It must preserve tenant guards, Program Version economics, idempotency, audit, billing, and transfer semantics.

No production stamp, redemption, staff scan, device-pairing, offline-operation, or Flutter implementation is included in W3.
