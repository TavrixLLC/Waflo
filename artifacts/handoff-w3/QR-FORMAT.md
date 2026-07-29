# QR format

Enrollment QR is a canonical merchant-host join URL. Membership QR is `wfl1.<publicCredentialId>.<derivedSecret>` and contains no customer name, email, Membership public ID, balance, or database ID.

PNG and SVG generation are deterministic. Upload decoding accepts one bounded PNG/JPEG/WebP image, enforces byte and pixel limits, processes it in memory, and persists no transfer image. Parsing rejects invalid and unsupported payload versions.
