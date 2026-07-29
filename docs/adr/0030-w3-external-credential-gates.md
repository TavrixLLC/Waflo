# ADR 0030: External credential gates

Provider modes are disabled, test adapter, or real. Production refuses test adapters and refuses real mode when credentials, issuer identifiers, signing material, origins, or HTTPS endpoints are incomplete.

Automated adapter success is not external certification. Physical-device and real-issuer checks remain explicitly pending until protected credentials are supplied.
