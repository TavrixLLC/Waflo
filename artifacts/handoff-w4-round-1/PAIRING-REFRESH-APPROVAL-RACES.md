# Pairing, refresh and approval race safety

Pairing claim is a conditional `PENDING → CLAIMED` transition under its invariant lock. Exactly one
claimant receives a usable challenge; completion remains one-use and device identity remains unique.

Session refresh locks the old session, verifies it is active, removes its refresh hash once and
creates one successor linked by `rotationSource`. Concurrent refresh produces one success, one safe
failure, one successor and one rotation audit. Replaying the old refresh token fails.

Manager decisions use conditional `PENDING → APPROVED|REJECTED` updates with an unexpired predicate.
Approval consumption uses `APPROVED` plus `consumedAt IS NULL` and requires an update count of one.
Concurrent decisions and consumption cannot both win. Dedicated races assert a single audit record
and prevent raw database uniqueness errors from crossing the API boundary.

