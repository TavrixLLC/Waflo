# Ledger hash integrity

Canonical v1 payloads are HMAC-SHA-256 chained per Membership from a locked genesis hash. The
active secret version is stored per entry; old versions remain verifiable after rotation.
Unit tests cover valid chains and tampering. The worker performs bounded integrity sampling and
creates a critical risk signal on mismatch.

