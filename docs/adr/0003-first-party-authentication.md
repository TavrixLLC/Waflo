# ADR 0003: First-party authentication

- Status: Accepted
- Date: 2026-07-27

## Context

W1 requires verification, password reset/change, session control, localization, auditability, and future non-web clients.

## Decision

Own identity records and flows in the API. Normalize email, hash passwords with Argon2id, and store only hashes of opaque single-use tokens.

## Consequences

Waflo controls lifecycle and audit semantics without provider lock-in. Tavrix must operate email deliverability, credential security, incident response, and future stronger-authentication work.
