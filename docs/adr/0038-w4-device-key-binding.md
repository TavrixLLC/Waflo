# ADR 0038: Device key binding

Status: Accepted

Pairing binds installation, member, Location set and Ed25519 public key. Sensitive requests need
an opaque session and canonical signature with timestamp, digest and nonce. Waflo never receives
the private key.

