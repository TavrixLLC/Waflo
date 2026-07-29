export const programOperationalStatuses = [
  "DRAFT",
  "VALIDATED",
  "TEST",
  "SCHEDULED",
  "PUBLISHED",
  "PAUSED",
  "ARCHIVED",
  "SUSPENDED",
] as const;

export type ProgramOperationalStatus = (typeof programOperationalStatuses)[number];
export type ProgramPublicationType = "FIRST_PUBLICATION" | "REPLACEMENT_PUBLICATION";

export type ProgramPublicationStateDecision =
  | {
      allowed: true;
      previousOperationalState: ProgramOperationalStatus;
      resultingOperationalState: "PUBLISHED" | "PAUSED";
      publicationType: ProgramPublicationType;
      remainedPaused: boolean;
      preservePausedAt: boolean;
    }
  | {
      allowed: false;
      previousOperationalState: ProgramOperationalStatus;
      requiredAction?: "RESTORE_PROGRAM";
    };

export function decideProgramPublicationState(input: {
  programStatus: ProgramOperationalStatus;
  hasCurrentPublishedVersion: boolean;
}): ProgramPublicationStateDecision {
  const { programStatus, hasCurrentPublishedVersion } = input;

  if (programStatus === "ARCHIVED")
    return {
      allowed: false,
      previousOperationalState: programStatus,
      requiredAction: "RESTORE_PROGRAM",
    };
  if (programStatus === "SUSPENDED" || programStatus === "SCHEDULED")
    return { allowed: false, previousOperationalState: programStatus };

  if (!hasCurrentPublishedVersion) {
    if (programStatus === "DRAFT" || programStatus === "VALIDATED" || programStatus === "TEST")
      return {
        allowed: true,
        previousOperationalState: programStatus,
        resultingOperationalState: "PUBLISHED",
        publicationType: "FIRST_PUBLICATION",
        remainedPaused: false,
        preservePausedAt: false,
      };
    return { allowed: false, previousOperationalState: programStatus };
  }

  if (programStatus === "PUBLISHED")
    return {
      allowed: true,
      previousOperationalState: programStatus,
      resultingOperationalState: "PUBLISHED",
      publicationType: "REPLACEMENT_PUBLICATION",
      remainedPaused: false,
      preservePausedAt: false,
    };
  if (programStatus === "PAUSED")
    return {
      allowed: true,
      previousOperationalState: programStatus,
      resultingOperationalState: "PAUSED",
      publicationType: "REPLACEMENT_PUBLICATION",
      remainedPaused: true,
      preservePausedAt: true,
    };

  return { allowed: false, previousOperationalState: programStatus };
}
