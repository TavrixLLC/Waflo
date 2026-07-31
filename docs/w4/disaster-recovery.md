# Disaster recovery

Required production procedure:

1. Take encrypted PostgreSQL, Redis-persistence and private-object backups under the deployment
   retention policy.
2. Restore into an isolated environment with provider sends disabled.
3. Apply the recorded migration set and compare migration checksums.
4. Verify ledger chains, projection fingerprints, command counts and Wallet outbox state.
5. Confirm export/privacy objects decrypt and access controls remain private.
6. Record RPO/RTO observed in the environment and obtain operational sign-off.

The local migration-and-seed restore proves schema portability only. It is not a production restore
test and no production RPO/RTO is claimed.

