# M2 mobile contract provenance

The durable compatibility bundle is tracked in [`docs/contracts/m2`](../contracts/m2). It contains
the generated OpenAPI contract, JSON Schema, stable error-code inventory, synthetic fixtures, and a
cryptographic source manifest. These files are required Mobile/Staff contract provenance; the
historical screenshots, validation logs, AI reports, archives, and duplicate source snapshots that
previously surrounded them were not required by runtime, build, deployment, or contract validation.

`source-manifest.json` records that the bundle was generated from backend commit
`0cc39d9ecb39a34fdbd91498e55b6d6ac35c281e` using
`waflo-m2-contract-generator-v1`. Its classification is
`PARTIAL_W4_RECOVERY_WITH_M2_COMPATIBILITY_RECONSTRUCTION`; it does not claim recovery of an earlier
historical M2 commit. The manifest hashes the source files and every generated file, identifies the
contract as `waflo-m2-mobile-contract-v1`, and records that the synthetic fixtures contain no QR
credential, access token, private key, signing secret, customer email, or phone number.

The current runtime source remains authoritative. Use `pnpm build` before running
`node scripts/generate-m2-mobile-contracts.mjs`; the generator deliberately requires a clean,
committed source tree. Verify a retained historical bundle with
`pnpm m2:contracts:verify`; the verifier uses the manifest's source commit and permits an explicit
`M2_EXPECTED_BACKEND_COMMIT` override for release automation. Regenerating from a later release
updates the manifest and must be reviewed as an explicit Mobile contract change.
