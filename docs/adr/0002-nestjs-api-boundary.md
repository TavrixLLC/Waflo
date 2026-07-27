# ADR 0002: NestJS API boundary

- Status: Accepted
- Date: 2026-07-27

## Context

Web and future Flutter clients need one authoritative domain and authorization boundary.

## Decision

Use a modular NestJS application on Fastify. Controllers validate/transport; services own use cases; Prisma owns persistence. Describe the HTTP contract with OpenAPI and stable envelopes/error codes.

## Consequences

Authorization cannot depend on Next.js UI behavior, and future clients reuse the API. The modular monolith can later extract services behind existing boundaries without premature distributed transactions.
