# ADR 0005: Multi-tenancy enforcement

- Status: Accepted
- Date: 2026-07-27

## Context

Organization IDs and selected-organization UI state are attacker-controlled and cannot grant access.

## Decision

Every organization-owned service resolves authenticated membership and required capability before querying or mutating nested resources. Nested queries include organization ownership. Database constraints protect invariants; explicit cross-tenant tests are mandatory.

## Consequences

Authorization stays server-side and reusable. Service methods need organization context, adding deliberate verbosity that prevents accidental global lookups.
