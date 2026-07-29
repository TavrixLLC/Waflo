# W2 Round 3 final compliance matrix

| Gate finding | Final implementation | Verification |
| --- | --- | --- |
| 1. Template selection applied only a code | Typed versioned catalog supplies goals, rewards, bilingual copy, colors, artwork, layout, and all three platform defaults. Quick Mode applies one atomic replacement map and requires explicit confirmation after user edits. | Unit template/application tests; HTTP persistence test; E2E screenshots 33–35 |
| 2. Generic badge artwork | Waflo-owned SVG registry now includes distinct cookie, cup, car, water drop, star, heart, flower, scissors, donut, shopping bag, general circle, and gift shapes in filled/empty/milestone roles without emoji. | Unit identity/semantic tests; screenshots 33, 35, 36, 37 |
| 3. Missing launch categories | v2 launch list is Coffee, Cookies/Bakery, Car wash, Salon, Barbershop, Restaurant, Retail, and General visits in deterministic order. | Unit required-category assertion; template endpoint/E2E gallery |
| 4. Historical built-in assets could mutate | Library rows are content-addressed from canonical SVG bytes plus library schema version; existing rows are read, never content-upserted. Program versions persist template code and version. Database rejects WAFLO_LIBRARY update/delete. | Historical v1/v2 concurrency regression and direct database immutability test |
| 5. Unsaved preview layout override | Normal preview accepts no client layout. A supplied `layout` query is rejected with `PREVIEW_LAYOUT_OVERRIDE_FORBIDDEN`; rendering uses persisted layout only. | HTTP mismatch test |
| 6. Background selection ignored | Selected processed background is loaded and embedded in Customer Web with readability treatment. Apple and Google emit centralized unsupported-capability warnings. | Unit composer test; HTTP profile tests; screenshots 38–39 |
| 7. Stored asset failures silently fell back | Required and selected assets are read and SHA-256 verified. Missing, corrupt, or digest-mismatched content returns `PROGRAM_ASSET_CONTENT_UNAVAILABLE`; no selected design is silently replaced. | Unit missing/corrupt/digest tests; HTTP missing/corrupt object tests |
| 8. No central capability matrix | One typed catalog covers logo, hero/background, colors, text, back content, links, locations, expiry, custom stamps, and barcode for Customer Web, Apple Wallet, and Google Wallet. Studio guidance and preview warnings consume it. | Unit completeness test; E2E screenshot 39 |
| 9. Preview cache rewrote output | Canonical SHA-256 key is computed before rendering. Valid hits read and verify immutable output without rendering or storage writes. Organization advisory locking serializes identical misses; immutable object writes are conditional. | Counting-storage concurrency test proves one miss write and no hit write |
| 10. Publication audit was non-atomic | Publication, supersession, trial start, command state, and all required audit events share one serializable transaction. Replays return the command result without duplicate events. | Failure-injection rollback and replay cardinality tests |
| 11. Database guards incomplete | PostgreSQL triggers cover all visual/reward asset tenants, child organization/version consistency, protected version/child writes and deletes, and immutable library assets. The only published transition allowed is configuration-preserving PUBLISHED → SUPERSEDED. | Direct PostgreSQL regression tests |
| 12. Lists not paginated | Programs, assets, and version history return stable cursor envelopes `{ items, nextCursor }`; dashboard loaders append pages. | HTTP tests for all three resources; screenshot 40 |
| 13. Portable ZIP contained `.pnpm-store` | Builder excludes dependency/build/cache/volume/runtime data and environment files. Inspector explicitly treats `.pnpm-store` as forbidden. | Final archive inspection and archive listing log |

## Final gate

Every command required by the Round 3 prompt exited 0. Detailed counts and log names are in `TEST-SUMMARY.md`.

Scope remained W2-only; no W3 domain implementation was introduced.

