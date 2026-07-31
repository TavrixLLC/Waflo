# Merchant transaction-reference security

The configuration requires `MERCHANT_TRANSACTION_REFERENCE_HMAC_KEY_V1` and
`MERCHANT_TRANSACTION_REFERENCE_ACTIVE_KEY_VERSION`. References are NFKC-normalized, trimmed,
internal whitespace is collapsed, case is normalized and length is bounded to 1–160 characters.

The stored value is HMAC-SHA-256 over a versioned domain separator and normalized reference. The
Ledger stores only the digest, key version and normalization version; the raw reference is not
stored. The original v1 Ledger hash canonicalization intentionally omits the new optional metadata
so existing chains remain verifiable, while newly generated entries carry the versioned fields.

Duplicate detection is scoped to the same Organization, Program and Location within the configured
time window. A duplicate creates a safe `DUPLICATE_TRANSACTION_REFERENCE` risk signal and hard
block. Tests cover normalization, bounded input, duplicate behavior, secret-key separation and key
rotation/version retention.

