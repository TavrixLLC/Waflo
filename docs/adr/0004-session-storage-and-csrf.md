# ADR 0004: Session storage and CSRF

- Status: Accepted
- Date: 2026-07-27

## Context

Merchant sessions must be revocable and visible while browser mutations need CSRF protection.

## Decision

Persist hash-only opaque sessions in PostgreSQL and deliver the raw token through an HttpOnly cookie. Require an Origin-checked double-submit CSRF token for unsafe methods. Use Secure `__Host-` cookies in production.

## Consequences

Revocation, expiry, device display, and password-change invalidation are reliable. Every browser client must obtain/refresh CSRF state and send credentials; the database is queried for session authorization.
