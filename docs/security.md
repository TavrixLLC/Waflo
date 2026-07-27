# Waflo W1 security and threat model

## Security baseline

- Argon2id password hashing and non-reversible opaque-token hashes.
- Email verification before authentication.
- HttpOnly server-side sessions, bounded expiry, revocation, and device visibility.
- Double-submit CSRF plus strict Origin allowlist.
- Central permission checks and explicit tenant membership resolution.
- Zod request validation and stable error envelopes.
- Rate limits with Redis and a development-only memory fallback.
- Helmet headers, narrow CORS, request-size limits, raw Stripe webhook bodies.
- Structured logs with secret redaction.
- Append-only organization audit records and separate security events.

## Threats and controls

### Tenant leakage

Threat: a member supplies another organization's location, member, billing, invitation, or audit identifier.

Controls: tenant-scoped services validate organization membership first, nested resources are queried with their organization ID, roles are checked centrally, and explicit cross-tenant integration tests cover every W1 resource type. IDs are never authorization.

### Account takeover

Threat: password guessing, reset-token theft, unverified accounts, or session persistence after password change.

Controls: Argon2id, email verification, generic enumeration-resistant responses, short-lived single-use reset tokens, login/reset limits, new-login security events, device/session listing, and revocation of old sessions after password change.

### Session theft

Threat: cookie disclosure or replay.

Controls: opaque high-entropy tokens, hash-only storage, HttpOnly cookies, SameSite, Secure `__Host-` cookies in production, expiry/revocation checks, device metadata, revocation UI, CSP/headers, and no tokens in logs. W1 does not claim device binding.

### CSRF

Threat: another origin causes an authenticated mutation.

Controls: unsafe methods require a CSRF header matching a readable CSRF cookie and an allowlisted Origin. Webhooks use a dedicated signature-based exception, not a broad CSRF bypass.

### Privilege escalation

Threat: Staff or Manager calls Owner endpoints directly or mutates roles.

Controls: server authorization is independent of navigation visibility. The central capability map, role-assignment policy, final-owner invariant, billing Owner requirement, and integration/browser tests reject unauthorized actions.

### Invitation abuse

Threat: leaked, replayed, canceled, expired, cross-email, or excessive invitations.

Controls: random hash-only token, expiry, single active invitation constraint, cancel/resend lifecycle, team entitlement checks, role restrictions, exact normalized-email match at acceptance, rate limits, and audit events.

### Slug takeover

Threat: races, reserved-name use, immediate reuse of an old slug, or unauthorized URL changes.

Controls: normalized format/reserved policy, database uniqueness, slug-history cooldown, recent password confirmation, Owner permission, security/audit events, and host parser rejection of nested/malformed hosts.

### Stripe webhook forgery

Threat: forged or replayed subscription state.

Controls: official Stripe signature construction over the raw request body, configured endpoint secret, timestamp tolerance from the SDK, durable unique event ID, transactionally applied state, and invalid/duplicate signature tests.

### Account enumeration

Threat: register, resend, forgot-password, and invite responses reveal whether an email exists.

Controls: generic forgot/resend behavior, a non-confirming registration conflict message, rate limits, normalized identifiers, and no sensitive details in error envelopes.

### Logging leaks

Threat: cookies, passwords, action tokens, Stripe signatures, or personal data reach logs/audit metadata.

Controls: structured logger path redaction, metadata sanitization, request IDs instead of raw credentials, privacy-conscious IP fields, and the `@waflo/security` redaction helpers.

## Development versus production

Development uses local HTTP, non-Secure cookie naming, Docker credentials, Mailpit, optional Stripe credentials, a tenant query override, and an in-memory rate-limit fallback when Redis is absent. Production must use HTTPS, a Secure `__Host-waflo_session` cookie, explicit origins/URLs, managed PostgreSQL/Redis/SMTP secrets, real DNS/TLS, and rotated Stripe secrets. Development seed accounts and passwords must never be deployed.

## Residual risks and launch gates

- Legal Terms and Privacy text requires Tavrix LLC review.
- Sentry is an optional adapter and is not active without a DSN.
- W1 does not implement MFA, passkeys, breached-password screening, or device-bound sessions.
- Custom-domain verification and certificate automation remain future work.
- Operational WAF, DDoS controls, managed-secret rotation, backup restore drills, and security monitoring depend on the production platform.
- The Stripe boundary is complete and tested locally, but real checkout requires test/live credentials and Price IDs.
