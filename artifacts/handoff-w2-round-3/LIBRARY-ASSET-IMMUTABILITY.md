# Library asset immutability

Built-in artwork is reproducible by content, not by a mutable logical key.

## Identity

`apps/api/src/programs/library-artwork.ts` provides canonical UTF-8 SVG bytes for every artwork code/version. `libraryArtworkDigest()` hashes:

1. the library/artwork schema version; and
2. the exact canonical SVG bytes.

The resulting SHA-256 is used as the immutable merchant-asset identity and object key. A changed SVG or schema version necessarily produces a new digest, row, and object address.

## Registration behavior

`ensureBuiltInAssets()`:

- looks up `organizationId + sha256Digest`;
- returns the existing immutable row when present;
- creates a new WAFLO_LIBRARY row when absent;
- never updates `inlineSvg`, digest, or object identity in place;
- returns the exact IDs referenced by the selected template version.

Object writes use an immutable conditional operation. If an object already exists, its bytes are verified rather than overwritten.

## Database enforcement

The Round 3 migration adds a trigger that rejects update or delete of any `merchant_assets` row whose source is `WAFLO_LIBRARY`. Published and superseded program versions and their visual/reward child rows are also protected from mutation or deletion.

## Regression proof

The concurrency/database suite performs the required sequence:

1. create and publish with legacy template/artwork v1;
2. register and adopt v2 in a new draft;
3. supersede v1 by publishing v2;
4. re-read v1 SVG and digest;
5. prove both are unchanged while v2 has its own asset identity.

It also directly attempts a WAFLO_LIBRARY update and delete and verifies PostgreSQL rejects both.

