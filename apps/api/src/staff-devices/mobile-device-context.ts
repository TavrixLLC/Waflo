export interface LocationCapabilityAssignment {
  readonly locationId: string;
  readonly earningAllowed: boolean;
  readonly redemptionAllowed: boolean;
  readonly active: boolean;
  readonly revokedAt?: Date | null;
}

export interface IntersectedLocationCapability {
  readonly locationId: string;
  readonly earningAllowed: boolean;
  readonly redemptionAllowed: boolean;
}

export function intersectLocationCapabilities(
  staffAssignments: readonly LocationCapabilityAssignment[],
  deviceAssignments: readonly LocationCapabilityAssignment[],
): IntersectedLocationCapability[] {
  const activeStaff = new Map(
    staffAssignments
      .filter((assignment) => assignment.active && !assignment.revokedAt)
      .map((assignment) => [assignment.locationId, assignment]),
  );
  return deviceAssignments.flatMap((deviceAssignment) => {
    if (!deviceAssignment.active) return [];
    const staffAssignment = activeStaff.get(deviceAssignment.locationId);
    if (!staffAssignment) return [];
    return [
      {
        locationId: deviceAssignment.locationId,
        earningAllowed: staffAssignment.earningAllowed && deviceAssignment.earningAllowed,
        redemptionAllowed: staffAssignment.redemptionAllowed && deviceAssignment.redemptionAllowed,
      },
    ];
  });
}
