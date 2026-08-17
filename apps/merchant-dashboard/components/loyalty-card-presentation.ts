import type { Locale, ProgramOperationalStatus } from "@waflo/contracts";

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

const merchantProgramStatuses = {
  en: {
    DRAFT: { label: "Draft", tone: "neutral" },
    VALIDATED: { label: "Ready to publish", tone: "brand" },
    TEST: { label: "Ready to publish", tone: "brand" },
    SCHEDULED: { label: "Scheduled", tone: "brand" },
    PUBLISHED: { label: "Live", tone: "success" },
    PAUSED: { label: "Paused", tone: "warning" },
    ARCHIVED: { label: "Archived", tone: "neutral" },
    SUSPENDED: { label: "Suspended", tone: "danger" },
  },
  ar: {
    DRAFT: { label: "مسودة", tone: "neutral" },
    VALIDATED: { label: "جاهزة للنشر", tone: "brand" },
    TEST: { label: "جاهزة للنشر", tone: "brand" },
    SCHEDULED: { label: "مجدولة", tone: "brand" },
    PUBLISHED: { label: "مباشرة", tone: "success" },
    PAUSED: { label: "متوقفة مؤقتًا", tone: "warning" },
    ARCHIVED: { label: "مؤرشفة", tone: "neutral" },
    SUSPENDED: { label: "موقوفة", tone: "danger" },
  },
} as const satisfies Readonly<
  Record<Locale, Readonly<Record<ProgramOperationalStatus, MerchantProgramStatusPresentation>>>
>;

export function merchantProgramStatus(
  status: ProgramOperationalStatus,
  locale: Locale,
): MerchantProgramStatusPresentation {
  return merchantProgramStatuses[locale][status];
}

const merchantProgramLifecycleLabels = {
  en: {
    publish: "Publish card",
    pause: "Pause card",
    resume: "Resume card",
    archive: "Archive card",
    restore: "Restore card",
    abandon: "Abandon draft",
  },
  ar: {
    publish: "نشر البطاقة",
    pause: "إيقاف البطاقة مؤقتًا",
    resume: "استئناف البطاقة",
    archive: "أرشفة البطاقة",
    restore: "استعادة البطاقة",
    abandon: "التخلي عن المسودة",
  },
} as const satisfies Readonly<
  Record<Locale, Readonly<Record<MerchantProgramLifecycleAction, string>>>
>;

export function merchantProgramLifecycleLabel(
  action: MerchantProgramLifecycleAction,
  locale: Locale,
): string {
  return merchantProgramLifecycleLabels[locale][action];
}
