# Provider health

Merchant UI and API report `DISABLED`, `TEST_ADAPTER`, or `REAL` mode with normalized readiness. Test Adapter status is visibly labeled and never presented as external provider success.

Health output redacts certificates, passwords, service-account JSON, keys, tokens, origins with secrets, and raw provider responses. Production configuration rejects Test Adapters and incomplete or unsafe real-provider settings.
