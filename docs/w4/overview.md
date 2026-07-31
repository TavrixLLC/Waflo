# W4 real loyalty operations

W4 makes the append-only loyalty ledger the authority for production stamp programs. A
Membership remains pinned to its enrollment Program Version; the mutable progress row is only a
projection of committed events.

The delivered boundaries are:

- `@waflo/loyalty-ledger`: canonical events, HMAC chain, reducer, rebuild, reversal rules.
- `@waflo/loyalty-policy`: operational eligibility, daily cap, purchase and reward rules.
- `@waflo/staff-device-security`: pairing, key normalization, signed envelopes and replay checks.
- `@waflo/operational-analytics`: aggregate reducers and formula-safe CSV schemas.
- API modules for signed Staff operations and merchant operations.
- `@waflo/operational-worker` for expiry, aggregates, exports, privacy, integrity and cleanup.

W4 does not add Flutter, offline operation, NFC, Smart Tap, POS integration, points, cashback, a
public merchant API, or campaigns.

