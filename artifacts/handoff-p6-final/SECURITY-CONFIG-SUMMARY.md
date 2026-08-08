# Security and configuration summary

- Production CSP remains centralized and excludes `unsafe-eval` and localhost by default.
- Development receives only required localhost and evaluation relaxations.
- An optional API URL is parsed as a URL; production requires HTTPS unless the explicit local production-smoke switch is set, and that switch only accepts loopback hosts.
- Merchant API production fallback is `https://api.waflo.app`, not localhost.
- Wallet test adapters remain rejected by production environment validation.
- No debug UI, production test route, access token, private key, signing secret, valid QR credential, or customer PII was added.
- No M2 provenance-bound source and no Flutter source is changed by P6.

The authoritative M2 bundle safety metadata remains in `artifacts/handoff-w4-m2-provenance-repair/mobile-contracts/source-manifest.json`.
