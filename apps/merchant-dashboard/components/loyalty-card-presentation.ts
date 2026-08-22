import type { ProgramOperationalStatus } from "@waflo/contracts";
import { localeRegistry, type InterfaceLocale } from "@waflo/i18n";

export interface MerchantProgramStatusPresentation {
  label: string;
  tone: "neutral" | "brand" | "success" | "warning" | "danger";
}

export type MerchantProgramLifecycleAction =
  | "publish"
  | "pause"
  | "resume"
  | "archive"
  | "restore"
  | "abandon";

export function merchantProgramStatus(
  status: ProgramOperationalStatus,
  locale: InterfaceLocale,
): MerchantProgramStatusPresentation {
  const label = localeRegistry[locale].messages.merchant.loyalty.programs.statuses[status];
  const tones: Record<ProgramOperationalStatus, MerchantProgramStatusPresentation["tone"]> = {
    DRAFT: "neutral",
    VALIDATED: "brand",
    TEST: "brand",
    SCHEDULED: "brand",
    PUBLISHED: "success",
    PAUSED: "warning",
    ARCHIVED: "neutral",
    SUSPENDED: "danger",
  };
  return { label, tone: tones[status] };
}

export function merchantProgramLifecycleLabel(
  action: MerchantProgramLifecycleAction,
  locale: InterfaceLocale,
): string {
  return localeRegistry[locale].messages.merchant.loyalty.programs.lifecycleActions[action];
}
