# Waflo W1 operations

## Environment contract

Copy `.env.example` to `.env`. Validation happens at API startup. Empty Stripe/Sentry/Scale values mean the optional adapter or configurable entitlement is unavailable; the API returns an explicit safe error instead of fabricating success.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | Yes | `development`, `test`, or `production` |
| `API_PORT` | Yes | API listen port |
| `DATABASE_URL` | Yes | PostgreSQL connection |
| `REDIS_URL` | Production | Distributed rate limiting/readiness |
| `RATE_LIMIT_NAMESPACE` | Optional | Redis key namespace; defaults to `waflo` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | Yes | Transactional SMTP |
| `EMAIL_FROM` | Yes | Notification sender |
| `MARKETING_WEB_URL` | Yes | Public marketing origin |
| `MERCHANT_DASHBOARD_URL` | Yes | Auth/action-link origin |
| `CUSTOMER_WEB_URL` | Yes | Customer application origin |
| `API_PUBLIC_URL` | Yes | Browser/server API origin |
| `ALLOWED_ORIGINS` | Yes | Comma-separated CORS/CSRF allowlist |
| `COOKIE_SECURE`, `COOKIE_NAME` | Yes | Session-cookie policy |
| `SESSION_TTL_DAYS` | Yes | Absolute session lifetime |
| `EMAIL_VERIFICATION_TTL_MINUTES` | Yes | Verification token lifetime |
| `PASSWORD_RESET_TTL_MINUTES` | Yes | Reset token lifetime |
| `INVITATION_TTL_DAYS` | Yes | Team invitation lifetime |
| `MERCHANT_BASE_DOMAIN` | Yes | Merchant host suffix |
| `SCALE_LOCATION_LIMIT`, `SCALE_TEAM_LIMIT` | Optional | Configurable Scale limits; blank means unspecified |
| `STRIPE_SECRET_KEY` | Stripe | Stripe server key |
| `STRIPE_WEBHOOK_SECRET` | Stripe | Endpoint signing secret |
| `STRIPE_*_MONTHLY_PRICE_ID` | Stripe | Starter/Growth/Scale recurring Price IDs |
| `STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID` | Optional | Fixed Portal configuration |
| `SENTRY_DSN` | Optional | Future error-monitoring adapter |
| `LOG_LEVEL` | Yes | Structured API log level |
| `LEGAL_TERMS_VERSION`, `LEGAL_PRIVACY_VERSION` | Yes | Accepted legal document versions |
| `LEGAL_EFFECTIVE_DATE` | Yes | Displayed legal effective-date text |
| `NEXT_PUBLIC_API_URL` | Web build optional | Browser-visible API URL; defaults to local API |
| `NEXT_PUBLIC_DASHBOARD_URL` | Web build optional | Marketing-to-dashboard links; defaults to the local dashboard |
| `NEXT_PUBLIC_MARKETING_URL` | Web build optional | Canonical marketing metadata/auth back-link origin |
| `NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE` | Web build optional | Build-time legal effective-date display override |

Never commit `.env`. Store production values in the deployment platform's encrypted secret/config service.

## Clean local startup

```powershell
corepack enable
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm infra:up
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed
pnpm dev
```

Stop applications with the terminal interrupt, then run `pnpm infra:down`. `pnpm infra:reset` removes local PostgreSQL and Redis volumes; it is destructive and intended only for disposable development data.

## Database migrations

- Development schema change: edit `packages/database/prisma/schema.prisma`, then `pnpm db:migrate`.
- Deployment: back up first, release the migration artifact, run `pnpm db:migrate:deploy` once, then roll out the API.
- Validation: `pnpm db:validate` and `pnpm --filter @waflo/database migrate:status`.
- Seed is idempotent development data, not a production initializer.

Backups must include PostgreSQL plus the exact application/migration release. Use managed point-in-time recovery in production, encrypted copies in a separate failure domain, retention policy, and a rehearsed restore into an isolated database. Redis is not the source of truth and is rebuilt.

## Health and readiness

- `GET /health` proves the API process is serving.
- `GET /ready` checks PostgreSQL and, when configured, Redis.

Load balancers should use readiness and stop routing before shutdown. Alert on readiness failures, elevated 5xx/429 rates, webhook failures, mail failures, and database saturation. Request IDs connect client errors, API logs, audit records, and security events.

## Mailpit

Local SMTP is `127.0.0.1:1025`; the mailbox UI is `http://localhost:8025`. Register, resend verification, forgot password, or invite a user, open the message, and follow its action link. Mailpit captures rather than delivers mail.

## Stripe test mode

1. In Stripe test mode create monthly USD Prices for Starter ($29), Growth ($69), and Scale ($129).
2. Put the test secret key and Price IDs in `.env`.
3. Install/authenticate Stripe CLI.
4. Run:

   ```powershell
   stripe listen --forward-to http://localhost:4000/v1/webhooks/stripe
   ```

5. Copy the emitted `whsec_...` value to `STRIPE_WEBHOOK_SECRET`, restart the API, and use Checkout from the Owner billing screen.
6. Trigger lifecycle events with Stripe CLI or complete a test Checkout. Re-delivering the same event must be idempotent.

Without credentials, billing pages remain usable and the API reports `STRIPE_NOT_CONFIGURED`; no fake session URL is returned.

## Merchant subdomains locally

The zero-configuration route is:

```text
http://localhost:3002/?tenant=today
http://localhost:3002/?tenant=alnahr&lang=ar
```

For real host parsing, use `lvh.me`, which resolves subdomains to loopback:

```text
http://today.lvh.me:3002
http://alnahr.lvh.me:3002/?lang=ar
```

Production requires wildcard DNS/TLS for `*.waflo.app` to the customer application and separate DNS/TLS for `waflo.app`, `app.waflo.app`, and `api.waflo.app`.

## CI and test operation

CI starts PostgreSQL/Redis services, runs migrations/seed, installs Chromium, and executes format, lint, typecheck, unit, integration, production build, browser, and accessibility checks. Playwright reports, screenshots, and traces are retained as artifacts.

Locally, run:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
pnpm test:e2e
pnpm test:a11y
pnpm db:validate
```

## Deployment assumptions

Build and deploy the API and three Next.js applications as separate services from the same release. Run migrations before API traffic. Configure HTTPS-only origins and cookies, SMTP, PostgreSQL, Redis, Stripe, wildcard DNS/TLS, backups, and monitoring. There is no deployment manifest tied to a cloud vendor in W1.

## Troubleshooting

- API cannot start: validate `.env`, PostgreSQL port 5432, and `pnpm db:migrate:deploy`.
- Registration stalls/fails: verify Mailpit/SMTP is reachable at `127.0.0.1:1025`; SMTP has bounded connection/socket timeouts.
- Login returns CSRF error: access the dashboard through its configured origin and include credentials; refresh to renew the CSRF token.
- Customer page is 404: verify organization status/slug and use `?tenant=` or a valid `.localhost`/`.lvh.me` host.
- Checkout unavailable: verify all three Price IDs, secret key, and webhook secret, then restart the API.
- Readiness fails: inspect PostgreSQL and Redis health with `docker compose ps`.
