# Production configuration and external-provider handoff

Waflo uses one codebase in `development`, `staging`, and `production`. Set
`DEPLOYMENT_ENVIRONMENT` explicitly. Staging and production require optimized
Node production builds, HTTPS origins, secure `__Host-` cookies, exact origin
allowlists, authenticated SMTP, private object storage, Redis, dedicated
secrets, and explicit trusted proxies. Staging data, provider clients, keys,
wallet issuers, buckets, databases, and Stripe customers must remain separate
from production.

Use `.env.example` for local development and the two deployment-shape examples
as a secret-manager checklist. Do not commit a populated environment file.
Run `pnpm readiness:production` inside the API runtime environment before a
release. It prints status categories and key version numbers only; it never
prints credentials.

## Core — REQUIRED_FOR_PRODUCTION

- PostgreSQL: `DATABASE_URL` (TLS-enabled, non-development database).
- Redis: `REDIS_URL`, `RATE_LIMIT_NAMESPACE`.
- private object storage: `OBJECT_STORAGE_ENDPOINT`,
  `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`,
  `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`,
  `OBJECT_STORAGE_SIGNING_SECRET`, `OBJECT_STORAGE_FORCE_PATH_STYLE`.
- exact public endpoints: `MARKETING_WEB_URL`, `MERCHANT_DASHBOARD_URL`,
  `CUSTOMER_WEB_URL`, `API_PUBLIC_URL`, `WALLET_PUBLIC_BASE_URL`, and the exact
  comma-separated `ALLOWED_ORIGINS`.
- web build-time public URLs: `NEXT_PUBLIC_API_URL` for Merchant Web,
  `NEXT_PUBLIC_DASHBOARD_URL` and `NEXT_PUBLIC_MARKETING_URL` for public links.
  These values are public by design, but must still be exact and environment-specific.
- legal runtime config: leave `LEGAL_EFFECTIVE_DATE` empty in staging while review is pending;
  production requires the counsel-approved `YYYY-MM-DD` value and fails before deployment
  mutation when it is absent or invalid. Do not use a GitHub variable or image build argument for
  legal approval state.
- edge/session policy: `TRUSTED_PROXIES`, `COOKIE_SECURE=true`,
  `COOKIE_SAME_SITE`, `COOKIE_NAME=__Host-waflo_session`,
  `CUSTOMER_COOKIE_NAME=__Host-waflo_customer`, `SESSION_TTL_DAYS`, and
  `SESSION_IDLE_TTL_MINUTES`.

Only the configured trusted proxy may supply forwarded network context. OAuth
callbacks are fixed API paths; the Customer BFF verifies that its resolved
upstream origin is the configured API origin.

## Authentication

### Google Sign-In — REQUIRED_ONLY_IF_FEATURE_ENABLED

Create separate Google OAuth web clients for staging and production. Register
exactly:

- staging: `https://<staging-api>/v1/auth/external/google/callback`
- production: `https://<production-api>/v1/auth/external/google/callback`

Set `GOOGLE_SIGNIN_CLIENT_ID`, `GOOGLE_SIGNIN_CLIENT_SECRET`, and
`GOOGLE_SIGNIN_REDIRECT_URI`. Also set a dedicated `OAUTH_FLOW_SECRET` and
`OAUTH_FLOW_TTL_MINUTES`. Verify with the operator readiness command and a real
provider login. Never commit the client secret, flow secret, authorization
code, ID token, or access token.

### Sign in with Apple — REQUIRED_ONLY_IF_FEATURE_ENABLED

Create a Services ID per environment, associate it with the correct Apple
developer team, register the HTTPS domain, and register exactly
`https://<api-origin>/v1/auth/external/apple/callback`. Set
`APPLE_SIGNIN_CLIENT_ID`, `APPLE_SIGNIN_TEAM_ID`, `APPLE_SIGNIN_KEY_ID`,
`APPLE_SIGNIN_REDIRECT_URI`, and either `APPLE_SIGNIN_PRIVATE_KEY` or
`APPLE_SIGNIN_PRIVATE_KEY_BASE64`. Verify readiness, then test first consent,
private relay, and a later login where Apple omits email. Never commit the
private key, client secret JWT, authorization code, or ID token.

Provider subject plus issuer is the durable identity. Provider email is mutable
metadata. A matching email never auto-links an existing Waflo account.

## Email — REQUIRED_FOR_PRODUCTION

Create an authenticated SMTP account with a verified sender/domain. Set
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and
`SMTP_FROM`. Mailpit remains the development default. Verify DNS and provider
delivery, then exercise verification, reset, invitation, and security mail.
Never commit SMTP credentials. Business mutations remain committed if a later
notification fails; delivery failure is retried and audited.

## Stripe — REQUIRED_ONLY_IF_BILLING_IS_ENABLED

