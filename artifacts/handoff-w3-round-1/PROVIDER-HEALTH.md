# Provider health

The dashboard now separates `configured`, `providerReachable`, and `externallyCertified`.

## Google REAL

Health performs a cached harmless authenticated issuer GET, not a Class creation. Results distinguish `NOT_CONFIGURED`, `CREDENTIAL_INVALID`, `ISSUER_ACCESS_DENIED`, `API_UNAVAILABLE`, `RATE_LIMITED`, `DEGRADED`, and `HEALTHY`. Only an authenticated issuer probe can be healthy. The cache window is 60 seconds. Credentials and provider payloads are not logged.

## Apple REAL

Local checks validate HTTPS web-service URL, matched private key/leaf certificate, WWDR chain, Pass Type Identifier, Team Identifier, and expiry. Results distinguish invalid configuration, expiring/expired certificate, identifier/team mismatch, and local signing validity. APNs/device reachability remains unverified without an external run. A locally valid REAL configuration therefore reports `EXTERNALLY_UNCERTIFIED`, not full certification.

Provider-health collection is isolated with settled promises; a failed probe or failed degradation audit cannot roll back otherwise valid enrollment.

Test Adapter/disabled evidence is explicitly labeled. `provider-artifacts/configured-externally-uncertified.json` is a synthetic local conformance statement, not a real provider probe.

Google mapping/update behavior follows official [updates](https://developers.google.com/wallet/retail/loyalty-cards/use-cases/updates) and REST [Class](https://developers.google.com/wallet/reference/rest/v1/loyaltyclass)/[Object](https://developers.google.com/wallet/reference/rest/v1/loyaltyobject) documentation.
