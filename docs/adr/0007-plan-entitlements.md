# ADR 0007: Plan entitlements

- Status: Accepted
- Date: 2026-07-27

## Context

Pricing and server enforcement will drift if screens hardcode plan rules.

## Decision

Keep one typed plan catalog and entitlement decision functions in `@waflo/billing`. Decisions report allowance, configured limit, current usage, reason, and upgrade recommendation. Unspecified Scale limits remain nullable/configurable.

## Consequences

Marketing, dashboard, API, and tests share exact USD prices and limits. Future loyalty entitlements can extend the decision model without adding W1 loyalty behavior.
