# W2 audit coverage

Round 4 adds and verifies:

| Event | Emission rule |
| --- | --- |
| `program.version_created` | One event when a new draft version is created from published history |
| `program.test_reward_redeemed` | One event for a successful synthetic reward redemption |
| `program.preview_generated` | Cache miss only; never on a valid cache hit |
| `program.validation_failed` | Validation run contains errors |
| `program.validated` | Passed or valid-with-warning validation |

State-changing program, lifecycle, asset, billing, validation, Test Mode, and publication mutations
use the transaction-scoped audit writer whenever domain state and audit state must commit together.

Idempotent command replay returns prior state without duplicating events. Tests assert exact
cardinality for preview miss/hit, validation failure, version creation, reward redemption, trial
activation, and publication. Publication failure injection confirms command, version, pointers,
trial, and audit all roll back together.

Metadata is limited to safe identifiers, revision/fingerprint state, usage/limit values, and public
machine-readable outcomes; it does not include secrets, object bytes, or private suspension reasons.

