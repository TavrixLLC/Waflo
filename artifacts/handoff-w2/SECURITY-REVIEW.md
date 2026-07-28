# W2 security review

Controls cover organization-scoped lookups, role permissions, immutable published versions, revision conflicts, advisory locks, publish idempotency, trial single-start, safe filenames, image signatures, MIME allowlisting, 2 MB decoded upload limits, organization-scoped local object keys, escaped renderer text, and audit events.

Known deployment action: replace local filesystem storage with a private object-storage adapter and signed, authorization-checked reads before production use.
