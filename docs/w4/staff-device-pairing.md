# Staff device pairing

An Owner, or a Manager within the Staff-only delegation rule, creates a short-lived one-time
pairing QR for an active Staff member and allowed Locations. The device generates an Ed25519 key
pair and submits only its public key and bounded device metadata.

The server issues a deterministic challenge bound to pairing ID, installation ID and public key.
Completion verifies the Ed25519 signature, creates the device and opaque session, and consumes the
pairing session atomically. Installation identity and public key cannot be reassigned.

Revocation marks the device and all sessions unusable immediately. The development Test Client is
rejected in production.

