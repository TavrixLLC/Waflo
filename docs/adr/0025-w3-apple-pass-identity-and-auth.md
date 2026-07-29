# ADR 0025: Apple pass identity and authentication

An Apple serial number is bound to one MembershipCredential through one WalletPassInstance. The pass web-service authentication token is derived with a versioned Waflo Apple secret.

Transfer creates a new serial and auth token, while the old pass is updated as voided. Provider identity is never recycled across bearer-credential rotation.
