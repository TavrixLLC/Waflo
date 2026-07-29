# W3 repair round 1 compliance matrix

| Requirement | Result | Evidence |
| --- | --- | --- |
| Two-state selected stamp artwork on all W3 surfaces | Pass | [Stamp artwork fidelity](STAMP-ARTWORK-FIDELITY.md), `provider-artifacts/apple-strip.png` |
| One pinned-version render input | Pass | `packages/stamp-engine/src/index.ts`, `apps/api/src/programs/published-stamp-render.ts` |
| Customer Card removes checks/CSS-dot final renderer | Pass | `tests/unit/w3-round1-repairs.test.ts`, screenshot `08-customer-card-0-of-8-membership-qr.png` |
| Join preview is real 0/goal artwork | Pass | screenshots `04-english-join-page.png`, `05-arabic-rtl-join-page.png` |
| Single-program root canonical route | Pass | screenshot `03a-single-program-root-arabic.png`; [single-program root](SINGLE-PROGRAM-ROOT.md) |
| Customer mutation CSRF and exact Origin | Pass | [Customer CSRF](CUSTOMER-CSRF.md), `evidence/customer-csrf-cross-merchant-rejection.json` |
| Dedicated W3 integration suite | Pass | 5 focused tests; full integration project 49/49 |
| Dedicated W3 concurrency suite | Pass | 7 focused tests; full concurrency project 67/67 |
| Paginated, resumable Program Wallet sync | Pass | [Program Wallet sync](PROGRAM-WALLET-SYNC.md), `evidence/program-wallet-sync-multi-batch.json` |
| Centralized Apple update tags | Pass | [Apple update tags](APPLE-UPDATE-TAGS.md) |
| Race-safe Apple registration | Pass | [Apple registration race](APPLE-REGISTRATION-RACE.md) |
| Apple selected artwork/nonblank branding/package | Pass in Test Adapter | `provider-artifacts/apple-test-adapter.pkpass`, `apple-package-inspection.json` |
| Apple PKCS#12 key/leaf/chain/identifier checks | Pass locally | Unit tests; external device/APNs certification pending |
| Google Class logo and Object-only member state | Pass in local mapping | Redacted Class/Object JSON under `provider-artifacts/` |
| Truthful provider health | Pass | [Provider health](PROVIDER-HEALTH.md) |
| Accurate evidence labels | Pass | [Evidence integrity](EVIDENCE-INTEGRITY.md), [manifest](SCREENSHOT-MANIFEST.md) |
| Format/lint/typecheck/build/database/test gates | Pass | [Test summary](TEST-SUMMARY.md), raw output |
| W1/W2 browser and accessibility regressions | Pass | 14/14 and 3/3 |
| W3 E2E twice and accessibility twice | Pass | 7/7 twice; 1/1 twice |
| Secret/no-W4/archive gates | Pass | `SECRET-SCAN.md`, `NO-W4.md`, archive inspection logs |
| Real Apple certification | Pending | [External certification](EXTERNAL-CERTIFICATION.md) |
| Real Google certification | Pending | [External certification](EXTERNAL-CERTIFICATION.md) |
