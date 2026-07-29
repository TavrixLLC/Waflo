# ADR 0028: Transfer creates new provider identity

Card transfer rotates the MembershipCredential and creates new Apple and Google WalletPassInstance identities. Old instances enter invalidation and cannot be rebound.

This preserves a clean security boundary: old QR, session, Apple serial, and Google Object all refer to the transferred credential, while the new device receives distinct active identities.
