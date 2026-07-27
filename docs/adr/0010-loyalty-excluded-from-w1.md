# ADR 0010: Loyalty functionality excluded from W1

- Status: Accepted
- Date: 2026-07-27

## Context

The platform foundation must be trustworthy before customer balances, wallet passes, stamps/points, rewards, or scanning create financial/reputational obligations.

## Decision

W1 contains no loyalty program CRUD, publication, enrollment, balance, transaction, reward, campaign, wallet-pass, analytics, or employee-scanning implementation. It provides honest empty states and typed extension points only. Trial dates remain null until a later publication trigger exists.

## Consequences

No fake metrics or premature customer flows appear. W2 can build on verified identity, tenants, roles, locations, billing, audit, host resolution, and API contracts without migrating a deceptive prototype.