Create separate Stripe TEST and LIVE Prices, portal configuration, server key,
and webhook endpoint `https://<api-origin>/v1/webhooks/stripe`. Set
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, the three
`STRIPE_*_MONTHLY_PRICE_ID` values,
`STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID`,
`STRIPE_RECONCILIATION_INTERVAL_MINUTES`, and
`STRIPE_RECONCILIATION_BATCH_SIZE`. Staging rejects live keys; production
rejects test keys. The current browser UI does not use a publishable key and
Product IDs are not configuration inputs. Verify checkout, signed webhook,
entitlement, and canonical scheduled reconciliation. Never commit keys or
webhook secrets. See the exact environment contract and procedures in
[`docs/release/real-provider-configuration.md`](release/real-provider-configuration.md).

## Google Wallet — REQUIRED_ONLY_IF_FEATURE_ENABLED

Use the operator's Google Wallet issuer and a server-side service account with
issuer access. Set `GOOGLE_WALLET_MODE=REAL`, `GOOGLE_WALLET_ISSUER_ID`,
`GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_PATH_OR_BASE64`,
`GOOGLE_WALLET_ALLOWED_ORIGINS`, `GOOGLE_WALLET_PUBLIC_ASSET_BASE_URL`, and
`GOOGLE_WALLET_PUBLISHING_MODE`. Production requires `PUBLISHING`; automated
mock success is not external certification. Verify with a real customer Save
to Wallet followed by stamp, reward-ready, and redemption updates. Never
commit service-account JSON/private keys.

## Apple Wallet — REQUIRED_ONLY_IF_FEATURE_ENABLED

Use the operator's existing Pass Type ID, Wallet certificate/private key, Apple
WWDR intermediate, and APNs-capable provider material. Set
`APPLE_WALLET_MODE=REAL`, `APPLE_PASS_TYPE_IDENTIFIER`,
`APPLE_TEAM_IDENTIFIER`, `APPLE_PASS_CERTIFICATE_PATH_OR_BASE64`,
`APPLE_PASS_CERTIFICATE_PASSWORD`,
`APPLE_WWDR_CERTIFICATE_PATH_OR_BASE64`, `APPLE_PASS_WEB_SERVICE_URL`, and
`APPLE_APNS_ENVIRONMENT`, `APPLE_PASS_AUTH_SECRETS_JSON`, and
`APPLE_PASS_AUTH_ACTIVE_SECRET_VERSION`. Real Wallet pass updates require the
production APNs host in staging and production. Verify a signed
`.pkpass`, device registration, progress update, and invalidation on a physical
iPhone. Never commit certificates containing private material, private keys,
passwords, or pass authentication secrets.

## Multi-version secrets — REQUIRED_FOR_PRODUCTION

Configure `CUSTOMER_DATA_ENCRYPTION_KEYS_JSON`,
`MEMBERSHIP_CREDENTIAL_SECRETS_JSON`, and `APPLE_PASS_AUTH_SECRETS_JSON` as
secret-manager-provided JSON maps whose integer keys are versions. Select the
write version with `CUSTOMER_DATA_ACTIVE_KEY_VERSION`,
`MEMBERSHIP_CREDENTIAL_ACTIVE_SECRET_VERSION`, and
`APPLE_PASS_AUTH_ACTIVE_SECRET_VERSION`. Deploy new material as readable,
switch the active version, observe new writes, then retire an old version only
after its data/credentials are no longer required. Missing active material
fails closed. Readiness exposes versions, never values.

Dedicated legacy/core values remain required where referenced:
`CUSTOMER_CONTACT_LOOKUP_HMAC_KEY`, `CUSTOMER_SESSION_SECRET`,
`LEDGER_HASH_SECRET_V1`, `MERCHANT_TRANSACTION_REFERENCE_HMAC_KEY_V1`, and
`DEVICE_SESSION_SECRET`.

## Workers and observability

Run the API, Merchant Dashboard, Customer Web, Marketing Web, Operational
Worker, and Wallet Worker as separate restartable processes. Configure
`WORKER_HEARTBEAT_INTERVAL_SECONDS`, `WORKER_DEGRADED_AFTER_SECONDS`,
`CLEANUP_BATCH_SIZE`, `SECURITY_TOKEN_RETENTION_DAYS`,
`WALLET_WORKER_CONCURRENCY`, and `WALLET_COMMAND_MAX_ATTEMPTS`. Heartbeats are
stored in PostgreSQL and detailed readiness is operator-only. `SENTRY_DSN` is
optional; application behavior never depends on Sentry availability. Never
commit a DSN if the project treats it as secret, and never send provider
tokens/private material as telemetry.

## Domain, storage, and monitoring setup

Before a physical staging test, create DNS and trusted TLS for marketing,
merchant, customer, and API origins; a private staging object bucket with CORS
disabled unless explicitly needed; database backups with a tested restore; and
Sentry/monitoring projects with API and worker alerts. Verify from physical
Android/iPhone networks, not only localhost. External-account creation,
provider approval/certification, DNS/TLS, deployment, backup infrastructure,
and monitoring-vendor deployment are deliberately outside this code task.
