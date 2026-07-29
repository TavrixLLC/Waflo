# ADR 0026: Google Class per Program Version

Google uses one deterministic LoyaltyClass per published Program Version and one LoyaltyObject per MembershipCredential.

The Class preserves immutable Program economics and presentation. Transfer creates a new Object and makes the old Object inactive, preventing an old Wallet artifact from becoming the new bearer credential.
