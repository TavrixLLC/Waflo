# Waflo P4A Loyalty Studio implementation report

## Current Studio audit

The baseline Studio exposed 16 system-shaped destinations after the approved Builder, plus separate enrollment/Wallet and lifecycle controls. The underlying behavior was retained and recomposed as follows.

| Current section | Merchant purpose | Domain ownership | Duplicated with Builder? | Quick relevance | Advanced relevance | P4A destination |
|---|---|---|---:|---:|---:|---|
| Overview | Identify and name the card | Program/draft | Yes | High | Low | Overview read-only summary; Edit design |
| Earning rules | Define how stamps are earned | Loyalty policy | Partial | High | High | How it works; advanced disclosure for operational limits |
| Rewards & milestones | Define customer reward and redemption rules | Reward definitions | Partial | High | High | How it works; presentation in Builder, redemption behavior in Studio |
| Locations | Select participating locations | Program locations | No | High | Low | Customers & locations |
| English content | Customer-facing copy | Version translations | Yes | High | Medium | Card Builder only; Studio summary |
| Arabic content | Customer-facing RTL copy | Version translations | Yes | High | Medium | Card Builder only; Studio summary |
| Visual identity | Color and visual presentation | Visual theme | Yes | High | Medium | Card Builder only; Studio preview and Edit design |
| Artwork | Stamp/logo/background assets | Program assets | Yes | High | High | Card Builder only |
| Stamp layout | Stamp composition | Visual theme/layout | Yes | Medium | High | Card Builder Advanced settings |
| Customer Web | Rich customer preview and layout | Preview composer | Yes | High | Medium | Builder preview and Preview surface details |
| Apple Wallet | Provider-truthful preview labels | Wallet preview config | Yes | Medium | High | Builder preview and Preview surface details; Launch readiness |
| Google Wallet | Provider-truthful preview labels | Wallet preview config | Yes | Medium | High | Builder preview and Preview surface details; Launch readiness |
| Policies | Limits, purchase rules, correction windows | Loyalty policy | No | Low | High | How it works → Advanced earning and redemption rules |
| Validation | Required checks and issue routing | Publication guards | No | High | Medium | Launch → Readiness checks |
| Test Mode | Isolated synthetic reward cycle | Test-session domain | No | High | Medium | Test guided workflow |
| Versions | Inspect saved history and draft lifecycle | Version/lifecycle domain | No | Low | High | Settings → Change history |

Enrollment and customer access now sit in Customers & locations. Wallet provider readiness is summarized in Launch. Pause, archive, restore, abandon-draft behavior, and change history sit in Settings.

## Information architecture decisions

- Replaced the 16-item system navigation with six merchant tasks: Overview, How it works, Customers & locations, Test, Launch, and Settings.
- Added a four-stage card journey rail: Design, Checks, Test, Live.
- Kept the loyalty card and its real Customer/Apple/Google preview as the visual anchor.
- Moved launch-blocking information into Launch and routes each issue to the area that can fix it.
- Kept operational limits, correction windows, manager exceptions, lifecycle actions, and change history behind contextual disclosures or Settings.
- Preserved the existing APIs, autosave, optimistic concurrency, validation, test-session isolation, publish guards, and lifecycle actions.

## Old-to-new section mapping

| New area | Baseline capabilities gathered here |
|---|---|
| Overview | Identity, customer preview, status, next action, earning/reward summary, locations summary, last changed, design ownership |
| How it works | Earning summary, reward summary, reward validity, redemption approvals, per-purchase/daily limits, purchase minimums, timezone, correction windows, manager exceptions |
| Customers & locations | Location eligibility, enrollment/access behavior, language selection, customer entry settings |
| Test | Start synthetic customer, add/correct/reset stamps, reach and redeem reward, verify cycle reset, test activity |
| Launch | Setup/location summary, readiness checks, issue Fix routing, demo-cycle status, Wallet/provider readiness, plan limits, existing publish action |
| Settings | Design ownership summary, lifecycle controls, pause/resume/archive/restore/abandon behavior, change history |

## Builder/Studio field ownership

| Merchant-facing field group | Authoritative editor | Studio presentation |
|---|---|---|
| Dashboard/card identity and localized card name | Builder | Read-only identity with Edit design |
| Template, colors, visual style, artwork, stamp layout | Builder | Real preview and read-only summary |
| English and Arabic customer copy | Builder | Read-only summary/preview |
| Reward type, customer-facing name, description, and preview presentation | Builder | Read-only reward summary |
| Customer/Apple/Google preview-surface configuration | Builder Advanced settings | Real platform tabs; Wallet readiness in Launch |
| Reward validity, redemption count, manager approval | Studio | How it works → Advanced rules |
| Per-purchase and daily earning limits | Studio | How it works → Advanced rules |
| Minimum purchase/currency and operational timezone | Studio | How it works → Advanced rules |
| Staff/manager correction windows and manager exception rule | Studio | How it works → Advanced rules |
| Location participation and customer enrollment/access | Studio | Customers & locations |
| Testing, readiness, publishing, lifecycle, history | Studio | Test, Launch, Settings |

Builder operational inputs that duplicated Studio were removed. Existing preview-surface controls were moved into Builder Advanced settings so the capability remains accessible with one owner.

## Overview redesign

Overview now answers card identity, merchant-facing lifecycle state, next action, customer view, earning/reward summary, participating locations, last change, readiness direction, and design ownership without KPI filler. The Builder handoff states “Card design complete” and truthfully points to testing or readiness; it never implies publication.

## Quick versus advanced behavior

The default experience shows only the card summary, earning/reward summary, locations, guided Test, and Launch. Reward operations and policy controls are inside Advanced earning and redemption rules. Lifecycle controls and history are isolated in Settings. Launch blockers are never hidden.

