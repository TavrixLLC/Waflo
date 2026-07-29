# ADR 0024: Customer contact encryption

Customer email is encrypted with versioned AES-256-GCM. Lookup uses a separate normalized-email HMAC, and display uses a stored mask.

Encryption, lookup, and credential keys remain purpose-separated. This permits key rotation and duplicate lookup without plaintext email or deterministic ciphertext.
