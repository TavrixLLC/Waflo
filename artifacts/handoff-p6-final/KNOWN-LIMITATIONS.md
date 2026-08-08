# Known limitations

## Exact published Customer Web renderer in Studio

`GET /v1/organizations/:organizationId/programs/:programId/preview` currently selects `currentDraftVersion ?? currentPublishedVersion`. It has no source selector and does not return a stable published-renderer reference that Studio can request independently of the current draft.

Studio therefore renders a truthful **Published card summary**, not a screen labeled as an exact published Customer View. Closing this requires an explicit published/draft preview contract or stable published renderer reference; that contract change is outside P6.

## Wallet providers

Provider onboarding remains outside the merchant UI where it is not already implemented. Preview availability does not establish production configuration or certification. Successful publication does not guarantee an immediate refresh of an already installed Apple or Google Wallet pass.

## Customer-specific sharing

Studio exposes the public enrollment/join path according to lifecycle and capability truth. Although enrolled-card backend behavior exists, Studio does not currently construct a customer-specific enrolled-card deep link.

## Mobile handoff

The backend M2 contract handoff is complete and pinned to `0cc39d9ecb39a34fdbd91498e55b6d6ac35c281e`. Adoption and reconciliation in the separate Flutter repository remain outside this repository and outside P6.
