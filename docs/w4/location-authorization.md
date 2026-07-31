# Location authorization

Every operation has one authoritative Location from the active device session. The client cannot
choose another Location in the operation body.

Three layers must agree:

1. the pinned Program Version participates at the Location;
2. the Staff member has an active earning or redemption assignment;
3. the device assignment is active and no broader than the Staff assignment.

PostgreSQL guards cross-tenant or over-broad device assignments. Owner/Manager dashboard commands
accept an explicit Location only after tenant and permission validation.

