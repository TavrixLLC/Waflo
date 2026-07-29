# ADR 0021: Customer without an account

W3 customers do not create a password account. Enrollment establishes a tenant-host-bound, HttpOnly Membership access session for one private card.

This minimizes collected data and avoids inventing customer identity infrastructure before it is required. Recovery is the explicit card-transfer flow, with stored-email confirmation when email exists and a clearly warned QR-possession path otherwise.
