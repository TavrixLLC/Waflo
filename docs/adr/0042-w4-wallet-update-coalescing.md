# ADR 0042: Wallet update coalescing

Status: Accepted

Provider calls stay outside the ledger transaction. Committed operations upsert idempotent
pass-state work, allowing coalescing while preserving Apple sequence and Google pinned identity.

