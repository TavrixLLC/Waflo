# Apple Wallet implementation

The Apple adapter creates a localized Store Card pass, valid assets, opaque barcode, Waflo serial identity, web-service URL, and derived authentication token. Packaging includes `pass.json`, images, localization, SHA-1 manifest entries, and a detached PKCS#7 signature boundary.

Test Adapter output is deterministic and clearly non-production. Real mode validates certificate, WWDR, identifiers, HTTPS update URL, and auth-secret configuration. Transfer gives the new credential a new serial and renders the old pass `voided=true`.

Official sources and access date are recorded in [../../docs/w3/apple-wallet.md](../../docs/w3/apple-wallet.md).
