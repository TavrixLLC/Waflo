# Waflo W1 architecture

## Shape and rationale

Waflo W1 is a TypeScript monorepo and a modular monolith. Three Next.js applications own distinct browser surfaces; a NestJS/Fastify API is the only authoritative business boundary; PostgreSQL owns durable state; Redis supports distributed rate limiting; SMTP carries transactional notifications. This keeps deployment and transaction boundaries understandable during foundation work while leaving clean seams for later extraction.

The browser applications never connect to the database. Shared packages contain policy and primitives, not tenant-specific persistence shortcuts. Future Flutter clients use the same HTTP API, response envelopes, session/permission decisions, and tenant-scoped services.

## Application boundaries

- `marketing-web` owns public pages, plan presentation, legal pages, contact content, and locale routing.
- `merchant-dashboard` owns authentication, verification, onboarding, organization switching, settings, locations, team, billing, audit, and security-session interfaces.
- `customer-web` resolves merchant hosts through the public API and renders only W1 active, unknown, reserved, malformed, or suspended states.
- `api` owns identity, authorization, tenant resolution, persistence, billing adapters, notifications, audit events, security events, health, readiness, and OpenAPI.

All API success responses use `{ data, requestId }`; errors use `{ error: { code, message, details?, requestId } }`. User-facing clients branch on stable error codes.

## Authentication and sessions

Identity is first-party. Emails are Unicode-normalized and lowercased into a unique comparison column. Passwords use Argon2id. Verification, reset, invitation, and session credentials are opaque random values; only SHA-256 hashes are stored.

Browser authentication uses a server-side session record and an HttpOnly cookie. The session model supports absolute expiry, last activity, device label, privacy-conscious IP metadata, individual revocation, other-session revocation, and all-session revocation. Password change revokes previous sessions and establishes a replacement.

Unsafe HTTP methods require a double-submit CSRF token plus an explicitly allowed Origin. Login and identity endpoints use stricter rate limits. Production requires a Secure `__Host-` session cookie.

## Multi-tenancy

Organization identity is always resolved from the authenticated membership and an explicit organization identifier. Controllers pass organization IDs into tenant-aware services; those services load membership before touching organization-owned state. Location, member, invitation, billing, and audit access cannot be inferred from a client-selected active organization alone.

Database uniqueness constraints protect organization-wide invariants, while integration tests attempt cross-tenant reads and mutations for every W1 organization-owned resource. Organization switching persists only a convenience selection and never changes authorization.

## Permissions

`@waflo/permissions` is the centralized role-to-capability map. Owner, Manager, and Staff decisions are evaluated before service mutations. Safety rules separately prevent final-owner removal, owner self-demotion when final, and unauthorized role assignment. The same permission vocabulary can be consumed by future Flutter clients without replacing the model.

## Domains and merchant hosts

Organizations own a normalized unique `merchantSlug`. Reserved names, format, history, password confirmation, uniqueness races, and cooldown are enforced centrally. Public resolution parses `{slug}.waflo.app`, `{slug}.localhost`, and `{slug}.lvh.me`; development can also pass `?tenant={slug}`. Unknown, malformed, reserved, archived, suspended, and active states are non-ambiguous, and suspended state does not disclose the normal merchant placeholder.

`OrganizationDomain` supports a future verified custom-domain lifecycle without weakening W1 host resolution.

## Plans, entitlements, and billing

The immutable plan catalog in `@waflo/billing` is the single source for marketing prices and API enforcement. Entitlement decisions are typed and include allowed state, limit, usage, reason, and upgrade recommendation. Scale limits remain nullable/configurable when the product decision is not locked.

The organization billing profile can stay `PENDING_ACTIVATION` with null trial dates. W1 never fabricates a trial start; later loyalty publication is the trigger extension point. Stripe is isolated behind the billing service. Checkout and Portal require Owner authorization and complete credentials. Webhooks use raw-body signature verification, durable event idempotency, and transactionally update billing state.

## Email

The API emits localized SMTP messages for verification, reset, invitation, login, password/session, and subscription events. Mailpit is the local provider. URLs target the merchant dashboard, and tokens remain only in the action URL. SMTP connections have bounded timeouts so an unavailable provider cannot strand requests indefinitely.

## Audit and security

Organization audit records are append-only in application code and through database triggers. They record actor, organization, action, target, request ID, timestamp, and redacted metadata. Security events separately capture authentication, CSRF, session, and suspicious behavior without exposing secrets. API logs redact cookies, authorization headers, Stripe signatures, passwords, and tokens.

## Extension points

- Wallet passes: a future provider package and program-publication workflow can consume organization/location identity and emit audit events.
- Loyalty programs and customer enrollment: new organization-owned modules can use the same tenant service, permissions, entitlements, API envelopes, and audit model.
- Flutter employee app: the API is framework-independent, OpenAPI-described, and does not rely on Next.js server actions or browser-only authorization.
- Service extraction: billing notifications, host resolution, or identity can move behind the existing module boundaries if scale justifies it.

## Deployment assumptions

The three web apps and API are independently deployable artifacts. They share a release version, database migration set, and environment contract. PostgreSQL must be backed up and migrated before API rollout. Redis, SMTP, DNS/TLS, Stripe, and legal copy are production dependencies/launch gates documented in operations.
