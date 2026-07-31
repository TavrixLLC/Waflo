# Ledger hash chain

Each Membership has an independent sequence and HMAC-SHA-256 chain. The canonical v1 payload
includes every operational field that affects meaning, the prior hash, and the active hash-key
version. The genesis predecessor is a locked constant.

Integrity verification recomputes sequence continuity, predecessor links, and every entry hash.
The worker samples Memberships and raises a critical `LEDGER_INTEGRITY_MISMATCH` risk signal on
failure. Hash-secret rotation adds a version; it does not rewrite existing entries.

Never remove an old hash secret until all entries using its version have passed verification and
the retention decision has been approved.

