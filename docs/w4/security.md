# W4 security review

W1 merchant authentication, CSRF, CORS, tenant permissions and request limits remain active.
Customer CSRF and credential transfer controls remain unchanged. W4 adds signed key-bound Staff
requests, one-time pairing, opaque sessions, nonce replay protection and authoritative Location
context.

The ledger is append-only at PostgreSQL. Projection, reward, Staff assignment and device identity
triggers enforce context. Money is integer minor units; no card data or receipts are stored.

Production startup rejects the Test Client, weak/default operational secrets, missing ledger
secret, unsafe clock skew and unbounded exports. Logs redact all W4 credentials and customer
identifiers.

