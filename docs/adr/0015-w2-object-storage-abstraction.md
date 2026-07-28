# ADR 0015: Object storage abstraction

Local development uses organization-scoped filesystem keys. The database stores object keys, not public URLs. Production can replace the local writer with an object-storage adapter without changing program references.
