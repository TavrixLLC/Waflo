# Preview truthfulness and cache

## Persisted configuration only

The normal preview route renders the current persisted draft or published version. Client-provided layout is not a preview override: it is rejected with `PREVIEW_LAYOUT_OVERRIDE_FORBIDDEN`. A normal preview therefore cannot validate an unsaved layout.

Each stored preview records the exact `versionRevision`. Validation accepts only previews for the current revision and matching render fingerprint.

## Deterministic key

`createProgramPreviewCacheKey()` recursively sorts object keys and hashes normalized JSON with SHA-256. Renderer schema version 3 is part of the identity.

The cache input includes:

- renderer schema version
- template code and template version
- version ID and exact revision
- progress, locale, and output profile
- goal, localized visible copy, rewards, and thresholds
- layout, layout configuration, sizing, labels, colors, and per-platform config
- every selected asset identity and processed-variant digest

## Hit path

Before rendering, the service queries the unique `(version, preview type, progress, configuration hash)` identity. A hit:

- reads the existing immutable object;
- verifies its SHA-256 against `contentDigest`;
- updates access metadata;
- returns the bytes with `cacheStatus: HIT`;
- performs no renderer call and no storage write.

Missing or digest-invalid cached content fails truthfully as `PROGRAM_PREVIEW_CONTENT_UNAVAILABLE`.

## Miss and concurrency path

An organization-scoped PostgreSQL advisory transaction lock serializes competing cache misses. The winner resolves and verifies assets, renders once, conditionally writes one immutable object, checks that the version revision did not change, and inserts the cache record. A stale draft produces `PREVIEW_DRAFT_CHANGED`.

`putImmutable()` uses conditional storage semantics. An already-existing key is read and digest-checked; conflicting bytes produce `PROGRAM_PREVIEW_CONTENT_CONFLICT`.

## Selected asset truth

Required filled/empty and every selected optional/reward asset are read from their recorded variant and SHA-256 checked. Missing objects, corrupt bytes, or digest mismatch return `PROGRAM_ASSET_CONTENT_UNAVAILABLE`; merchant-selected content is never replaced with a generic design.

## Proof

The counting-storage concurrency test launches identical preview requests and proves:

- exactly one response is a MISS;
- all others reuse the record;
- exactly one immutable storage write occurs;
- a later unchanged request is a HIT;
- that hit adds no renderer/storage write.

