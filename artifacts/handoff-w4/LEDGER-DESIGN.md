# Ledger design

The production ledger is Membership-scoped, append-only and tenant-context checked. Each operation
uses a unique Organization idempotency key and request fingerprint. Ordered advisory locks cover
Organization/program lifecycle, Membership, command and device as appropriate.

Entries contain sequence, cycle, delta, reward/redemption/reversal references, pinned Version,
actor, Location, purchase metadata, operational day and HMAC chain. See `docs/w4/ledger.md`.

