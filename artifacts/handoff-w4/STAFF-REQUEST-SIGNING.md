# Staff request signing

The v1 envelope signs method, path, request ID, timestamp, nonce, body SHA-256, session ID and
Organization ID. Server checks opaque session, active trust, timestamp, body, Ed25519 signature and
atomic nonce insertion. HTTP tests cover success, idempotent replay with a new nonce, nonce replay,
clock skew, digest mismatch and revocation.

