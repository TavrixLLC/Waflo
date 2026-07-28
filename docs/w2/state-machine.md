# State machine

Operational states are `DRAFT`, `VALIDATED`, `TEST`, `SCHEDULED`, `PUBLISHED`, `PAUSED`, `ARCHIVED`, and `SUSPENDED`. The normal path is `DRAFT -> VALIDATED -> TEST -> PUBLISHED`; publication may also follow validation directly. Published programs may pause, resume, or archive. SUSPENDED is system-controlled. Version states are `DRAFT`, `VALIDATED`, `TEST_READY`, `PUBLISHED`, `SUPERSEDED`, and `ABANDONED`.
