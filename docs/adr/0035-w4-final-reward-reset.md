# ADR 0035: Final reward reset semantics

Status: Accepted

The final reward remains fully filled until redemption. Successful final redemption appends
redemption then reset, producing a zero-stamp new cycle and incrementing completed cycles.
Milestones never reset progress.

