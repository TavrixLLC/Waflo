# Membership credentials

Each credential has a random public ID and a monotonically increasing version. The QR secret is deterministically derived with HMAC-SHA-256 from the credential identity and a versioned server secret; only a verifier hash and secret version are persisted.

The QR is therefore reproducible for Wallet packaging while raw bearer material is not stored in the database. Verification uses timing-safe comparison and also checks tenant, Membership, credential status, and active-credential identity.

Transfer creates a new credential and new WalletPassInstance identities, marks the previous credential `TRANSFERRED`, links it through `replacedByCredentialId`, and revokes prior customer sessions. A partial unique database index enforces one active credential per Membership.

Static credentials are an intentional W3 boundary: they are opaque and revocable, and every future operational scan must validate server-side. Rotating barcodes are deferred.
