# Round 2 focused evidence

## Apple global ordering and updated serials

`raw-test-output/w3-round2-focused-concurrency.txt` records the passing real-PostgreSQL
test that:

1. starts two Apple passes at different sequence states;
2. updates A and polls;
3. updates B after the saved `lastUpdated`;
4. polls again and returns B but not A;
5. proves duplicate A replay does not allocate;
6. proves concurrent A/B updates receive distinct later values;
7. rejects malformed and overflowing cursor strings;
8. returns transfer invalidation on the next poll;
9. returns all 502 matching registered passes.

## Lifecycle races

The same output records the passing lifecycle race test. It uses API/service operations
for pause/archive/restore versus enrollment, no-email and email-confirmed transfer, and
Wallet issue processing. The test drains synchronization jobs and verifies Program,
Membership credential, and pass-state invariants after each admissible race outcome.

## Multi-batch reconciliation

The stable-cursor test creates 501 initial passes and one later pass. It processes a
500-row first page, replays that cursor without incrementing progress, resumes after an
interruption, and completes 502 deterministic RECONCILE commands with one audit event.

## Locale and RTL

- `screenshots/03-program-chooser.png`
- `screenshots/03b-program-chooser-arabic.png`
- `screenshots/05-arabic-rtl-join-page.png`
- final W3 result logs in `raw-test-output/`

The browser assertions verify both the URL parameters and `dir="rtl"` after selecting
the Arabic Program.

## Archive hygiene

`raw-test-output/archive-inspection.txt`,
`raw-test-output/archive-extraction.txt`, and the ZIP checksum prove the delivered
portable archive is readable and contains no `*.tsbuildinfo`, `tmp/`, caches, logs, or
test runtime directories.

