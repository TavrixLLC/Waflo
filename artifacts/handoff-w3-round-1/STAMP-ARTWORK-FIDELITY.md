# Stamp artwork fidelity

## Locked behavior

Every slot is either `FILLED` or `EMPTY`. Filled slots use the filled asset selected by the Membership's `enrollmentProgramVersionId`; empty slots use that pinned Version's empty asset. Reward readiness is text outside the grid.

The shared `PublishedMembershipStampRenderInput` includes organization, Program, pinned Version, Membership, renderer schema, locale, goal/progress, layout, theme, mandatory filled/empty artwork, asset digests, and output profile. Profiles are `JOIN_PREVIEW`, `CUSTOMER_WEB`, `APPLE_WALLET`, and `GOOGLE_WALLET`.

## Safety and determinism

- Inline library artwork and processed merchant variants are supported.
- Processed object bytes are SHA-256 verified before rendering.
- Missing or corrupt selected artwork returns an explicit unavailable/dead-letter result; there is no generic-circle fallback.
- Render configuration and visual digests are deterministic.
- The Google progress cache is immutable and keyed by the visual digest.
- Public SVG/PNG output excludes names, emails, QR payloads, credentials, raw object keys, and private identifiers.
- ROW, GRID, PATH, and RING placement is retained where supported, with locale/RTL input preserved.

## Surface evidence

- Public all-empty joins: `screenshots/04-english-join-page.png` and `05-arabic-rtl-join-page.png`.
- Private Customer Card: `screenshots/08-customer-card-0-of-8-membership-qr.png` and `32-arabic-customer-card.png`.
- Apple Test Adapter strip: `provider-artifacts/apple-strip.png`.
- Google mapping: `provider-artifacts/google-loyalty-object.redacted.json`.

Unit regressions reject check-icon/CSS-dot final rendering and verify equivalent filled/empty placement across profiles.
