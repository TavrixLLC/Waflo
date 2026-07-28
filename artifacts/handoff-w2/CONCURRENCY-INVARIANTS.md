# Concurrency invariants

1. One active editable version per program.
2. Draft updates require the current revision.
3. Program capacity uses the organization advisory lock.
4. Test event keys are unique per session.
5. Publish keys are unique per organization.
6. Publication, pointer changes, supersession, and trial activation share one transaction.
7. Preview cache keys include version, progress, and configuration digest.
