# Authoritative ledger

`loyalty_ledger_entries` is the production source of truth. Every entry carries tenant,
Membership, pinned Program Version, actor, Location, command, operational day, sequence and hash
context. PostgreSQL rejects UPDATE and DELETE.

Commands are unique by Organization and idempotency key. Compatible completed commands replay
their stored result. A reused key with another fingerprint is a conflict. Membership advisory
locks serialize sequence allocation and projection changes.

Reversals and corrections append compensating events. They never edit history. See
[projection.md](./projection.md), [ledger-hash-chain.md](./ledger-hash-chain.md), and
[reversals.md](./reversals.md).

