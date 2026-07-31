# Staff device pairing

Pairing QR sessions are one-time and expiring. Devices generate an Ed25519 key, submit only the
public key, sign a server challenge and receive opaque access/refresh credentials after an atomic
completion. Device installation and key identity are immutable. Revocation invalidates use
immediately.

