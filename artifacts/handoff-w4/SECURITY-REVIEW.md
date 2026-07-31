# Security review

W4 preserves merchant/customer CSRF and tenancy while adding Ed25519 request binding, opaque
sessions, timestamp and nonce enforcement, one-time pairing, Location authority, database
append-only guards and log redaction. Production rejects Test Client and unsafe operational
secrets. No payment-card data, receipt, raw QR or device private key is stored.

