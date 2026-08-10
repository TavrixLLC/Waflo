# Real provider release configuration

This runbook describes the existing Waflo implementation. It does not assert external provider
verification or deployment. Values are installed separately for staging and production under
`/opt/waflo-platform/env/<environment>/application.env`,
`/opt/waflo-platform/secrets/<environment>/application.env`, and
`/opt/waflo-platform/secrets/<environment>/provider-files/`.

## Google Wallet

### Configuration contract

| Name | Class | Exact value or format |
| --- | --- | --- |
| `GOOGLE_WALLET_MODE` | NON_SECRET_CONFIG | `REAL` for real issuance; `DISABLED` turns the provider off. `TEST_ADAPTER` is rejected in deployed environments. |
| `GOOGLE_WALLET_ISSUER_ID` | NON_SECRET_CONFIG | Issuer ID from Google Wallet Business Console. Keep it stable after issuance. |
| `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_PATH_OR_BASE64` | NON_SECRET_CONFIG | Container path `/run/waflo-provider-secrets/google-wallet-service-account.json`. The code also accepts base64, but deployed templates deliberately use a file. |
| `GOOGLE_WALLET_ALLOWED_ORIGINS` | NON_SECRET_CONFIG | Staging: `https://card.staging.waflo.app`; production: `https://card.waflo.app`. These are copied into the signed Save JWT. |
| `GOOGLE_WALLET_PUBLIC_ASSET_BASE_URL` | NON_SECRET_CONFIG | Staging: `https://api.staging.waflo.app/v1/public/wallet-assets`; production: `https://api.waflo.app/v1/public/wallet-assets`. |
| `GOOGLE_WALLET_PUBLISHING_MODE` | NON_SECRET_CONFIG | Staging while approval is pending: `DEMO`; public production after approval: `PUBLISHING`. This is a deployment gate, not a second issuance implementation. |
| `google-wallet-service-account.json` | SECRET_FILE | Complete service-account JSON. Waflo reads `client_email`, PEM `private_key`, and optional `token_uri`. Project ID and private-key ID may remain in the normal JSON but are not separate Waflo settings. |

OAuth token exchange is fixed to the service account's `token_uri` or
`https://oauth2.googleapis.com/token`, with scope
`https://www.googleapis.com/auth/wallet_object.issuer`. The provider API base is fixed to
`https://walletobjects.googleapis.com/walletobjects/v1`; no endpoint override is required.

The service account must belong to the intended Google Cloud project, have an active key, and be
granted access to the Wallet issuer. Its JSON and private key remain server-side.

### Model, identifiers, and issuance

Waflo maps Merchant to the Google issuer/branding, a published Loyalty Card version to a Loyalty
Class, and a Membership pass instance to a Loyalty Object. It does not model a payment card.
Deterministic IDs are:

- class: `<issuerId>.waflo_loyalty_v1_<programVersionUuidWithoutHyphens>`
- object: `<issuerId>.waflo_member_v1_<walletPassInstanceUuidWithoutHyphens>`

Class/object issuance performs GET then PATCH, creates on not-found, and handles a concurrent
already-exists create by PATCHing the deterministic resource. Invalidation uses the same upsert
path with the complete inactive object. Archived/suspended programs, inactive/transferred
memberships, and invalidated passes map to `INACTIVE`. Repeated customer actions use the existing
pass instance and cannot fan out uncontrolled provider identities.

The object contains merchant/program branding, membership display identity, stamp progress,
reward-ready state, and the opaque membership QR credential. It never contains authentication
secrets, service-account material, signing keys, customer session tokens, or backend credentials.

Exact issuance surfaces:

- authoritative API: `POST /v1/customer/wallet/google/add-action`
- Customer Web BFF: `POST /api/waflo/v1/customer/wallet/google/add-action`
- component: `apps/customer-web/app/card/[publicMembershipId]/customer-card.tsx`, the existing
  **Add to Google Wallet** button

The API signs an RS256 Save JWT on the server and returns Google's
`https://pay.google.com/gp/v/save/<jwt>` URL. Claims are limited to service-account issuer,
Google audience/type, issue time, configured Customer Web origins, and the deterministic Loyalty
Object ID. The private key never reaches the browser.

### Demo Mode staging procedure

