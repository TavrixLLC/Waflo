# ADR 0034: Membership sequence and hash chain

Status: Accepted

Each Membership owns a gap-free sequence and versioned HMAC chain. Membership-scoped chains keep
locking narrow and make isolated verification possible. Old hash-key versions remain available
after rotation.

