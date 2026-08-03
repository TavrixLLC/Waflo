# P3 Card Builder dogfood report

## Summary

- Scope: authenticated Merchant Dashboard creation flow from Template Gallery into the routed Card Builder.
- Environment: local development stack at `http://localhost:3001`, English and Arabic, 1280px desktop and 390px mobile.
- Result: 0 open blocking issues; 3 presentation defects found and resolved during this pass.
- Browser quality: no page errors, no CSP overlay, and no application console errors. Console output was limited to React DevTools, HMR, and Fast Refresh development messages.

## Tested journey

1. Open Loyalty Cards and Template Gallery.
2. Select Artisan Bakery and initialize one DRAFT Program.
3. Edit the internal name and stamp goal.
4. Observe `Unsaved changes` → `Saving…` → `Saved` with one revisioned PATCH.
5. Reload the saved draft.
6. Inspect English and Arabic layouts.
7. Inspect Customer, Apple Wallet, and Google Wallet previews from the real local renderer.
8. Inspect the 390px editor and full-screen preview sheet.

## Resolved findings

### ISSUE-001 — Desktop action bar overlapped the editor

- Severity: Medium
- Category: UX / responsive layout
- Status: Resolved
- Evidence before: `screenshots/builder-real-desktop.png`
- Evidence after: `screenshots/builder-real-desktop-refined.png`
- Resolution: the desktop action bar now participates in document flow; only the compact mobile action bar remains sticky.

### ISSUE-002 — Mobile exposed competing primary actions

- Severity: Medium
- Category: UX / visual hierarchy
- Status: Resolved
- Evidence before: `screenshots/builder-real-mobile-390.png`
- Evidence after: `screenshots/builder-real-mobile-390-refined.png`
- Resolution: the 390px footer now presents Preview as secondary and Review as the sole dominant action.

### ISSUE-003 — Wallet tab name clipped at 1280px RTL

- Severity: Low
- Category: RTL / responsive typography
- Status: Resolved
- Evidence before: `screenshots/builder-real-google-ar-final.png`
- Evidence after: `screenshots/builder-real-google-ar-tab-fixed.png`
- Resolution: preview tabs now wrap readable Wallet brand names instead of truncating them.

## Notes

- The QA draft remained `DRAFT`; no publish action was invoked and no trial was started.
- Test Mode, Ledger, Membership, Wallet installation, billing, and production redemption paths were not mutated by dogfood actions.
- The Next.js development toolbar appears in local screenshots and is not part of the product UI.
