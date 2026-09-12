# Staff mobile app version policy

The backend supports `STAFF_MOBILE_MINIMUM_IOS_VERSION` and
`STAFF_MOBILE_MINIMUM_ANDROID_VERSION` as platform-specific overrides. Both fall back to the
existing M2 `STAFF_MOBILE_MINIMUM_APP_VERSION`, so current deployments remain compatible. Values
use strict Semantic Versioning 2.0.0; lexical comparison is forbidden. Build metadata does not
affect precedence and prerelease identifiers use Semantic Versioning ordering.

Startup/readiness fails when an explicitly configured value is malformed. Development and test use
the documented safe default `1.0.0` when the generic value is absent. Deployed environments reject
a zero release. The Test Client remains forbidden in production and keeps the existing M2 exemption
from semantic-version enforcement.

Pairing claim and completion reject below-minimum versions with the canonical M2
`STAFF_APP_VERSION_UNSUPPORTED` code (HTTP 426). Every signed request re-evaluates the stored
paired app version against the current platform policy. The mobile context exposes
`minimumSupportedVersion` and `updateRequired` after successful authentication.
