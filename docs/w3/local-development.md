# W3 local development

Prerequisites are Node 24, pnpm 11, Docker, and a Chromium browser for Playwright.

1. Copy `.env.example` to `.env` and supply local development-only secrets.
2. Run `pnpm infra:up`.
3. Run `pnpm db:generate`, `pnpm db:migrate:deploy`, and `pnpm db:seed`.
4. Run `pnpm build`.
5. Start `pnpm dev:api`, `pnpm dev:marketing`, `pnpm dev:dashboard`, `pnpm dev:customer`, and `pnpm dev:wallet-worker`.
6. Use `today.lvh.me:3002` for a real local merchant host, or `http://localhost:3002/?tenant=today` for the documented development override.

Set both Wallet modes to `TEST_ADAPTER` for local end-to-end evidence. Test adapters are clearly labeled and production validation refuses them.

Run `pnpm test`, `node scripts/run-playwright.mjs w3`, and `node scripts/run-playwright.mjs w3-accessibility`. Mailpit is available at `http://localhost:8025`; MinIO Console is available at `http://localhost:9001`.
