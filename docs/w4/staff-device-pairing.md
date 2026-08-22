# Staff device pairing

An Owner, or a Manager within the Staff-only delegation rule, creates a short-lived one-time
pairing QR for an active Staff member and allowed Locations. The device generates an Ed25519 key
pair and submits only its public key and bounded device metadata.

The server issues a deterministic challenge bound to pairing ID, installation ID and public key.
Completion verifies the Ed25519 signature, creates the device and opaque session, and consumes the
pairing session atomically. Installation identity and public key cannot be reassigned.

Revocation marks the device and all sessions unusable immediately. The development Test Client is
rejected in production.

Pairing creation, claim, and proof completion each revalidate the Staff user's active state, the
organization Membership, every active Location, and every Staff Location assignment. Provisioning
is available only through the Merchant assignment endpoints documented in
`location-authorization.md`; a Mobile device cannot create its own authority.

Every authenticated or signed Device request performs a DB-backed current-state check at the
shared authentication boundary. Operational access requires an active Staff user, active
organization Membership, active device, unrevoked/unexpired session, active Location, active Staff
Location assignment, and active device Location assignment. Refresh performs the same lifecycle
checks. The distinguishable denial codes are `STAFF_USER_DEACTIVATED`,
`STAFF_MEMBERSHIP_INACTIVE`, `STAFF_DEVICE_REVOKED`, and
`STAFF_LOCATION_ASSIGNMENT_INVALID`.

User deactivation, organization Membership suspension/removal, and Staff Location assignment
revocation explicitly revoke affected device sessions, cancel unfinished pairings, and expire
pending/approved manager approvals in the same lifecycle transaction. Device revocation also
revokes its sessions and expires its approvals. History is retained; neither refresh nor pairing
silently reactivates an identity.
