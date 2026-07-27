# Token Leakage Prevention

## Browser boundary

- Verification and reset pages no longer receive query tokens through server-rendered props.
- Client components capture `token`, remove it with `history.replaceState`, then use it.
- Invitation links use `/invite?token=...`; the browser removes the query value.
- Invitation inspect and accept use POST-body tokens at `/v1/invitations/inspect` and `/v1/invitations/accept`.
- Token pages emit `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, and noindex/noarchive directives.

## API and telemetry boundary

- Fastify request serialization uses `sanitizeRequestUrl`.
- Sensitive query values become `[REDACTED]`.
- Cookie, authorization, Stripe signature, password, and token fields remain in Pino redaction paths.
- Audit/security metadata recursively redacts sensitive keys.
- ErrorReporter sanitizes exception messages and metadata before Sentry.
- No raw token is included in invitation, authentication, webhook, audit, or security metadata.

## Evidence

- `tests/unit/repair-security.test.ts` captures serialized log output and proves the raw token string is absent.
- `raw-test-output/token-log-scan.txt` scans captured API logs for raw token query, body, and legacy path patterns.
- Result: no raw token patterns found.
