# Round 3 database guards

Migration `20260728190000_w2_round3_template_preview_guards` extends tenant isolation and historical immutability at the PostgreSQL layer. Migration `20260728200000_w2_round3_preview_revision` adds the exact preview revision required for validation.

## Tenant asset guards

`program_visual_themes` verifies that every non-null asset belongs to the program version organization:

- logo
- hero
- background
- filled stamp
- empty stamp
- default milestone

`reward_visual_overrides` verifies the reward-specific stamp asset against the owning version organization.

## Organization/version consistency

Before insert or update, triggers verify organization and version consistency for:

- generated previews
- validation runs
- Test Mode sessions
- publish commands

Publish commands additionally verify program/version and published-version/program relationships.

## Protected versions

- PUBLISHED configuration cannot be changed.
- The only allowed PUBLISHED lifecycle transition is configuration-preserving `PUBLISHED → SUPERSEDED`.
- SUPERSEDED rows are fully immutable.
- PUBLISHED and SUPERSEDED rows cannot be deleted.

## Protected child configuration

Insert, update, and delete are rejected for protected-version rows in:

- program translations
- stamp rules
- reward definitions
- program locations
- visual themes
- reward translations
- reward visual overrides

## Immutable library rows

WAFLO_LIBRARY merchant assets reject update and delete regardless of service-layer behavior.

## Direct database tests

The concurrency/database project bypasses services and attempts:

- cross-tenant optional visual and reward override assets;
- organization/version mismatches for previews, validations, sessions, and publish commands;
- published/superseded configuration and child mutation/deletion;
- WAFLO_LIBRARY update/deletion.

All forbidden writes are rejected by PostgreSQL. The final migration status reports 13 migrations and an up-to-date schema.

