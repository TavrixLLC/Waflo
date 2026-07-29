# Customer sessions

Customer Web Card access uses a dedicated `waflo_customer` HttpOnly cookie rather than the merchant session. The opaque token is returned only as a cookie; the database stores a keyed hash.

Sessions are SameSite strict, Secure in production, time limited, revocable, and bound to organization, Membership, credential, and merchant host. An otherwise valid cookie presented to another tenant host is rejected.

Enrollment and successful transfer create a new session. Transfer revokes earlier sessions as part of the same transaction. Session rotation replaces the token and revokes the old session; logout clears the cookie and records revocation.

Private card and wallet routes send `Cache-Control: no-store`.
