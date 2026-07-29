# Waflo W3 overview

W3 adds customer enrollment, memberships, private web cards, revocable membership QR credentials, Apple Wallet, Google Wallet, and secure card transfer without changing the approved W1/W2 authorization, billing, publication, or two-state stamp-grid rules.

The NestJS API is the authoritative domain boundary. Public enrollment creates a Customer, optional encrypted CustomerContact, consent records, a version-pinned Membership, a zeroed MembershipProgressProjection, one active MembershipCredential, and a host-bound MembershipAccessSession in one transaction. Wallet work is committed to an outbox and completed asynchronously.

The customer experience lives on merchant hosts. A customer can discover published programs, enroll in English or Arabic, view a private card, download a ready Apple pass, start a Google save action, and transfer a card. W3 does not add customer accounts or passwords.

Production provider modes fail closed unless real credentials and HTTPS URLs pass configuration validation. Test adapters are deterministic, visibly labeled, and rejected when `NODE_ENV=production`.

Real Apple device certification and Google issuer certification remain credential-gated and are recorded as pending in [external-certification.md](external-certification.md).
