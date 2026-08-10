# Horizontal scale and state audit

## Stateless application review

Merchant Dashboard, Customer Web, and Marketing Web use immutable standalone Next images. They have no durable volumes; cache/tmp paths are container-local tmpfs and may disappear at any time. The Customer BFF uses `API_INTERNAL_URL=http://api:4000`, while browser traffic uses the public environment URL. Any Web replica can serve any request.

API sessions, customer sessions, Staff device sessions, OAuth authorization requests (state hash, nonce hash, encrypted PKCE verifier, expiry, and atomic consumption), invitations, reset/verification tokens, replay nonces, idempotency records, entitlements, approvals, privacy commands, and webhook event state live in PostgreSQL. Production rate limits use authenticated shared Redis and fail closed if Redis is unavailable. No sticky session is required.

Uploads and generated/public/private assets use the S3 abstraction and one environment bucket. No request stores durable customer content in an application container. Wallet readiness now uses S3 `HeadBucket`, not a MinIO-only URL, so a managed S3-compatible service is a configuration change. The single-host MinIO HTTP exception is limited by validation to the exact private service DNS name `minio:9000`; external storage must use HTTPS.

Process-local maps found in the audit are immutable provider/config lookup tables or request/batch-local calculation structures. The development-only in-memory rate-limit fallback is rejected by deployed configuration. Browser CSRF memoization is per browser page and is backed by cookie/session verification; it is not server affinity.

## Scale blockers found and fixed

| Blocker | Resolution |
|---|---|
| No production images, private networking, release procedure, or bounded logs/resources | Added the Compose/Docker/release platform. |
| Database pool size implicitly followed driver defaults | Added explicit bounded pool controls and per-service Compose budgets. |
| Customer Web server calls used the public API URL/localhost fallback | Added a runtime internal service-DNS URL for server/BFF calls. |
| Customer BFF relayed inbound forwarding chains | It now strips forwarding headers and rebuilds only a validated Cloudflare client IP plus HTTPS scheme. |
| Wallet worker readiness depended on MinIO's proprietary health path | Replaced with the existing S3 abstraction's bucket operation. |
| Worker heartbeat rows were keyed only by worker type | Added a composite worker/instance primary key and multi-instance readiness reporting. |
| API/worker logs and health did not consistently expose environment/release/instance | Added structured identity fields and OCI release labels. |
| Worker signal handlers disconnected shared clients before loops drained | Signals now mark stopping; loops finish, then Redis/Prisma/S3 clients close. |
| Migrations could have been coupled to replica startup in a naive deployment | Added one explicit migration image/service and ordered deployment script. |
| Several workspace runtime exports pointed at TypeScript source under `node_modules`, which Node 24 production deploy subsets reject | Runtime exports now target compiled JavaScript while development/type resolution keeps source types. |

No remaining application-state blocker or affinity requirement was found. Provider capacity/rate limits and the single VPS failure domain are operational constraints, not hidden state affinity.

## Security, replay, and mutation controls

- Merchant/customer auth and OAuth flow transitions use PostgreSQL records and atomic update predicates.
- API/global and Staff operation rate limits use shared Redis Lua atomic increments in deployed environments.
- Staff nonces, manager approval consumption, loyalty command processing, redemption, reversal, entitlement mutation, transfer, privacy, checkout, and program publication are database-unique/transactional and use advisory locks or conditional claims where required.
- Stripe webhook identity is unique by provider/external event and canonical reconciliation is database-leased/locked.
- Wallet queue hints use Redis NX/TTL, while PostgreSQL command leases remain authoritative. Losing a Redis hint cannot bypass the database claim.
- Key version sets are environment-wide. All API and worker replicas must receive identical active and legacy versions.

This work does not alter enumeration resistance, Argon2 dummy login behavior, account authority, manager approval binding/atomic use, Customer BFF origin protections, Swagger production disablement, privacy export encryption/protection, Stripe canonical reconciliation, Redis atomic controls, Next image optimizer disablement, or loyalty semantics.

## Recurring job classification

All current recurring work is category A (horizontally safe/distributed); there is no category B process-memory singleton scheduler. The migration operation is singleton by deployment procedure, not a recurring worker job.

| Work | Classification | Duplicate prevention/behavior |
|---|---|---|
| Stripe scheduled reconciliation | A | Conditional database lease per subscription plus transaction advisory lock and canonical ownership checks. |
| Reward expiry | A | Unique idempotency command, conditional lease, membership/entitlement locks. |
| Incremental/rebuild analytics | A | Checkpoint/job leases, unique source contributions, organization advisory locks. |
| Operational exports | A | Conditional command lease and immutable object key. |
| Privacy export/erasure | A | Conditional request lease and organization/program/membership/privacy advisory locks. |
| Retention/security cleanup | A | Database predicates are atomic; S3 delete is idempotent; duplicate scans can add work but not duplicate domain mutation. |
| Projection integrity sampling | A | Read-mostly sampling and deduplicated risk findings; replicas may sample independently. |
| Wallet command dispatch | A | Redis NX queue reservation plus authoritative conditional DB claim/lease. |
| Program Wallet sync | A | Conditional job lease and idempotent per-pass queueing. |
| Wallet provider update/reconciliation | A | Command lease, idempotency keys, Apple/global and per-pass DB advisory ordering. |
| Worker heartbeat/readiness | A | One row per worker instance; readiness reports every instance and succeeds when at least one is current. |

