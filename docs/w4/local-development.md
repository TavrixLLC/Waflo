# Local W4 development

Prerequisites: Node 24, pnpm 11, Docker, PostgreSQL, Redis, Mailpit and MinIO.

```text
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:migrate:deploy
pnpm db:seed
pnpm dev:api
pnpm dev:dashboard
pnpm dev:operational-worker
```

Seed logins use `Waflo-Development-2026` with `owner@waflo.local`,
`manager@waflo.local`, `staff@waflo.local`, and `staff2@waflo.local`. The Staff Test Client uses a
fresh in-memory Ed25519 key and a pairing QR; no private key is committed or stored by Waflo.

Run `pnpm check` for the workspace gate. Use a separate test database for stateful W4 suites.

