# Program state machine

`DRAFT -> VALIDATED -> TEST -> PUBLISHED`; validation may publish directly. `PUBLISHED -> PAUSED -> PUBLISHED`; `PUBLISHED -> ARCHIVED`; `PAUSED -> ARCHIVED`. `SCHEDULED` is represented for future scheduling; `SUSPENDED` is reserved for Waflo policy.
