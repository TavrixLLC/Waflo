# Secret scan

The final source scan passed with zero violations. It excludes generated dependencies/build output and rejects private-key blocks, Google API key shapes, live Stripe/GitHub token shapes, credential-like files, and service-account filenames.

The portable archive excludes `.env`, local environment variants, certificates, private keys, PKCS#12 files, service-account files, dependencies, build output, caches, volumes, runtime logs, and test-results.

Provider artifacts use visibly synthetic Test Adapter values. Inspection JSON redacts the barcode value and Apple authentication token; Google Object JSON redacts account and barcode values.

See `raw-test-output/secret-scan.txt` and `raw-test-output/final-archive-inspection.txt`.
