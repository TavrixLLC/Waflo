# Waflo W1 Repair Compliance

Date: 2026-07-27
Runtime: Node.js 24.14.1
Scope: Phase W1 repairs only

## Completed controls

1. Verification and password-reset tokens use conditional, single-row claims inside database transactions. Concurrent requests produce exactly one successful consumer.
2. Invitations have an explicit `PENDING`, `ACCEPTED`, `CANCELED`, or `EXPIRED` lifecycle. Expired invitations can be reissued. Managers may manage Staff invitations only.
3. Organization capacity and final-resource invariants share a serializable PostgreSQL transaction, a transaction-scoped advisory lock, bounded serialization retries, and stable conflict errors.
4. Plan changes are centralized in Billing. Downgrades are rejected with `PLAN_DOWNGRADE_BLOCKED` when current locations or team seats exceed the requested plan. Selecting a plan does not activate a subscription or start a trial.
5. Stripe webhook rows use atomic creation/claim, an expiring processing lease, safe failed-event retry, configured price-to-plan mapping, customer/organization consistency checks, subscription-item period fields, transactional audit writes, and post-commit owner notifications.
6. Token-bearing browser URLs are replaced before token use. Invitation inspect/accept operations accept tokens in POST bodies. API and Next token pages use no-store and no-referrer policies. Fastify request serialization removes sensitive query values.
7. Production rate limiting fails closed when Redis is unavailable. Readiness checks PostgreSQL and Redis. Development memory buckets are bounded. Trusted proxies are explicit environment configuration.
8. A real NestJS/Fastify HTTP harness covers cookies, CSRF, CORS, authentication, roles, cross-tenant access, envelopes, validation, raw Stripe signatures, request IDs, and production tenant-override rejection.
9. UUID, cursor, token, host, audit action, and pagination validation is centralized before Prisma access.
10. All three Next applications have production HSTS, CSP without `unsafe-eval`, no-sniff, frame, referrer, permissions, and applicable cache policies.
11. Notification HTML escapes organization-controlled values and rejects unsafe or off-origin action URLs.
12. `ErrorReporter` has no-op and dynamic Sentry implementations, metadata and exception redaction, API unhandled-exception integration, safe activity-update reporting, and Next error boundaries.
13. Playwright is launched through a managed process runner that owns all four servers, terminates them in `finally`, waits for ports to close, and records per-process logs.
14. API responses expose `x-request-id`; sensitive endpoints use IP plus applicable email/account/organization rate signals; public merchant-host responses no longer expose internal organization UUIDs; lint is warning-free; accessibility coverage includes the W1 contract routes.
15. This evidence package contains raw command output, exit codes, browser results, server logs, process checks, and screenshots.

## Database change

Migration: `packages/database/prisma/migrations/20260727190000_repair_round_1_invariants/migration.sql`

The migration adds `InvitationStatus`, backfills existing invitation states, enforces one pending invitation per organization/email, adds invitation state/timestamp consistency checks, and adds Stripe webhook lease and update timestamps.

## Scope confirmation

No W2 programs, campaigns, customer ledger, analytics engine, public API, webhooks product surface, or other W2 functionality was added. Existing future navigation placeholders were not implemented.
