# ADR 0016: Merchant-upload format policy

W2 accepts PNG, JPEG, and WebP with signature checks. SVG, external images, and unbounded payloads are rejected to reduce parser and stored-XSS risk.
