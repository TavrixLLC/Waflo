# Fraud and risk controls

Risk signals are tenant-scoped, severity scored and linked only to safe operation context.
Implemented signals cover overrides, manual adjustments, integrity mismatch, final-expiry
misconfiguration and operational review fixtures.

Owner and Manager can filter, inspect, acknowledge, resolve or dismiss signals with a required
note. State changes are audited. Critical integrity signals must page operations; override-rate,
reversal-rate and replay surges should alert from metrics.

Evidence must not include raw QR, email, signature, nonce, session, approval token, purchase
receipt, or payment-card data.