1. In Google Wallet Business Console, add the operator Google account as Admin/Developer, or add it
   as an allowed test account for the Demo issuer. Grant the service account issuer access.
2. Install the real staging Issuer ID and service-account JSON; set `REAL`, `DEMO`, the exact
   staging Customer origin, and the staging public-asset URL.
3. Run configuration validation and the operator-only provider readiness command. Confirm Google
   reports authenticated issuer access; do not interpret it as public publishing approval.
4. Deploy staging outside this repository task.
5. Create and publish a Waflo Loyalty Card, then join it as a customer using the authorized Google
   test account.
6. On Android, open `https://card.staging.waflo.app`, press **Add to Google Wallet**, follow the
   signed Google URL, and save the pass. In Demo Mode it is visibly test-only.
7. Issue a Staff stamp. Wait for the Wallet command worker to PATCH the same object and confirm the
   pass progress changes.
8. Reach the final threshold and confirm reward-ready status.
9. Redeem the final reward. Confirm completed cycle/history increments, progress becomes `0`,
   `rewardReady` becomes false, and active stamps are empty; confirm the same object updates.
10. Retry Add to Google Wallet and one Staff action to confirm no duplicate class/object is created.

Publishing Access pending does not block these authorized Demo Mode saves. Until Google approves
Publishing Access, ordinary unlisted Google users cannot save the pass and the pass remains marked
test-only. After approval, change the public environment's provider assertion from
`GOOGLE_WALLET_PUBLISHING_MODE=DEMO` to `PUBLISHING` and deploy that configuration. No Waflo code,
route, identifier, or database rewrite is required. The issuer and service account remain unchanged
unless the operator intentionally rotates them.

## Apple Wallet

### Configuration and secret formats

| Name | Class | Exact value or format |
| --- | --- | --- |
| `APPLE_WALLET_MODE` | NON_SECRET_CONFIG | `REAL` for signed installable passes; `DISABLED` turns it off. `TEST_ADAPTER` is rejected in deployed environments. |
| `APPLE_PASS_TYPE_IDENTIFIER` | NON_SECRET_CONFIG | Existing Apple Pass Type ID, normally `pass.<reverse-domain>`. It must match the signing certificate UID/CN. |
| `APPLE_TEAM_IDENTIFIER` | NON_SECRET_CONFIG | Ten-character Apple Team ID; it must match the signing certificate OU. |
| `APPLE_ORGANIZATION_NAME` | NON_SECRET_CONFIG | Display organization, currently `Waflo by Tavrix LLC`. |
| `APPLE_PASS_CERTIFICATE_PATH_OR_BASE64` | NON_SECRET_CONFIG | Container path `/run/waflo-provider-secrets/apple-wallet-pass.p12`. |
| `APPLE_WWDR_CERTIFICATE_PATH_OR_BASE64` | NON_SECRET_CONFIG | Container path `/run/waflo-provider-secrets/apple-wwdr.pem`. |
| `APPLE_PASS_WEB_SERVICE_URL` | NON_SECRET_CONFIG | Staging: `https://api.staging.waflo.app/v1/apple-wallet`; production: `https://api.waflo.app/v1/apple-wallet`. Do not append the protocol's second `/v1`. |
| `APPLE_APNS_ENVIRONMENT` | NON_SECRET_CONFIG | `production` in staging and production. Wallet pass pushes use the production APNs host. |
| `APPLE_PASS_AUTH_ACTIVE_SECRET_VERSION` | NON_SECRET_CONFIG | Positive integer present in the keyring; start at `1`. |
| `apple-wallet-pass.p12` | SECRET_FILE | Password-protected PKCS#12/PFX containing the Pass Type ID certificate and matching private key. File bytes or base64 are accepted by code; the deployed contract uses the file. |
| `apple-wwdr.pem` | SECRET_FILE | Apple WWDR intermediate in PEM text. A PEM file or base64-encoded PEM text is accepted. It is not a private key. |
| `APPLE_PASS_CERTIFICATE_PASSWORD` | SECRET_VALUE | Exact PKCS#12 password; it must be nonempty. |
| `APPLE_PASS_AUTH_SECRETS_JSON` | SECRET_VALUE | JSON object such as `{"1":"<32-byte-secret>"}`. Each value must decode to exactly 32 bytes from 64 hex characters, base64, or base64url. |
| `APPLE_PASS_AUTH_SECRET_V1` | SECRET_VALUE | Same version-1 value as the keyring, retained for the compatibility path. |