## Test experience

Test is a six-step guided synthetic flow: start demo customer, add stamps, reach reward, use reward, verify reset, and finish. It uses the existing test-session APIs, retains purchase/currency, manager-approval, correction-window behavior, and clearly states that no real customer activity is created.

## Launch entry point

Launch composes existing readiness checks, locations, demo-cycle status, Wallet provider health, plan limits, issue Fix routing, and the existing guarded publish action. It does not bypass validation or implement a new publication contract.

## Lifecycle presentation

The UI maps existing domain truth into Draft, Ready to launch, Live, Paused, and Archived. Scheduled and suspended states remain truthful exceptional states rather than being collapsed into an incorrect lifecycle label. High-impact actions retain consequence copy and confirmation behavior.

## Arabic/RTL

All new IA labels, summaries, handoff copy, lifecycle descriptions, Test guidance, Launch content, conflict recovery, settings, Wallet empty state, and mobile navigation have Arabic variants. RTL reverses directional affordances and layout order while brand names remain Apple Wallet, Google Wallet, and Waflo. Mixed merchant values use appropriate direction handling.

## Responsive behavior

Automated overflow and navigation checks cover 1440, 1280, 1024, 768, 390, and 360 widths. Desktop uses a task rail; at 820px and below it becomes a discoverable sticky menu rather than a compressed sidebar. Actions do not cover content, long labels wrap, previews remain usable, and advanced areas remain reachable.

## Accessibility

- Semantic navigation, one page heading, area headings, regions, tabs, dialogs, live save status, and non-color status text were retained or added.
- Keyboard activation of Studio navigation is covered.
- The focused Axe scan reports no serious or critical violations.
- Active-navigation contrast was corrected after browser verification.
- Mobile touch controls use at least the existing 48px interaction target model.

## Files changed

- `apps/merchant-dashboard/components/program-studio-presentation.ts`
- `apps/merchant-dashboard/components/program-studio-editor.tsx`
- `apps/merchant-dashboard/components/program-card-builder.tsx`
- `apps/merchant-dashboard/components/program-enrollment-settings.tsx`
- `apps/merchant-dashboard/components/programs-screen.tsx`
- `apps/merchant-dashboard/app/globals.css`
- `playwright.config.ts`
- `tests/unit/merchant-loyalty-studio.test.ts`
- `tests/e2e/merchant-loyalty-studio.spec.ts`
- `tests/e2e/merchant-loyalty-studio-evidence.spec.ts`
- `tests/e2e/template-gallery-fixtures.ts`
- `tests/e2e/merchant-loyalty-cards.spec.ts`
- `tests/e2e/merchant-template-gallery.spec.ts`
- `artifacts/uiux/loyalty-studio-p4a/*`

## Tests and exit codes

| Command/check | Result |
|---|---|
| `pnpm format` | Exit 0 |
| `pnpm lint` | Exit 0 |
| `pnpm typecheck` with temporary local `DATABASE_URL` | Exit 0; 26/26 packages |
| Merchant dashboard typecheck | Exit 0 |
| Merchant dashboard production build | Exit 0 |
| Focused Studio unit test | Exit 0; 9/9 |
| `pnpm test` first attempt | Exit 1; local PostgreSQL was not running, before tests started |
| `pnpm test` after starting standard repository services | Exit 0; 39 files, 393 tests |
| Focused Studio Playwright | Exit 0; 6/6 including evidence generation |
| Existing Card Builder Playwright | Exit 0; 14/14 |
| Loyalty-card library Playwright | Exit 0; 7/7 |
| Template Gallery Playwright first run | Exit 1; one test saw sandbox-blocked Google Fonts |
| Template Gallery Playwright after deterministic font interception | Exit 0; 10/10 |
| `git diff --check` | Exit 0 |

The full Vitest regression totals were: unit 206, integration 58, HTTP 32, concurrency 93, and failure-path 4. Existing pg client deprecation warnings remain outside P4A and did not fail the suite.

## Screenshot evidence

1. `01-studio-overview-draft-desktop.png`
2. `02-studio-overview-ready-desktop.png`
3. `03-studio-overview-live-desktop.png`
4. `04-how-it-works.png`
5. `05-customers-locations.png`
6. `06-test-mode.png`
7. `07-launch-readiness.png`
8. `08-settings-advanced.png`
9. `09-builder-to-studio.png`
10. `10-mobile-390-overview.png`
11. `11-mobile-navigation.png`
12. `12-arabic-desktop.png`
13. `13-arabic-mobile.png`
14. `14-paused-state.png`
15. `15-archived-state.png`
16. `16-before-after-studio-contact-sheet.png`

All evidence is in `artifacts/uiux/loyalty-studio-p4a`.

## Backend/API changes

None. No database schema, API contract, provider payload, ledger, billing, tenancy, security, lifecycle, audit, or publication-guard behavior changed.

## Deferred P4B items

- A publication-specific redesign beyond the existing guarded publish action.
- A dedicated consolidated launch-readiness API, if later desired; P4A composes existing supported data.
- Publication scheduling or new lifecycle transitions.
- Provider onboarding/configuration UX beyond truthful current readiness.

## Remaining weaknesses

- Studio is still entered through existing dashboard view state rather than a dedicated shareable `/studio` deep link.
- An organization with no Wallet provider records can only be shown as “no connection status available”; P4A cannot infer configuration that the provider endpoint does not return.
- The four-stage journey rail scrolls within its own container on very narrow screens so all stages remain reachable without causing page overflow.
- Older real-infrastructure platform evidence specs still encode portions of the pre-P4A Studio navigation; focused P4A, Builder, Gallery, card-library, and full non-browser regressions are green, but a future evidence refresh should migrate those legacy screenshot journeys.

No commit was created.
