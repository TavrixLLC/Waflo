export type OperationalProgramStatus =
  | "DRAFT"
  | "VALIDATED"
  | "TEST"
  | "PUBLISHED"
  | "PAUSED"
  | "ARCHIVED"
  | "SUSPENDED";

export function preserveOperationalStatus(
  status: OperationalProgramStatus,
): OperationalProgramStatus {
  return ["PUBLISHED", "PAUSED", "ARCHIVED", "SUSPENDED"].includes(status) ? status : "VALIDATED";
}

export function applyTestStamps(current: number, amount: number, goal: number) {
  if (
    !Number.isInteger(current) ||
    !Number.isInteger(amount) ||
    !Number.isInteger(goal) ||
    current < 0 ||
    amount < 1 ||
    goal < 2
  )
    throw new Error("Invalid stamp state.");
  const raw = current + amount;
  return { remainder: raw % goal, completedCycles: Math.floor(raw / goal) };
}

export function canPublish(
  versionStatus: string,
  testReadyAt: Date | null,
  completedSession: boolean,
) {
  return versionStatus === "TEST_READY" && testReadyAt !== null && completedSession;
}

export function idempotencyMatches(existingProgramId: string, requestedProgramId: string) {
  return existingProgramId === requestedProgramId;
}
