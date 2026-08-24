# Apple Wallet

The Apple adapter maps a Membership to a Store Card pass with Waflo-owned serial identity, `passTypeIdentifier`, `teamIdentifier`, organization name, localized fields, one static opaque membership QR code, web-service URL, and derived authentication token. The front is intentionally limited to Apple-native merchant identity, a 375:123 strip containing the selected stamp composition plus concise localized reward copy, the native program field, and the native QR. The strip uses the card background with no inset panel so the artwork reads as part of one surface. Numeric progress, customer identity, and front-facing status are omitted; full reward details and status remain on the pass back. Apple owns the final type metrics and field spacing, and Apple Watch can omit strip artwork.

Packaging creates `pass.json`, required images, localization files, SHA-1 manifest entries, and a detached PKCS#7 signature. Test Adapter signing is deterministic and visibly non-production. Real mode loads the pass certificate and WWDR chain and is blocked unless production configuration is complete.

Transferred old passes are regenerated with `voided=true`; a new credential receives a new serial number and authentication token. Private pass downloads require the host-bound customer session and return `application/vnd.apple.pkpass`.

The merchant dashboard preview mirrors this Store Card contract and the actual strip aspect ratio, but labels provider-owned geometry honestly instead of promising device-pixel parity.

Official sources consulted on 2026-08-24:

- [Apple Wallet Passes](https://developer.apple.com/documentation/walletpasses)
- [Creating the source for a pass](https://developer.apple.com/documentation/walletpasses/creating-the-source-for-a-pass)
- [Creating a Store Card pass](https://developer.apple.com/documentation/walletpasses/creating-a-store-card-pass)
- [Creating a pass with Pass Designer](https://developer.apple.com/documentation/walletpasses/creating-a-pass-with-pass-designer)
- [Building a pass](https://developer.apple.com/documentation/walletpasses/building-a-pass)
- [Apple Wallet Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/wallet)
