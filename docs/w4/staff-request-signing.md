# Staff request signing

Sensitive Staff routes require both an opaque `Device` session token and an Ed25519 signature.
The canonical v1 envelope contains method, path without query, request ID, ISO timestamp, nonce,
SHA-256 body digest, device-session ID and Organization ID, separated by newlines.

The server checks the session, device/member status, production Test Client policy, clock skew,
body digest and signature, then inserts `(device, nonce)` before the handler runs. Duplicate
nonces return a conflict. A retry uses the same operation idempotency key but a new request nonce.

Signature, nonce, tokens, QR values and raw body secrets are redacted from logs.

