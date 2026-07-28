# Test Mode

Test Mode uses ProgramTestSession and append-only ProgramTestEvent records. It has no Customer or Membership relation. Stamp commands require UUID idempotency keys. Reward unlocks are synthetic events, redemptions are limited by the reward definition, and reset clears the projection while recording a reset event.
