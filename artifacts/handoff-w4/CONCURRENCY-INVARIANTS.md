# Concurrency invariants

PostgreSQL advisory locks serialize Membership, operation, lifecycle and device invariants.
The W4 suite exercises 100 simultaneous compatible same-key requests and different-key threshold
crossing. Exactly one stamp event is committed for the shared key and entitlement grouping remains
unique.

