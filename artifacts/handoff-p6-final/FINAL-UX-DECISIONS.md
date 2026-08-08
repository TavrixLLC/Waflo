# Final UX decisions

- Merchant-facing copy says Loyalty Card; internal backend Program naming remains unchanged.
- Quick Mode is the primary Builder experience. The legacy quick-create compatibility entry remains query-scoped and is not presented as a wizard.
- The progression rail separates the current page from domain readiness. It uses completion/pending/blocked language instead of a contradictory generic “Current”.
- All merchant dialogs remain geometrically centered at every approved viewport, including RTL. Long dialogs scroll internally; busy publication dialogs remain locked.
- Loading, empty, unavailable, and failed states are distinct. A failed Builder or Studio load ends in actionable UI instead of an indefinite spinner.
- Test Mode maps expected policy failures to merchant-safe guidance that states what happened, what remains safe, and what to do next.
- Live Studio uses “Published card summary” because the current preview endpoint cannot explicitly select an immutable published renderer source.
- Saved draft preview generation is independent of whether the card already has a published version. The live summary remains published truth until publication.
- Customer Web, Apple Wallet, and Google Wallet tabs are selectable preview surfaces; provider readiness is shown separately.
- The active stamp grid has exactly two visual states: FILLED and EMPTY. Reward indicators remain outside the grid.
