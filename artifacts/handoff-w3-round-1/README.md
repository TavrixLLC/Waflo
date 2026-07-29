# Waflo W3 repair round 1 handoff

Status: implementation complete; local automated gates passed; external Apple and Google certification remains pending.

This handoff covers the focused W3 repairs only: pinned stamp-artwork fidelity, Customer CSRF/origin enforcement, dedicated integration and concurrency proof, paginated Program Wallet sync, centralized Apple update tags, race-safe Apple registration, truthful provider health, the single-program merchant root, and corrected evidence labeling.

## Start here

- [Final compliance matrix](FINAL-COMPLIANCE-MATRIX.md)
- [Test summary](TEST-SUMMARY.md)
- [Screenshot manifest](SCREENSHOT-MANIFEST.md)
- [Evidence integrity](EVIDENCE-INTEGRITY.md)
- [External certification](EXTERNAL-CERTIFICATION.md)
- [Provider artifacts](provider-artifacts/)
- [Structured evidence](evidence/)
- [Raw test output](raw-test-output/)

The `.pkpass` is a synthetic Test Adapter package. Redacted Google files are local Test Adapter mappings. Neither is evidence of a real device/account save.

## Database changes

The W3 foundation migrations are `20260729153000_w3_customer_membership_wallet` and `20260729160000_w3_session_credential_binding`. Repair Round 1 adds `20260729200000_w3_round1_wallet_sync_and_registration` and `20260729203000_w3_wallet_sync_stable_cursor`.

## Official provider references

Provider behavior was checked only against official documentation:

- Apple: [Creating the source for a pass](https://developer.apple.com/documentation/walletpasses/creating-the-source-for-a-pass), [Adding a web service to update passes](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes), and [Getting the list of updatable passes](https://developer.apple.com/documentation/walletpasses/get-the-list-of-updatable-passes).
- Google: [Loyalty cards web integration](https://developers.google.com/wallet/retail/loyalty-cards/web), [Updating passes](https://developers.google.com/wallet/retail/loyalty-cards/use-cases/updates), [LoyaltyClass REST resource](https://developers.google.com/wallet/reference/rest/v1/loyaltyclass), and [LoyaltyObject REST resource](https://developers.google.com/wallet/reference/rest/v1/loyaltyobject).

## Scope

No W4 stamp ledger, production stamp issuance, reward redemption, staff scanner, device pairing, or Flutter implementation was added.
