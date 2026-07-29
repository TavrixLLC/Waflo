# Customer and Membership domain

`Customer` is tenant-owned and identified independently from contact data. `CustomerContact` stores email as AES-GCM ciphertext with a key version, an HMAC lookup value, and a safe masked display value. Email is never the Customer primary key.

`Membership` connects one customer to one Program and the immutable Program Version current at enrollment. `MembershipProgressProjection` is initialized to zero stamps, zero completed cycles, `rewardReady=false`, and projection version zero. W3 exposes no production progress mutation.

`CustomerConsent` records required Waflo privacy and program terms separately from optional marketing consent. Each record includes locale and the governing document or Program Version fingerprint.

`MembershipCredential` is the revocable bearer proof used in the QR. A database partial unique index permits only one active credential per Membership. `MembershipAccessSession` authorizes the private web card and is bound to the tenant host and active credential.
