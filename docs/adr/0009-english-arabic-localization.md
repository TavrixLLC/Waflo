# ADR 0009: English and Arabic localization

- Status: Accepted
- Date: 2026-07-27

## Context

English and Arabic are equal W1 product languages, and Arabic requires structural RTL rather than translated strings alone.

## Decision

Use locale-prefixed routes, explicit document `lang`/`dir`, shared locale utilities, Noto Sans Arabic, logical CSS/layout rules, mirrored navigation, and recipient-locale email templates.

## Consequences

Screens, forms, tables, dialogs, and notifications are testable in both directions. New core copy must enter the translation dictionaries/pattern rather than be added as an untracked literal.
