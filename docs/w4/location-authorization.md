# Location authorization

Every operation has one authoritative Location from the active device session. The client cannot
choose another Location in the operation body.

Three layers must agree:

1. the pinned Program Version participates at the Location;
2. the Staff member has an active earning or redemption assignment;
3. the device assignment is active and no broader than the Staff assignment.

PostgreSQL guards cross-tenant or over-broad device assignments. Owner/Manager dashboard commands
accept an explicit Location only after tenant and permission validation.

## Merchant provisioning API

The supported provisioning path is Merchant-session authenticated and organization scoped:

- `GET /v1/organizations/:organizationId/members/:memberId/location-assignments`
- `PUT /v1/organizations/:organizationId/members/:memberId/location-assignments/:locationId`
- `DELETE /v1/organizations/:organizationId/members/:memberId/location-assignments/:locationId`

GET requires `devices.view`. PUT and DELETE require `devices.pair`. Owners may manage members in
their organization; Managers may manage STAFF members only. PUT requires an active target user,
active target Membership, and active Location in the same organization. GET can show retained
assignment history for an inactive member, and DELETE can revoke retained authority during
offboarding. UUID path parameters, tenant membership, role, permission, target identity, Location
ownership, and current state are all revalidated server-side. These endpoints are not exposed
under `/v1/staff`, so a Mobile principal cannot self-assign.

PUT accepts the strict body:

```json
{
  "earningAllowed": true,
  "redemptionAllowed": true
}
```

At least one permission must be true. HTTP 200 returns the standard success envelope containing
`organizationId`, `staffMemberId`, `staffDisplayName`, `locationId`, `locationName`, both permission
flags, `active`, `createdAt`, `revokedAt`, and `changed`. Exact duplicate requests return the same
state with `changed: false`. Updating a permission downward also narrows existing device
assignments and cancels unfinished pairings.

DELETE is idempotent after an assignment exists. HTTP 200 returns `organizationId`,
`staffMemberId`, `locationId`, `status: "REVOKED"`, `revokedAt`, and `changed`. The first revocation
sets `changed: true`; a repeat returns `false`. Revocation preserves the assignment and audit
history while revoking affected sessions, canceling unfinished pairings, and expiring pending or
approved manager requests for that member and Location.

The management codes are `STAFF_MEMBER_NOT_FOUND`, `STAFF_MEMBER_NOT_ASSIGNABLE`,
`STAFF_LOCATION_INVALID`, and `STAFF_LOCATION_ASSIGNMENT_NOT_FOUND`, plus the shared
`PERMISSION_DENIED` and `VALIDATION_FAILED`. Pairing fails closed with `LOCATION_NOT_AUTHORIZED` or
`STAFF_ASSIGNMENT_REQUIRED` when the active assignment prerequisites are absent.
