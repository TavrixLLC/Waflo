import type { ProgramItem } from "./program-studio-types";

export type OverviewNextStep = "first" | "draft" | "ready" | "live" | "unpublished" | "archived";

export function deriveOverviewNextStep(programs: ProgramItem[]): OverviewNextStep {
  if (programs.length === 0) return "first";
  const activePrograms = programs.filter((program) => program.status !== "ARCHIVED");
  if (activePrograms.length === 0) return "archived";
  if (
    activePrograms.some((program) => program.currentPublishedVersion && program.currentDraftVersion)
  )
    return "unpublished";
  if (activePrograms.some((program) => program.currentPublishedVersion)) return "live";
  if (
    activePrograms.some(
      (program) =>
        program.status === "VALIDATED" ||
        program.status === "TEST" ||
        program.currentDraftVersion?.status === "VALIDATED" ||
        program.currentDraftVersion?.status === "TEST",
    )
  )
    return "ready";
  return "draft";
}
