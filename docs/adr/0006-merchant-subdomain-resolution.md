# ADR 0006: Merchant subdomain resolution

- Status: Accepted
- Date: 2026-07-27

## Context

Customer pages must resolve `{merchantSlug}.waflo.app` safely before loyalty functionality exists.

## Decision

Centralize hostname parsing and organization lookup in the public API. Accept one slug label under the configured base domain and local `.localhost`/`.lvh.me` equivalents. Use `?tenant=` only outside production.

## Consequences

Active, unknown, malformed, reserved, archived, and suspended states are consistent. Wildcard DNS/TLS is a production prerequisite, and verified custom domains remain a future extension.
