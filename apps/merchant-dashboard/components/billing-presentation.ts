export function canPersistCatalogSelection(subscriptionStatus: string): boolean {
  return subscriptionStatus === "PENDING_ACTIVATION";
}

export interface BillingDowngradeViolation {
  readonly code?: string;
  readonly actual?: number;
  readonly currentUsage?: number;
  readonly limit?: number | null;
}

/**
 * Stable billing error codes are presentation data, not backend prose. This
 * keeps a direct, unauthorized Billing route useful without exposing a raw
 * English API message in a localized dashboard.
 */
export function billingRequestErrorMessage(
  code: string | undefined,
  fallback: string,
  locale: "en" | "ar",
): string {
  if (code !== "PERMISSION_DENIED") return fallback;
  return locale === "ar"
    ? "ليس لديك صلاحية لعرض الفوترة."
    : "You do not have permission to view billing.";
}

/**
 * Billing returns stable domain codes and numeric facts. Presentation belongs
 * to the active interface locale, never to a backend English `message`.
 */
export function billingDowngradeViolationMessage(
  violation: BillingDowngradeViolation,
  locale: "en" | "ar",
): string {
  const ar = locale === "ar";
  const copy: Record<string, { en: string; ar: string }> = {
    LOCATIONS: {
      en: "Archive locations until the active location count fits the target plan.",
      ar: "أرشف المواقع حتى يصبح عدد المواقع النشطة ضمن حد الخطة.",
    },
    TEAM_SEATS: {
      en: "Remove or cancel Staff and Manager seats until the team fits the target plan.",
      ar: "أزل أو ألغِ مقاعد الموظفين والمديرين حتى يصبح الفريق ضمن حد الخطة.",
    },
    ACTIVE_PROGRAMS: {
      en: "Archive loyalty cards until the active card count fits the target plan.",
      ar: "أرشف بطاقات الولاء حتى يصبح عدد البطاقات النشطة ضمن حد الخطة.",
    },
    PRO_MODE: {
      en: "Move Pro Mode loyalty cards to supported settings before downgrading.",
      ar: "انقل بطاقات الولاء في وضع Pro إلى إعدادات مدعومة قبل خفض الخطة.",
    },
    MULTIPLE_REWARDS: {
      en: "Reduce loyalty cards to one reward before downgrading.",
      ar: "قلّل بطاقات الولاء إلى مكافأة واحدة قبل خفض الخطة.",
    },
    MILESTONE_REWARDS: {
      en: "Remove milestone rewards before downgrading.",
      ar: "أزل مكافآت المراحل قبل خفض الخطة.",
    },
    ADVANCED_LAYOUT: {
      en: "The stamp layout must use the supported Grid before downgrading.",
      ar: "يجب أن يستخدم تخطيط الأختام الشبكة المدعومة قبل خفض الخطة.",
    },
    ACTIVE_ADVANCED_EXPORTS: {
      en: "Wait for advanced exports to finish or expire before downgrading.",
      ar: "انتظر حتى تكتمل عمليات التصدير المتقدمة أو تنتهي صلاحيتها قبل خفض الخطة.",
    },
  };
  const label =
    copy[violation.code ?? ""]?.[locale] ??
    (ar
      ? "لا يمكن خفض الخطة حتى تُحل متطلبات الاستخدام الحالية."
      : "Resolve the current usage requirements before downgrading.");
  const actual = violation.actual ?? violation.currentUsage;
  if (actual === undefined) return label;
  const limit = violation.limit;
  return ar
    ? `${label} الحالي: ${actual}؛ المسموح: ${limit ?? "غير محدود"}.`
    : `${label} Current: ${actual}; allowed: ${limit ?? "unlimited"}.`;
}

export function billingDowngradeErrorMessage(
  violations: readonly BillingDowngradeViolation[] | undefined,
  locale: "en" | "ar",
): string {
  const messages = (violations ?? []).map((violation) =>
    billingDowngradeViolationMessage(violation, locale),
  );
  return messages.length
    ? messages.join(" · ")
    : locale === "ar"
      ? "لا يمكن خفض الخطة حتى تُحل متطلبات الاستخدام الحالية."
      : "Resolve the current usage requirements before downgrading.";
}
