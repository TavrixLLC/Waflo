# Exports

Scale-gated export commands retain filters, leases, retries, expiry and safe error state. CSV uses
fixed schemas and formula neutralization. Objects are AES-256-GCM encrypted in the private MinIO
bucket; authorized download decrypts in memory with `private, no-store` response headers.

