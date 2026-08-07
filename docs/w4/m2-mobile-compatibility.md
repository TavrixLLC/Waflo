# M2 mobile compatibility reconstruction

## Recovery classification

The authoritative repository search covered every local and remote-tracking branch, tags, the
full reachable log, all reflogs, and unreachable Git objects. It found no historical M1/M2
implementation commit, generated M2 bundle, or source manifest. The committed W4 implementation
at `16e0b4077510073777040450b84af9b055cf2a33` is the only recoverable operational source.

This repair is therefore classified as **partial W4 recovery with M2 compatibility
reconstruction**. It does not claim that the reconstructed DTOs, command route, schemas, or
generator were recovered from a missing historical commit.

## Compatibility boundary

M2 keeps the existing signed Staff-device operations and W4 domain behavior:

- `POST /v1/staff/memberships/resolve`
- `POST /v1/staff/operations/stamps`
- `POST /v1/staff/operations/redeem`
- `GET /v1/staff/operations/:operationPublicId`
- `GET /v1/staff/operations/commands/:commandId`

The command route is the reconstructed recovery capability. It is restricted to the command's
tenant and originating Staff device, returns only PROCESSING, COMPLETED, or FAILED public data,
and uses not-found behavior for wrong-device or cross-tenant access.

Resolve responses expose localized operational data, integer minor-unit purchase policy, exact
currency, daily remaining stamps, projection truth, public reward identifiers, and exactly two
stamp artwork states: FILLED and EMPTY. They exclude QR material, email, phone, raw membership and
customer database IDs, signing material, and internal fraud details.

## Version and migration policy

iOS and Android pairing and signed requests enforce strict `major.minor.patch` versions against
`STAFF_MOBILE_MINIMUM_APP_VERSION`. Development Test Client metadata remains explicitly exempt
from mobile semantic-version enforcement and remains forbidden in production.

No Prisma schema change or migration is required. The compatibility layer is API, DTO,
validation, request-context, testing, and deterministic contract-generation code only.