Waflo does not use a separate APNs `.p8` key. The same Pass Type certificate/private key in the P12
authenticates the HTTP/2 Wallet update push. Do not create or replace Apple material if the
operator's existing certificate is valid.

If the downloaded WWDR certificate is DER, convert only on the operator machine:

```bash
openssl x509 -inform DER -in AppleWWDRCAG4.cer -out apple-wwdr.pem
```

If the operator has separate PEM certificate and key instead of P12/PFX, combine them outside Git:

```bash
openssl pkcs12 -export -inkey pass-private-key.pem -in pass-certificate.pem \
  -certfile apple-wwdr.pem -out apple-wallet-pass.p12
```

### Signing and web service

Real mode constructs `pass.json`, localized strings and images, a SHA-1 manifest of packaged
files, and a detached PKCS#7 signature with the WWDR chain. It verifies the certificate/key pair,
Pass Type ID, Team ID, chain, expiry, and signs a `storeCard`. The pass includes stable
`serialNumber`, server-derived `authenticationToken`, HTTPS `webServiceURL`, membership QR,
progress, reward state, and `voided` lifecycle state. It is returned as
`application/vnd.apple.pkpass`. There is no fake signer fallback in staging/production.

Customer download surfaces:

- authoritative API: `GET /v1/customer/wallet/apple/pass`
- Customer Web BFF/link: `GET /api/waflo/v1/customer/wallet/apple/pass`
- component: the existing **Add to Apple Wallet** link in
  `apps/customer-web/app/card/[publicMembershipId]/customer-card.tsx`

Apple's public protocol routes are:

| Operation | Implemented path | Staging URL | Production URL |
| --- | --- | --- | --- |
| Register device | `POST /v1/apple-wallet/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber` | `https://api.staging.waflo.app/v1/apple-wallet/v1/devices/.../registrations/.../...` | `https://api.waflo.app/v1/apple-wallet/v1/devices/.../registrations/.../...` |
| Unregister device | `DELETE` on the same path | same staging base | same production base |
| List updated passes | `GET /v1/apple-wallet/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier?passesUpdatedSince=<tag>` | staging base plus path | production base plus path |
| Retrieve updated pass | `GET /v1/apple-wallet/v1/passes/:passTypeIdentifier/:serialNumber` | staging base plus path | production base plus path |
| Device logs | `POST /v1/apple-wallet/v1/log` | `https://api.staging.waflo.app/v1/apple-wallet/v1/log` | `https://api.waflo.app/v1/apple-wallet/v1/log` |

Routes parse `Authorization: ApplePass <token>`, verify the exact Pass Type ID and serial ownership,
and constant-time verify the token against all retained pass-auth key versions. Device identifiers
are stored as protected hashes and push tokens encrypted; registrations are idempotent, update tags
are globally monotonic, and device logs retain only safe mapped codes. The controller has rate
limits. Revoked/inactive membership state produces a voided updated pass.

The Wallet worker sends the required empty `{}` APNs payload with Pass Type ID topic, background
push type and priority 5. Only `BadDeviceToken`, `DeviceTokenNotForTopic`, `ExpiredToken`, and
`Unregistered` remove a registration. HTTP 429/5xx retry through the existing leased Wallet command;
other 4xx responses are provider errors and do not destroy a potentially valid token. Push commands
have pass/update-sequence idempotency keys, conditional leases, and safe multi-instance ownership.

### Physical iPhone staging procedure

1. Install the existing staging Pass Type ID, Team ID, password-protected P12, WWDR PEM, and
   versioned pass-auth secret. Set the exact staging web-service base and production APNs endpoint.
2. Validate configuration and confirm the operator-only readiness report says local Apple signing
   is `CONFIG_READY`. This is not physical certification.
3. Deploy staging outside this task; create/publish a Loyalty Card and join it in Customer Web.
4. On a physical iPhone, open the staging customer card, tap **Add to Apple Wallet**, inspect the
   real signed `.pkpass`, and add it to Wallet.
5. Confirm the device calls the staging registration route and an active encrypted push-token
   registration exists.
6. Issue a Staff stamp. Confirm the Wallet worker updates the pass, creates one APNs push command,
   sends the empty notification, and the iPhone calls the updated-pass list and retrieval routes.
