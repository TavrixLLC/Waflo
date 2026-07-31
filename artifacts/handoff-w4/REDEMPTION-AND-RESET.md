# Redemption and reset

Milestone redemption never resets the grid. Final redemption appends `REWARD_REDEEMED` followed by
`CYCLE_RESET`, then exposes zero progress, the next cycle and incremented completed-cycle count.
Before redemption the main grid remains all filled. The lifecycle integration test verifies the
exact five-event correction-to-reset sequence.

