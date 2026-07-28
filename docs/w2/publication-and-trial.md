# Publication and trial

Publication creates a ProgramPublishCommand keyed by organization and idempotency key. An organization lock serializes concurrent publication. The draft becomes immutable and current; the previous published version becomes superseded. A 15-day trial starts in the same transaction only when the billing profile is still `PENDING_ACTIVATION` and has no trial start. Paid organizations are not moved into trial.
