# Staff request signing

Sensitive Staff routes require both an opaque `Device` session token and an Ed25519 signature.
The canonical v1 envelope contains method, path without query, request ID, ISO timestamp, nonce,
SHA-256 body digest, device-session ID and Organization ID, separated by newlines.

The server checks compromised device, revoked device, inactive member, revoked session, expired
session, platform minimum app version, generic eligibility, production Test Client policy, clock
skew, body digest and signature in that order, then inserts `(device, nonce)` before the handler
runs. Duplicate nonces return a conflict. A retry uses the same operation idempotency key but a new
request nonce.

Mobile-safe state codes are `STAFF_DEVICE_COMPROMISED`, `STAFF_DEVICE_REVOKED`,
`STAFF_DEVICE_MEMBER_INACTIVE`, `STAFF_DEVICE_SESSION_EXPIRED`, and the canonical M2 code
`STAFF_APP_VERSION_UNSUPPORTED`. Revoked sessions and unknown or otherwise ineligible records keep
`STAFF_DEVICE_NOT_ACTIVE`. Revocation reasons are never returned in a mobile error. Each state maps
to a bounded audit event and a deduplicated risk rule without exposing the reason.

Signature, nonce, tokens, QR values and raw body secrets are redacted from logs.