7. Confirm progress on the installed pass changes; repeat to reward-ready.
8. Redeem the final reward. Confirm completed history/cycle increments, progress `0`,
   `rewardReady=false`, active stamps empty, APNs notification succeeds, and iPhone fetches the
   reset pass.
9. Remove the pass and verify unregister behavior. Exercise an explicitly invalid test push token
   and confirm only that registration is cleaned up.

Only completion of this procedure may mark Apple Wallet externally verified.

## Stripe

### Current routes and behavior

- billing summary: `GET /v1/organizations/:organizationId/billing`
- selected plan: `PATCH /v1/organizations/:organizationId/billing/selected-plan`
- Checkout Session: `POST /v1/organizations/:organizationId/billing/checkout`
- Customer Portal: `POST /v1/organizations/:organizationId/billing/portal`
- manual canonical reconciliation: `POST /v1/organizations/:organizationId/billing/reconcile`
- webhook: `POST /v1/webhooks/stripe`
- exact staging webhook URL: `https://api.staging.waflo.app/v1/webhooks/stripe`
- exact production webhook URL: `https://api.waflo.app/v1/webhooks/stripe`

Checkout is Stripe-hosted subscription Checkout. The API creates/associates one Stripe Customer per
organization under invariant locks and uses provider and local idempotency keys. It maps the current
Waflo `STARTER`, `GROWTH`, and `SCALE` plans only to their configured monthly Price IDs. Product IDs
are not read. The success/cancel URLs are derived, not configurable:

- staging success: `https://app.staging.waflo.app/en/dashboard/billing?checkout=returned`
- staging cancel: `https://app.staging.waflo.app/en/dashboard/billing?checkout=canceled`
- production success: `https://app.waflo.app/en/dashboard/billing?checkout=returned`
- production cancel: `https://app.waflo.app/en/dashboard/billing?checkout=canceled`

Customer Portal is available only when the existing organization has a Stripe Customer and
`STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID` is configured; its return is the environment's
`/en/dashboard/billing` page. No speculative billing plans or payment-card UI are added.

### Configuration contract

| Name | Class | Exact value or format |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | SECRET_VALUE | Staging must be `sk_test_...`; production must be `sk_live_...`. |
| `STRIPE_WEBHOOK_SECRET` | SECRET_VALUE | Endpoint-specific `whsec_...`, separate for staging and production. |
| `STRIPE_STARTER_MONTHLY_PRICE_ID` | NON_SECRET_CONFIG | Environment-specific recurring `price_...` for existing STARTER. |
| `STRIPE_GROWTH_MONTHLY_PRICE_ID` | NON_SECRET_CONFIG | Environment-specific recurring `price_...` for existing GROWTH. |
| `STRIPE_SCALE_MONTHLY_PRICE_ID` | NON_SECRET_CONFIG | Environment-specific recurring `price_...` for existing SCALE. |
| `STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID` | NON_SECRET_CONFIG | Optional environment-specific `bpc_...`; required only to expose current Portal behavior. |
| `STRIPE_RECONCILIATION_INTERVAL_MINUTES` | NON_SECRET_CONFIG | Integer 5–1440, template `60`. |
| `STRIPE_RECONCILIATION_BATCH_SIZE` | NON_SECRET_CONFIG | Integer 1–500, template `50`. |
| `STRIPE_PUBLISHABLE_KEY` | not required | Accepted by the config schema for compatibility but not used by current Web UI or placed in a client bundle; omit it. |

There is no separate `STRIPE_MODE`: deployment environment and key prefixes enforce TEST/LIVE
isolation. The five core settings (secret, webhook secret, three prices) must be all present or all
absent. TEST and LIVE Price IDs, Customers, subscriptions, endpoint secrets, and Portal
configuration remain completely separate.

The repository uses `stripe@22.3.2` without an override; that SDK sends its bundled default API
version `2026-06-24.dahlia`. Configure each Dashboard webhook endpoint to that version. Handled
events are exactly `customer.subscription.created`, `customer.subscription.updated`, and
`customer.subscription.deleted`; other event types are authenticated, recorded, and ignored.

