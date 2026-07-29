# Apple Wallet

The Apple adapter maps a Membership to a Store Card pass with Waflo-owned serial identity, `passTypeIdentifier`, `teamIdentifier`, organization name, localized fields, a static opaque membership barcode, web-service URL, and derived authentication token. The stamp grid continues to use only filled and empty artwork.

Packaging creates `pass.json`, required images, localization files, SHA-1 manifest entries, and a detached PKCS#7 signature. Test Adapter signing is deterministic and visibly non-production. Real mode loads the pass certificate and WWDR chain and is blocked unless production configuration is complete.

Transferred old passes are regenerated with `voided=true`; a new credential receives a new serial number and authentication token. Private pass downloads require the host-bound customer session and return `application/vnd.apple.pkpass`.

Official sources consulted on 2026-07-29:

- [Apple Wallet Passes](https://developer.apple.com/documentation/walletpasses)
- [Creating the source for a pass](https://developer.apple.com/documentation/walletpasses/creating-the-source-for-a-pass)
- [Building a pass](https://developer.apple.com/documentation/walletpasses/building-a-pass)
- [Apple Wallet Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/wallet)
