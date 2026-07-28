# Waflo

Waflo is a wallet-first loyalty SaaS platform owned and operated by Tavrix LLC. This repository contains the completed **Phase W1 platform foundation**: public marketing, first-party merchant identity, organization/location/team administration, plan and billing foundations, public merchant-host resolution, audit/security records, and English/Arabic experiences.

Phase W1 deliberately does **not** implement loyalty-program creation, customer enrollment, wallet passes, stamp/points activity, rewards, campaigns, analytics, or employee scanning. Those product capabilities begin after this foundation.

## Phase W2: Loyalty Studio

W2 adds the merchant Programs surface for stamp-based loyalty programs: Quick Mode, Pro Mode entitlements, eight built-in templates, English/Arabic content, deterministic stamp previews, safe local image uploads, validation, synthetic Test Mode, immutable versioned publication, program state transitions, and atomic first-publication trial activation.

W2 intentionally does not add real customers, memberships, Wallet issuance, QR enrollment, staff scanning, POS integrations, or Flutter. See [docs/w2/overview.md](docs/w2/overview.md) and the W2 handoff under `artifacts/handoff-w2/`.

## Repository

```text
apps/
  api/                  NestJS + Fastify authoritative API
  marketing-web/        Public English/Arabic marketing site
  merchant-dashboard/   Merchant authentication, onboarding, and administration
  customer-web/         Branded merchant-host W1 states
packages/
  auth/                 Password, opaque-token, and session primitives
  billing/              Plan catalog, entitlements, and trial decisions
  brand/                Official brand archive, assets, and design tokens
  config/               Validated environment contract
  contracts/            Shared schemas and API envelopes
  database/             Prisma schema, migrations, generated client, and seed
  i18n/                 Locale/direction/formatting helpers
  permissions/          Central role and permission policy
  security/             Redaction and security utilities
  stamp-engine/         Deterministic Waflo stamp layout and SVG renderer
  ui/                   Accessible shared React design system
docs/                   Architecture, security, operations, and ADRs
tests/                  Unit, integration, Playwright, and accessibility suites
artifacts/screenshots/  Actual critical-screen browser captures
```

## Requirements

- Node.js 24.x
- pnpm 11.5.2 through Corepack
- Docker Desktop with Compose
- Chromium installed through Playwright

## Quick start

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

Open:

- Marketing: `http://localhost:3000/en` or `http://localhost:3000/ar`
- Merchant dashboard: `http://localhost:3001/en/login`
- Customer state: `http://localhost:3002/?tenant=today`
- API docs: `http://localhost:4000/docs`
- Mailpit: `http://localhost:8025`

Development seed credentials:

- Owner: `owner@waflo.local`
- Manager: `staff@waflo.local`
- Password for both: `Waflo-Development-2026`

These accounts are development-only and are never suitable for a shared or production environment.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start all applications |
| `pnpm dev:api` | Start only the API |
| `pnpm dev:marketing` | Start only marketing |
| `pnpm dev:dashboard` | Start only the merchant dashboard |
| `pnpm dev:customer` | Start only the customer site |
| `pnpm infra:up` | Start PostgreSQL, Redis, and Mailpit |
| `pnpm infra:down` | Stop local infrastructure |
| `pnpm infra:reset` | Remove local infrastructure volumes and data |
| `pnpm db:migrate` | Create/apply a development migration |
| `pnpm db:migrate:deploy` | Apply committed migrations |
| `pnpm db:seed` | Load safe development data |
| `pnpm db:validate` | Validate the Prisma schema |
| `pnpm format:check` | Check formatting |
| `pnpm lint` | Run static lint checks |
| `pnpm typecheck` | Typecheck all workspaces |
| `pnpm test:unit` | Run unit tests |
| `pnpm test:integration` | Run real-database integration tests |
| `pnpm test:e2e` | Run functional browser flows and screenshots |
| `pnpm test:a11y` | Run automated accessibility checks |
| `pnpm build` | Create all production builds |
| `pnpm check` | Run the main local quality gate |

`test:e2e` and `test:a11y` use production application starts, so run `pnpm build` after source changes and before either command.

## Documentation

- [Architecture](docs/architecture.md)
- [Brand integration](docs/brand-integration.md)
- [Security and threat model](docs/security.md)
- [Operations](docs/operations.md)
- [Architecture decisions](docs/adr/README.md)
- [Screenshot manifest](artifacts/screenshots/README.md)

The public Terms and Privacy pages are product-quality legal placeholders, not approved legal advice. Tavrix LLC must complete legal review before production launch.
