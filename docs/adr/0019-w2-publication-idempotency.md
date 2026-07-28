# ADR 0019: Publication idempotency

A caller-provided UUID command key is unique per organization. Replays return the recorded command and cannot create a second published version or second trial.
