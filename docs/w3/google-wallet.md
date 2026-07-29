# Google Wallet

The Google adapter creates one LoyaltyClass ID per published Program Version and one LoyaltyObject ID per Membership credential. IDs are deterministic, provider-safe, and idempotent.

Object mapping includes localized Program/merchant content, the immutable public progress-asset URL, state, and the opaque W3 membership barcode. Add to Google Wallet actions are signed JWT links with bounded claims and allowed origins. The JWT references the stored object and does not embed the QR secret.

Insert handles already-existing resources by fetching and reconciling. Updates use patch semantics. Transfer makes the old object inactive/expired and creates a distinct object for the new credential.

Test Adapter mode records deterministic class/object/action state without claiming a real Google save. Real mode uses OAuth service-account credentials and is rejected in production unless configuration is complete.

Official sources consulted on 2026-07-29:

- [Create loyalty classes and objects](https://developers.google.com/wallet/retail/loyalty-cards/use-cases/create)
- [Issue passes with JWT](https://developers.google.com/wallet/retail/loyalty-cards/use-cases/jwt)
- [Issue loyalty cards on the web](https://developers.google.com/wallet/retail/loyalty-cards/web)
