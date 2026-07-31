# Membership projection

`membership_progress_projections` contains current stamps, completed cycles, cycle number,
reward-ready state, projection version, last ledger sequence and source entry. It is a read model,
not an alternate authority.

The API reduces each new event and persists the resulting projection in the same transaction.
PostgreSQL requires the declared source entry to belong to the same tenant and Membership at the
exact projection sequence.

Verification rebuilds in memory and compares the fingerprint. Rebuild is an authorized,
audited command with an expected-version precondition; drift never triggers a blind overwrite.
Normal reads never scan the full ledger.

