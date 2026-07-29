# Google Wallet implementation

Google uses one deterministic LoyaltyClass per Program Version and one LoyaltyObject per Membership credential. Insert/get/patch behavior is idempotent, including already-existing reconciliation.

The signed save JWT references the provider object, validates origins, and does not embed the QR secret. Transfer makes the old object inactive and creates a distinct object for the new credential. Public images use random immutable Waflo asset tokens.

Official sources and access date are recorded in [../../docs/w3/google-wallet.md](../../docs/w3/google-wallet.md).
