# Exports

Scale-gated exports are asynchronous commands with filters, leases, retry count, row limit,
expiry and safe failure code. The worker reads tenant-scoped data, renders a fixed schema with CSV
formula neutralization, encrypts the object with AES-256-GCM, and stores it in the private bucket.

Download requires an authenticated authorized merchant request. The API fetches and authenticates
the private object, decrypts it in memory, and returns `private, no-store` content. Object keys are
unguessable and never make the bucket public.

Expired objects and command metadata are cleaned in bounded batches.

