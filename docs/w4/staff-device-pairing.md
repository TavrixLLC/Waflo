# Staff device pairing

An Owner, or a Manager within the Staff-only delegation rule, creates a short-lived one-time
pairing QR for an active Staff member and allowed Locations. The device generates an Ed25519 key
pair and submits only its public key and bounded device metadata.

The server issues a deterministic challenge bound to pairing ID, installation ID and public key.
Completion verifies the Ed25519 signature, creates the device and opaque session, and consumes the
pairing session atomically. Installation identity and public key cannot be reassigned.

`POST /v1/staff/devices/pairing/challenge` is the official recovery path when claim succeeded but
the claim response was lost or ambiguous. It is rate-limited and returns only the still-active,
unexpired claimed challenge bound to the claimed installation and public key. Repeated recovery
returns the same challenge and never returns the one-time pairing secret, QR payload,
Organization, or Staff information. Unknown, expired, completed, and otherwise unavailable public
IDs share the same safe unavailable response. Recovery and completion take the same pairing lock;
completion remains single-use. Every successful recovery writes
`device.pairing_challenge_recovered` with safe pairing metadata to the Organization audit log.

iOS and Android claims must carry a strict semantic `appVersion`. Claims below the configured
platform minimum return `STAFF_APP_VERSION_UNSUPPORTED`; completion rechecks the policy so a
policy increase between claim and completion cannot activate an unsupported app. The development
Test Client keeps the existing M2 exemption from semantic-version enforcement.

Revocation marks the device and all sessions unusable immediately. The development Test Client is
rejected in production.
