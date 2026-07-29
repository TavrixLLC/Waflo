# Evidence integrity

Browser screenshots are labeled only as Customer Web or merchant-dashboard views. No Customer Web screenshot is presented as an Apple pass or Google object.

Provider evidence is separate:

- `provider-artifacts/apple-test-adapter.pkpass` is a synthetic Test Adapter package.
- `provider-artifacts/apple-package-inspection.json` records file, manifest, localization, signature, pixel, barcode-field, and selected-artwork checks with sensitive values redacted.
- `provider-artifacts/apple-strip.png` is the extracted Apple strip artwork.
- Google Class/Object files are local redacted mappings.

Structured database/concurrency assertions under `evidence/` name their source test and raw output. They contain no Customer PII, QR payload, credential, transfer token, push token, Apple auth token, certificate secret, or Google service-account data.

The screenshot manifest lists one physical file once and describes combined assertions honestly. External Apple/Google certification remains explicitly pending.
