# Secret scan

Result: PASS, exit code 0.

`node scripts/w3-secret-scan.mjs` inspected 489 source files and reported zero
violations. It excludes generated dependencies/build output, rejects credential-like
file extensions and service-account filenames, and scans text for private keys and
common live-token patterns.

The portable archive independently excludes `.env`, credential/certificate files,
service-account JSON names, logs, and runtime output. Only `.env.example` is permitted.

Raw output: `raw-test-output/secret-scan.txt`.

