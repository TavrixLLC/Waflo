# Real HTTP Boundary Coverage

Harness: `tests/http/boundary.test.ts`
Server: exported `createApiApplication()` using the production NestJS module, Fastify adapter, guards, interceptors, filter, raw-body support, CORS, cookies, Helmet, and controllers.

The nine passing tests cover:

1. CSRF cookie issuance and attributes, plus session cookie issuance with `HttpOnly`, `SameSite=Lax`, and root path.
2. Valid Origin and CSRF success; missing token, invalid token, missing Origin, and disallowed Origin rejection.
3. Credentialed CORS behavior for allowed and disallowed origins.
4. Unauthenticated route protection, stable success/error envelopes, caller request-ID propagation, and response security/cache headers.
5. Owner, Manager, and Staff authorization at real controller routes.
6. Cross-tenant organization, location, member, billing, and audit routes.
7. Malformed UUID, cursor, audit action, pagination, host, and invitation token validation, plus rejection of organization-level plan mutation.
8. Stripe signature verification against the exact raw HTTP request body.
9. Production tenant query override rejection and omission of the internal organization UUID from public host resolution.

Raw output: `raw-test-output/http-tests.txt`
Result: 9 passed, exit code 0.
