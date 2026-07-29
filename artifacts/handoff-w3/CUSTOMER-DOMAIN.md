# Customer domain

Tenant-owned `Customer` records are independent of `CustomerContact`. A Membership connects a Customer to one Program and immutable enrollment Program Version. Consent, zero-progress projection, access session, active QR credential, provider pass instances, and transfer history are normalized relations.

Database foreign keys include organization identity where needed, and partial unique indexes enforce one active Membership credential and active device registration semantics. Public identifiers are random and never act as authorization by themselves.

See [../../docs/w3/customer-domain.md](../../docs/w3/customer-domain.md).
