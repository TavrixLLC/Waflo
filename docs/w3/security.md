# W3 security

Customer contacts use versioned AES-256-GCM authenticated encryption and a separate HMAC lookup key. Session, transfer, pass-auth, and credential secrets have separate purposes and version domains.

Public identifiers are random and non-authorizing. Private card access requires an HttpOnly, host-bound customer session tied to the active credential. Membership QR authorization requires the derived bearer secret and server-side status validation.

Enrollment and transfer have rate limits, strict schema validation, bounded idempotency, neutral unavailable responses, and stable error envelopes. Transfer upload accepts one bounded image, decodes it in memory, and does not retain it.

Logs, audits, screenshots, provider health, and outbox safe payloads exclude plaintext email, ciphertext, QR payloads, transfer tokens, session tokens, push tokens, certificates, private keys, and service-account material.

Production startup rejects Test Adapters, unsafe placeholder secrets, non-HTTPS provider URLs, and incomplete real-provider configuration.
