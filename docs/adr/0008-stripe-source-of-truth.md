# ADR 0008: Stripe as billing source of truth

- Status: Accepted
- Date: 2026-07-27

## Context

Waflo needs Checkout, Portal, webhook lifecycle, and local development without production credentials.

## Decision

Use Stripe's official SDK behind the billing service. Stripe lifecycle events update a local query model after signature verification and durable event deduplication. Missing credentials return an explicit unavailable result; they never create fake billing success.

## Consequences

Production billing depends on correctly mapped Price IDs, webhook secrets, and event operations. Local/integration tests can verify authorization/signatures/idempotency without charging or requiring live secrets.
