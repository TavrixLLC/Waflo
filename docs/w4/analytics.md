# Operational analytics

The worker rebuilds deterministic day aggregates from committed ledger and risk data, bucketed in
each Program Version's operational timezone. Metrics include stamp operations and units, reward
unlocks/redemptions, completed cycles, reversals, overrides and risk counts.

Dashboard queries use aggregate tables, never static demo arrays or full-ledger scans. Overview is
available at the basic gate; program, Location, Staff and cohort detail use the existing plan
features. Tables accompany charts for accessibility.

Local figures are evidence of correctness, not a production capacity claim.

