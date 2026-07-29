# Customer data encryption

Email uses AES-256-GCM authenticated encryption with a random nonce and persisted key version. Normalized lookup uses HMAC-SHA-256 with a separate key. Customer-facing display uses a non-reversible mask.

The implementation supports multiple decrypt keys and an explicit active version so data can be re-encrypted during rotation. Plaintext email and ciphertext are excluded from public responses, audit metadata, structured logs, QR data, Wallet public assets, and screenshots.
