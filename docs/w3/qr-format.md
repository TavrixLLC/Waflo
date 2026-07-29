# QR format

Enrollment QR codes contain only the canonical public join URL. They are available as PNG and SVG with bounded dimensions and deterministic content suitable for caching.

Membership QR payloads use the versioned form `wfl1.<publicCredentialId>.<secret>`. They contain no customer name, email, Membership public ID, balance, or tenant database ID. Parsing rejects unsupported versions and malformed components.

Transfer supports direct camera decoding when the browser provides `BarcodeDetector`, plus PNG/JPEG/WebP image upload. Server-side decoding enforces file-count, MIME, byte, and pixel limits and processes bytes in memory without persistence.

Credential validity is always server-authoritative. A copied QR stops working after transfer, revocation, expiry, membership suspension, or tenant mismatch.
