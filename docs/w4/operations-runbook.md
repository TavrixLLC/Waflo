# Operations runbook

## Deploy

1. Back up PostgreSQL and record restore point.
2. Validate production environment and deploy migrations before application replicas.
3. Deploy API, Wallet worker and operational worker; verify health and bounded backlog.
4. Run ledger integrity sampling and projection drift checks.
5. Exercise a non-customer synthetic device revocation and Test Adapter operation where allowed.

## Incident actions

- Ledger mismatch: stop write traffic, retain database and logs, page security/operations, verify
  secrets and affected Membership chains. Never rewrite entries.
- Device compromise: mark compromised, revoke sessions, rotate the installation key by re-pairing.
- Wallet outage: leave ledger writes available, monitor outbox, resume and reconcile after recovery.
- Fraud: preserve safe evidence, revoke device if appropriate, resolve through compensating events.
- Privacy: verify authorization and command result before communicating completion.

Rollback application code only after confirming its schema compatibility. Forward-fix migrations;
never roll back by deleting ledger data.

