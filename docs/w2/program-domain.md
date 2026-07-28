# Program domain

`LoyaltyProgram` is the operational record. `LoyaltyProgramVersion` holds an editable or immutable configuration. Economics are normalized into StampRule, RewardDefinition, RewardTranslation, and ProgramLocation. Content is normalized into ProgramTranslation. Visual settings live in ProgramVisualTheme and asset references remain separate.

W2 supports only `STAMP` and does not add Customer, Membership, Entitlement, Redemption, or production ledger models.