Nest retains the raw webhook body. Stripe signature verification occurs before processing. A unique
provider/event record and conditional lease make duplicate delivery safe. For each handled event,
Waflo retrieves the current canonical subscription and validates Stripe Customer, organization
metadata, local profile, Price ID, and plan ownership before applying entitlement. Active/trialing,
past-due/unpaid, cancellation/incomplete-expired, and suspended incomplete/paused states use the
existing mapping. A scheduled operational-worker reconciliation and the manual organization route
recover missing or delayed webhooks with multi-instance-safe leases.

### Stripe TEST-mode staging procedure

1. In Stripe TEST mode create the three existing monthly recurring Prices and, if Portal is used,
   a TEST Portal configuration. Do not use LIVE objects.
2. Create a TEST webhook endpoint at exactly
   `https://api.staging.waflo.app/v1/webhooks/stripe`, API version `2026-06-24.dahlia`, subscribing
   to the three handled subscription events. Install its `whsec_...` endpoint secret.
3. Install `sk_test_...`, all three TEST Price IDs, optional TEST `bpc_...`, and reconciliation
   settings; validate readiness and deploy staging outside this task.
4. In Merchant Web billing, choose an existing Waflo plan and initiate checkout. Complete Stripe
   hosted Checkout with a Stripe TEST card and return to the derived Waflo success URL.
5. Confirm the webhook receives a valid raw-body signature, retrieves the current subscription,
   matches the Stripe Customer and organization, and makes the Waflo entitlement canonical.
6. Use Stripe Dashboard **Resend** on the same event. Confirm the endpoint returns safe success and
   records it as a duplicate without a second entitlement transition.
7. Simulate delay/missing delivery by temporarily disabling only the staging endpoint (or allow a
   TEST event delivery to fail), change/cancel the TEST subscription, then re-enable the endpoint.
   Do not touch production.
8. Run authenticated `POST /v1/organizations/:organizationId/billing/reconcile` or wait for the
   scheduled interval. Confirm canonical retrieval corrects the local entitlement before/without
   relying on the delayed webhook. Resend the delayed event and confirm state remains canonical.
9. Exercise TEST renewal/payment-failure/cancellation states supported by the existing mapping and
   confirm no TEST customer or object exists in LIVE mode.

For LIVE mode, repeat object and endpoint creation in Stripe LIVE mode using the production URL,
`sk_live_...`, a new production `whsec_...`, LIVE Price IDs, and optional LIVE Portal config. Validate
production configuration, but do not enable or deploy it until staging provider verification and
release approval are complete.

## Operator-only readiness

Ordinary `/health` and `/ready` remain local liveness/dependency checks and do not call provider
networks. `pnpm readiness:production` is an operator-only command and now reports provider states:

- `DISABLED`: explicit provider mode or fully absent Stripe core configuration
- `CONFIG_MISSING`: provider requested but incomplete/unloadable local configuration
- `CONFIG_READY`: locally valid Apple signing awaiting physical external verification
- `PROVIDER_ERROR`: configured provider authentication, authorization, certificate, or network error
- `READY`: Google authenticated issuer access or Stripe authenticated API access verified

Only safe mode/status/certification metadata is printed; no credential value or file content is
included.

## Future GitHub pipeline inventory

No workflow is created in this release-preparation round.

Repository variables needed later:

- `NODE_VERSION=24.14.1`, `PNPM_VERSION=11.5.2`
- container registry owner/names and immutable full-SHA release naming policy
- non-secret deployment script/path conventions

Repository secrets needed later:

- container registry authentication if GitHub's scoped token is insufficient
- SSH/deployment transport identity only if the future deployment design uses it

Staging environment variables:

- all tracked staging `compose.env` values
- all tracked staging `application.env` NON_SECRET_CONFIG values, including issuer/identifier,
  Wallet URLs/modes, Stripe Price/Portal IDs, and reconciliation settings

Staging environment secrets:

- values from staging `application.secrets.env`, including `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `APPLE_PASS_CERTIFICATE_PASSWORD`, and the versioned Apple pass-auth
  keyring

Production environment variables and secrets use the same names with production domains, Google
`PUBLISHING`, Stripe LIVE values, and completely separate credentials.

Server-side files that must not be embedded in workflow YAML are each environment's
`google-wallet-service-account.json`, `apple-wallet-pass.p12`, and `apple-wwdr.pem`. Prefer
pre-provisioning/secret-manager delivery directly to the VPS provider directory; never print or
base64-inline them in workflow source or logs.
