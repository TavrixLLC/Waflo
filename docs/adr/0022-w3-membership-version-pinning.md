# ADR 0022: Membership version pinning

Every Membership stores the published Program Version current at enrollment. Card rendering, goal, localized content, enrollment policy, and Wallet binding use that immutable version.

Publishing a replacement version affects new enrollments only. Existing Membership migration is an explicit W4 concern because silent migration could change earned economics.
