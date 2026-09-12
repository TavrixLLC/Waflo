# Waflo Mobile production-v1 documentation

This directory is the canonical Staff Mobile integration set for backend commit `763f2dfccdb24fb9bfa16457f0e49936840e20a1` on `release/production-v1`.

Use the documents in this order:

1. [production-v1-backend-contract.md](production-v1-backend-contract.md) — **authoritative master contract**: security domains, lifecycle, state semantics, mutations, errors, reconciliation, Mobile actions, and release gates.
2. [production-v1-endpoint-catalog.md](production-v1-endpoint-catalog.md) — exhaustive 178-route classification and exact reference for all 25 Mobile-relevant endpoints.
3. [production-v1-e2e-checklist.md](production-v1-e2e-checklist.md) — ordered physical-device staging/production verification with explicit authoritative checks.
4. [production-v1-contract-summary.json](production-v1-contract-summary.json) — machine-readable, non-secret documentation metadata; it is not runtime configuration.

When documents appear to conflict, current executable source at the recorded commit wins, then the master contract, endpoint catalog, and checklist in that order. Historical [M2 contracts](../contracts/m2) are immutable baseline evidence and are not current authority for the discrepancies called out in the master.

This set covers Staff operational Mobile. It intentionally does not turn Merchant Web auth, Customer Web auth, Apple Wallet/Google Wallet provider credentials, or customer save-action endpoints into Mobile interfaces.

The current verdict is **MOBILE_CODE_CHANGES_REQUIRED** (`MOB-001` through `MOB-004`). BCK-001, BCK-002, and BCK-003 are resolved in executable source; BCK-004 remains a scoped non-blocking pairing error-mapping issue. Physical staging E2E starts only after the exact backend is deployed to `https://api-staging.waflo.app`, deployment readiness is green, and Mobile implements the remaining required changes, including the supported manager-approval retry flow.
