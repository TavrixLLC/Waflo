# Membership credential security

Membership QR credentials combine a random public credential ID with a secret derived under a versioned HMAC key. The raw secret is not stored. Verification uses a timing-safe comparison and checks active status, Membership state, tenant, and replacement identity.

Transfer creates a new credential version and marks the old credential transferred. Old customer sessions are revoked and old provider identities are invalidated. A database partial unique index prevents more than one active credential for a Membership.
