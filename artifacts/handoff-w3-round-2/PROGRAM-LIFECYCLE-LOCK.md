# Program lifecycle lock

`withProgramLifecycleInvariantLock()` centralizes the transaction and advisory-lock
contract for all repaired W3 paths.

The documented order is:

1. Organization invariant lock.
2. `program-lifecycle:<programId>`.
3. Enrollment, Membership, credential, command, or transfer lock.
4. Provider/pass lock.

Pause, resume, archive, restore, public enrollment, transfer completion, and manual
reconciliation enter this contract. Program transitions re-read current status after
locking. Enrollment re-reads Organization status, billing entitlement, Program status,
current published Version, and enrollment-open policy. Transfer re-reads Organization,
Customer, Membership, credential, and Program eligibility before replacement Wallet
identities are created.

The worker uses stable `(createdAt, id)` cursor paging without a `snapshotAt` upper
bound. A lifecycle transition serializes pass creation at the Program boundary, and
the worker continues until no eligible passes remain. Rows that become eligible later
are not intentionally omitted by a frozen timestamp.

The focused concurrency suite races pause/archive/restore against enrollment, pause and
archive against both transfer paths, and lifecycle transition against Wallet issuance.
It accepts either serialized success or a stable conflict, then proves:

- no enrollment survives under a committed non-enrollable state;
- no new pass remains active under paused or archived state;
- lifecycle jobs drain all required passes;
- exactly one active Membership credential remains.

