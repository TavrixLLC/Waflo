# Typed W4 risk engine

`evaluateRiskRules()` returns `{ hardBlock, errorCode, signals[] }`. Every signal has rule code,
severity, score, rule version `w4r1-v1`, safe evidence and an optional stable block code.

Implemented rules cover invalid/revoked/compromised devices, signature failure, nonce replay, clock
skew, wrong Location, device and Staff velocity, many Memberships, repeated same-Membership activity,
immediate stamp/redemption, high reversal rate, repeated manager overrides, daily-cap and purchase
overrides, duplicate transaction reference, transferred/revoked credentials, suspended Membership,
billing block, projection drift and Ledger hash failure.

Reviewable signals use a time-windowed SHA-256 deduplication key unique within the organization.
Stored evidence contains counts, limits, booleans and safe identifiers only—never QR payloads,
nonces, signatures, raw transaction references or customer PII. Signals retain operation, device,
Membership and Location links when available and create audit evidence. Security rules are not
disabled by plan tier.

