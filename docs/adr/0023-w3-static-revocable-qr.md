# ADR 0023: Static revocable QR

W3 uses a versioned static membership QR containing an opaque credential ID and derived bearer secret. It contains no PII, Membership ID, or balance.

The credential is server-validated and transfer rotates it. Static QR is acceptable before operational scanning exists; rotating barcodes and their offline/time-window rules are deferred.
