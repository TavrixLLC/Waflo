# W4 final compliance matrix

| Contract area | Implementation | Evidence |
| --- | --- | --- |
| Ledger authority | Append-only events, commands, sequence, versioned HMAC | `LEDGER-DESIGN.md`, direct guard tests |
| Projection | Atomic reducer, exact source guard, verify/rebuild | `PROJECTION-INVARIANTS.md` |
| Earn/reward/redeem | Pinned policy, entitlement uniqueness, final reset | `STAMP-POLICY.md`, `REDEMPTION-AND-RESET.md` |
| Reversal/correction | Compensating events and dependency checks | `REVERSALS.md` |
| Staff devices | One-time pairing, Ed25519, nonce, Location | pairing/signing documents and HTTP tests |
| Merchant operations | Customer, Membership, risk, analytics, exports, privacy | dashboard/API and screenshots |
| Wallet | Post-commit coalesced Test Adapter updates | `WALLET-UPDATE-COALESCING.md` |
| Workers | Expiry, analytics, exports, privacy, integrity, cleanup | `PROCESS-CLEANUP.md` |
| Launch | Security, performance, accessibility, runbooks | corresponding summaries |
| Flutter boundary | Contract and fixtures only; no Flutter source | `FLUTTER-HANDOFF.md`, `NO-FLUTTER.md` |
| Quality gate | 17/17 core commands; 299 Vitest; browser/accessibility repeated | `TEST-SUMMARY.md`, `raw-test-output/quality-gate-summary.json` |
| Evidence | 42 PNGs including contact sheet, dimensions and SHA-256 | `SCREENSHOT-MANIFEST.md` |
| Portable source | exclusions inspected after extraction; SHA-256 supplied | archive and `.sha256` file |

External Apple and Google device certification is not claimed.
