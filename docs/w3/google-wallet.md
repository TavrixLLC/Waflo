# Google Wallet

The Google adapter creates one LoyaltyClass ID per published Program Version and one LoyaltyObject ID per Membership credential. IDs are deterministic, provider-safe, and idempotent.

Object mapping includes localized Program/merchant content, the immutable public progress-asset URL, state, and one opaque W3 membership QR code. The visible hierarchy is Google-native logo/issuer and program title, native QR, then one 1032:812 hero containing only the selected stamp composition, followed by one provider-native reward row referenced from the object's localized `textModulesData`. ROW, GRID, RING, and PATH are never rewritten to compensate for Google's hero aspect ratio, so wide layouts can show provider-native letterboxing. Numeric loyalty balance and customer account name remain omitted; status and full details remain available below the primary card surface. Google owns final typography and spacing. Add to Google Wallet actions are signed JWT links with bounded claims and allowed origins; the JWT references the stored object and does not embed the QR secret.

Insert handles already-existing resources by fetching and reconciling. Existing classes and objects use full `PUT` update semantics so removed presentation fields cannot survive a partial patch. Transfer makes the old object inactive/expired and creates a distinct object for the new credential.

Test Adapter mode records deterministic class/object/action state without claiming a real Google save. Real mode uses OAuth service-account credentials and is rejected in production unless configuration is complete.

The merchant dashboard preview mirrors this provider contract, including the native QR-before-hero order and hero aspect ratio, while explicitly marking Google-owned geometry as approximate.

Official sources consulted on 2026-08-24:

- [Create loyalty classes and objects](https://developers.google.com/wallet/retail/loyalty-cards/use-cases/create)
- [Issue passes with JWT](https://developers.google.com/wallet/retail/loyalty-cards/use-cases/jwt)
- [Issue loyalty cards on the web](https://developers.google.com/wallet/retail/loyalty-cards/web)
- [Customize loyalty-card templates](https://developers.google.com/wallet/retail/loyalty-cards/resources/template)
- [Update a LoyaltyClass](https://developers.google.com/wallet/reference/rest/v1/loyaltyclass/update)
