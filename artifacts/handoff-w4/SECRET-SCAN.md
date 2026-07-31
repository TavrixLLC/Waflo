# Secret scan

The archive excludes `.env`, private-key/certificate extensions, service-account JSON, logs,
runtime data and PII exports. W4 source contains variable names, public keys and non-secret test
identifiers only. The Staff Test Client generates its private key in memory and does not persist
or print it.

Final scan output is stored in `raw-test-output/secret-scan.log`: 641 inspected source files, zero
violations. Archive inspection separately rejects secret/private-key/runtime patterns.
