# Secure card transfer

The transfer flow first inspects a valid active Membership QR and exposes only merchant name, Program name, card status, and a masked email when present.

When email exists, the API creates an expiring, one-use transfer token and sends a confirmation link through the notification boundary. The token is carried in the URL fragment, scrubbed before confirmation, and posted in the request body. QR possession alone cannot complete this path.

When no email exists and the versioned policy permits it, the API creates an expiring same-browser challenge. Completion requires the challenge, a SameSite strict HttpOnly browser nonce, and explicit acceptance of the screenshot-possession risk warning.

Completion locks the transfer and Membership, rotates the credential exactly once, revokes old sessions, creates new provider identities, queues invalidation of old Wallet artifacts, queues issuance of new artifacts, and creates the new customer session. Replays return the completed result rather than rotate again.
