# ADR 0032: Ledger as authority

Status: Accepted

Production progress is derived only from append-only `LoyaltyLedgerEntry` events. Commands and
projection updates commit atomically with those events. Corrections therefore use compensating
events and never overwrite a balance.

