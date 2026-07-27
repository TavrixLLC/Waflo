# ADR 0001: Monorepo and application boundaries

- Status: Accepted
- Date: 2026-07-27

## Context

Waflo needs separate public, merchant, customer, and API deployment surfaces while sharing contracts, policy, brand, and types.

## Decision

Use a pnpm/Turborepo TypeScript monorepo with four applications and narrowly scoped workspace packages. Browser applications cannot import persistence code or bypass the API.

## Consequences

Atomic changes and one quality gate reduce contract drift. Each application stays independently deployable. Build orchestration and workspace version discipline become repository responsibilities.
