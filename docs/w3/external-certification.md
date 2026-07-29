# External provider certification

Automated Apple Test Adapter coverage passed for mapping, package structure, manifest digests, signing boundary, localization, barcode, MIME, web-service authentication, registration, update lookup, pass response, and transfer voiding.

Real Apple signing, iPhone installation, APNs update reception, and transferred-pass device behavior are **pending** because Apple pass certificates and a physical test device were not supplied.

Automated Google Test Adapter coverage passed for Class/Object identity and mapping, idempotent insert/reconcile, signed save JWT, allowed origins, updates, old-object inactivation, public assets, and provider error mapping.

Real Google Demo/Publishing Class creation, Google-account save, object patch, and inactivation are **pending** because Google issuer and service-account credentials were not supplied.

Pending external checks are credential-gated and must be run separately without placing secrets or real customer data in the repository or public handoff.
