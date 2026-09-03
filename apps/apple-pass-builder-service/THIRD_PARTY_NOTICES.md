# Apple Pass Builder notice

This image contains Apple Pass Builder from
<https://github.com/apple/pass-builder> at commit
`8908b955a42da8294ce7506719aa1f186d096c02`, licensed under Apache License 2.0.
The upstream license is installed as `/opt/pass-builder/LICENSE.pass-builder.txt`.

Waflo applies `patches/8908b955-swift-6.3-linux-pointer.patch` to unwrap the
non-null buffer pointer passed to secure memory clearing on Swift 6.3.3/Linux.
The patch changes no pass-format, validation, manifest, or signing behavior.

Waflo's audited `Package.resolved` is installed beside the executable and its
build-time SHA-256 is verified in the Dockerfile. The complete dependency-license inventory still
requires the normal release legal/compliance review before commercial image
distribution.
