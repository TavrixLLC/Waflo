# Versioned template catalog

The source of truth is `packages/contracts/src/program-template-catalog.ts`. A definition is selected by stable `code` plus explicit integer `version`; the applied values are copied into the merchant-owned program version so later catalog releases do not silently alter it.

## v2 launch catalog

| Code | Category | Goal | Final reward | Filled / empty | Milestone | Layout | Customer |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `COFFEE` | food-and-beverage | 8 | A coffee on us | coffee cup | gift | GRID | CARD |
| `COOKIES` | food-and-beverage | 8 | Your favorite cookie is free | cookie | gift | GRID | CARD |
| `CAR_WASH` | automotive | 6 | A premium wash upgrade | car | water drop | PATH | HERO |
| `SALON` | beauty-and-wellness | 6 | A complimentary treatment | flower | heart | RING | CARD |
| `BARBERSHOP` | beauty-and-wellness | 6 | A complimentary service | scissors | star | ROW | CARD |
| `RESTAURANT` | food-and-beverage | 10 | A house special | donut | gift | GRID | CARD |
| `RETAIL` | services-and-retail | 8 | A special shopping reward | shopping bag | gift | GRID | CARD |
| `GENERAL_VISITS` | general | 8 | Your visit reward | general circle | gift | GRID | CARD |

Every row also defines:

- English and Arabic name, description, program copy, messages, instructions, terms, reward name/description, and redemption instructions
- background, foreground, accent, secondary, and muted colors
- versioned filled, empty, and milestone artwork references
- layout configuration, stamp size, and spacing
- Customer Web variant
- Apple header, secondary, barcode, and back-content defaults
- Google title, subtitle, details, and barcode defaults

Templates with goals of eight or more include an entitled midpoint milestone in Pro Mode. All include a final reward at the exact goal.

## Quick Mode application

`applyTemplateToDraft()` replaces the template-controlled configuration as one operation:

- template code/version
- goal and earning rule
- bilingual customer copy
- rewards and milestones
- colors
- filled/empty/milestone artwork
- layout and layout configuration
- Customer Web, Apple, and Google preview defaults

The internal program name and explicitly selected locations are preserved. Once any template-controlled field has been edited, choosing another template opens a confirmation listing the replacement categories. “Keep my edits” cancels; “Replace settings” applies the complete target template.

## Historical compatibility

Legacy v1 definitions remain resolvable for previously created versions. New launch selection returns deterministic latest v2 definitions. `LoyaltyProgramVersion.baseTemplateCode` and `baseTemplateVersion` preserve the exact adoption point.

