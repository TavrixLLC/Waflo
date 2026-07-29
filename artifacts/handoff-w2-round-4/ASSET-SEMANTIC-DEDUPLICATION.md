# Asset semantic deduplication

## Selected model

Round 4 uses Model A: unique merchant asset identity is
`(organizationId, sha256Digest, category)`.

This preserves binary deduplication within a semantic category while allowing identical bytes to
represent different visual roles.

## Upload outcomes

| Existing state | Result | Storage behavior |
| --- | --- | --- |
| Active, ready, same category, valid variants | Same row, `REPLAYED` | Read/verify only; no rewrite |
| Same bytes, different category | Separate semantic row, `CREATED` | Category-correct variants |
| Archived, same category, valid or repairable | Same canonical row, `RESTORED` | Verify and deterministically rebuild if needed |
| Active row with missing/corrupt variant | Same row, `REPAIRED` | Deterministic variant rebuild |

Archive and restoration audits share the database transaction. Re-upload never reports an archived
inaccessible row as an active success.

Organization locking and the category-aware unique constraint ensure concurrent identical uploads
produce one active semantic row and compatible successful responses without exposing a raw database
uniqueness error.

Historical program versions continue to reference immutable content identity; no re-upload can
replace historical bytes with different content.

