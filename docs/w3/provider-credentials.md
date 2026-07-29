# Provider credentials

Provider modes are `DISABLED`, `TEST_ADAPTER`, and `REAL`. `TEST_ADAPTER` is allowed only outside production and produces visibly labeled local artifacts.

Apple real mode requires the pass type identifier, team identifier, pass certificate, certificate password, WWDR certificate, HTTPS update-service URL, versioned pass-auth secret, and APNs environment. Certificate inputs may be file paths or injected base64 values and must be supplied through a secret manager in deployment.

Google real mode requires issuer ID, service-account JSON, allowed origins, and an HTTPS public asset base URL. Service-account JSON may be a protected file or injected base64 value.

Health endpoints return safe mode/readiness/error categories only. They never return certificate contents, passwords, service-account JSON, private keys, access tokens, or raw provider error bodies.
