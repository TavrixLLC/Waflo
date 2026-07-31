# Observability

Track stamp operations/units, redemption outcomes, replay, signature/body/timestamp failures,
nonce replay, invalid QR, latency, lock retry, ledger insert time, projection drift, Wallet queue
age, expiry, reversal, overrides, pairing, active devices, exports and worker dead letters.

Structured logs carry request ID, safe Organization context and operation public ID. Alerts:

- page immediately for ledger integrity mismatch or critical fraud signal;
- alert on projection drift, replay surge, database lock contention or dead-letter surge;
- warn on Wallet degradation, export latency and worker backlog.

No PII, QR, private key, signature, nonce, session token, approval token or provider credential is
permitted in logs.

