# M1 mobile device context

`GET /v1/staff/device-context` retains the flat M2 compatibility fields and adds a nested public
mobile projection. In the nested projection, Organization uses its public merchant slug; Staff,
device, and Locations use public IDs. Internal Organization, member, device, session, and Location
database IDs are excluded from that projection. Existing M2 consumers may continue reading the
flat `organizationId`, `locationId`, and `deviceSessionId` fields during migration.

The response contains Organization and Staff display data, role, safe device metadata, current
Location, all active assigned Locations, the platform minimum semantic app version, update state,
and the request ID. Location capabilities are the boolean intersection of the active Staff
assignment and active device assignment. Inactive or revoked Staff assignments, inactive device
assignments, inactive Locations, and cross-tenant Locations are excluded. The current Location must
remain in that intersection or the context is generically inactive.

The endpoint revalidates device/member/session/app policy state while holding the device invariant
lock used by revoke and compromise. This closes revoke-versus-context and policy-change races
without changing loyalty, Ledger, reward, analytics, or privacy behavior.
