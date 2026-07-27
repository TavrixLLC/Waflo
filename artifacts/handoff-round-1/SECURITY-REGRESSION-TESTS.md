# Security Regression Tests

Automated coverage proves:

- raw verification, reset, invitation, cookie, authorization, password, secret, and signature values are redacted from structured metadata;
- token query values are removed by the Fastify request serializer;
- captured API logs contain no raw token URL, body, or legacy invitation-path patterns;
- reported exception messages and reporter metadata are sanitized before Sentry;
- the optional dynamic Sentry adapter loads the official `@sentry/node` package and degrades without breaking requests if the provider fails;
- notification organization names are HTML-escaped;
- `javascript:` and off-origin email actions are removed;
- production Redis failure rejects rate-limited requests and readiness;
- development memory rate-limit storage is capped;
- all Next applications emit CSP without `unsafe-eval`, and HSTS is production-only;
- token pages are no-store, no-referrer, noindex, and noarchive;
- production tenant query overrides return `TENANT_OVERRIDE_FORBIDDEN`;
- public merchant resolution omits internal organization UUIDs;
- API error and success responses include correlated request IDs.

Primary automated evidence is in `tests/unit/repair-security.test.ts`, `tests/http/boundary.test.ts`, and `raw-test-output/token-log-scan.txt`.