Default Compose starts one replica of each worker. Additional replicas are safe, but provider rate limits and DB connections must be increased deliberately. Scale with `docker compose up -d --scale wallet-worker=N` only after observing backlog/provider capacity; do not scale `migrate`.

## Database connection budget

Each Node process owns a bounded `pg` pool through the Prisma PostgreSQL adapter. Defaults are API 10, Operational Worker 5, Wallet Worker 5, and migration 2 transient connections. `DATABASE_POOL_CONNECTION_TIMEOUT_MS`, idle timeout, and maximum connection lifetime are explicit.

| Topology | API | Workers | Steady application maximum | With one migration |
|---|---:|---:|---:|---:|
| 1 API + one of each worker | 10 | 10 | 20 | 22 |
| 2 API + one of each worker | 20 | 10 | 30 | 32 |
| 4 API + one of each worker | 40 | 10 | 50 | 52 |

Each extra Operational or Wallet Worker adds its configured five connections. With PostgreSQL `max_connections=100`, keep at least 20 connections unallocated for administration, migrations, failover overlap, and unexpected clients; plan application pool maxima at or below 80. Staging and production use separate initial PostgreSQL containers and budgets.

PgBouncer is not justified for the first one-API topology. The application accepts a standard `DATABASE_URL`; later point it to transaction-compatible PgBouncer, review Prisma transaction/advisory-lock requirements, then lower per-process pools before adding many nodes. Moving directly to managed/dedicated PostgreSQL is also URL-only and requires no image rebuild.

## Initial resource envelope

Compose limits are ceilings, not reservations. Production defaults to PostgreSQL 1280 MiB, Redis 256 MiB, MinIO 512 MiB, API 640 MiB, Web 256–288 MiB each, Operational Worker 512 MiB, Wallet Worker 640 MiB, and cloudflared 128 MiB: about 4.7 GiB total. Staging uses a deliberately smaller approximately 2.45 GiB envelope. If both environments coexist, their combined ceiling is about 7.15 GiB, leaving roughly 3.85 GiB of physical RAM for Ubuntu, Docker, and unrelated services before swap. Actual steady use should be lower, but these are not guarantees; swap is an emergency buffer, not capacity.

CPU ceilings are independently throttled and may oversubscribe the six physical CPUs; they do not reserve cores. Keep staging stopped when it is not needed if unrelated host services are under pressure. Measure peak RSS, PostgreSQL cache hit rate, worker backlog, API latency, swap activity, and OOM events before raising any environment-specific limit.

Builds are sequential because Next/TypeScript/native dependency builds can spike memory. Prefer CI/off-host builds and registry pulls as soon as an image registry is available. Monitor host memory, swap activity, disk, PostgreSQL, Redis no-eviction failures, MinIO disk headroom, API latency, worker backlog, and provider throttling before changing limits.

## Health, shutdown, and observability

`/health` proves the API process can answer. `/ready` verifies PostgreSQL, Redis rate-limit storage, and the S3 bucket; future load balancers must route only to `/ready` successes. Nest/Fastify shutdown hooks stop accepting traffic and close providers on SIGTERM. Worker loops mark their per-instance heartbeat as stopping, finish the current bounded loop/command, then close clients. Compose grants 30 seconds (60 for PostgreSQL).

Application logs remain stdout/stderr and Docker rotates five 10 MiB files per container. API/worker records include service, deployment environment, Git SHA, instance, event/request identity, and existing redaction. Compose labels provide the same identity for Web/state containers. Sentry remains configured by DSN. Future log shipping and metrics agents can consume Docker logs, `/ready`, and worker heartbeat/backlog state without code redesign; none are required for launch.

## Application nodes versus stateful infrastructure

Application nodes run API, Merchant Web, Customer Web, Marketing Web, Operational Worker and/or Wallet Worker, plus a tunnel/edge agent when that node is an origin. They have no durable volumes.

The stateful infrastructure node runs PostgreSQL, Redis, and S3-compatible storage plus backups. In a real multi-VPS topology, do not stretch Docker bridge networking between hosts. Give every application node private TLS/network endpoints for the same PostgreSQL, Redis, and object bucket and update only configuration.

## Two-server transition

First move PostgreSQL/Redis/object storage to managed services or a dedicated protected state node; verify backup/restore and TLS. Keep VPS #1 as an application node. Add VPS #2 with the same image SHA, environment keyrings/secrets, public URLs, pool budgets, and provider settings but its own instance identity. Run migration once from an operator job. Start VPS #2, require readiness, add it to Cloudflare Load Balancer/tunnel origin pools, then drain/update VPS #1. Sticky sessions remain disabled.

If state remains on VPS #1 while VPS #2 is added, VPS #1 is still a stateful single failure domain and private cross-host access must be authenticated/encrypted and firewall-restricted. That is a transition, not HA.

## Three-or-more-server transition

Use shared managed/dedicated state, an image registry, and at least two edge connectors/origins. Allocate roles based on load (Web/API nodes and worker nodes can differ), but use the same images and configuration contract. Recalculate aggregate DB pools and provider concurrency. Deploy one node at a time: build immutable image, migrate once, deploy one node, pass readiness, add/reroute traffic, update the next node, drain the old node, and roll back only the application image if required. Database rollback is never automatic.
