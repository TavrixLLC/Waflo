# Manager approval

A Staff client requests a short-lived approval for a specific Membership, reward, device,
Location and request fingerprint. An Owner or Manager approves or rejects it from an authenticated
merchant session.

Approval is single-use, expires, and must match the eventual operation. The API never returns or
logs a reusable approval secret. Request, grant, rejection and consumption are audited. Daily-cap
or purchase overrides additionally require an explicit reason and create a risk signal.

