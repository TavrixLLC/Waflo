# Transfer security

With stored email, an expiring one-use token is delivered to the masked contact. It stays in a URL fragment, is scrubbed from browser history, and is posted in the confirmation body.

Without email, the customer must present the active QR, retain an HttpOnly same-browser nonce, submit the expiring challenge, and explicitly accept the screenshot-possession warning.

Completion is locked and idempotent. It rotates the credential, revokes sessions, creates new provider identities, queues old identity invalidation and new issuance, and returns a new host-bound customer session. Replays cannot create another active credential.
