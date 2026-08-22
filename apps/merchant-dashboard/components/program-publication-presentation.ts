import type { ProgramOperationalStatus } from "@waflo/contracts";
import type { WalletHealth } from "./program-enrollment-settings";

export type PublicationMode = "first-launch" | "update";

export type CustomerPreviewSelection<TPublished, TDraft> =
  | { source: "published"; preview: TPublished }
  | { source: "draft"; preview: TDraft }
  | { source: "unavailable"; preview: null };

export interface PublicationFailurePresentation {
  title: string;
  whatHappened: string;
  remainsSafe: string;
  actionLabel: string;
  action: "retry" | "checks" | "locations" | "design" | "reload" | "billing" | "studio";
  retrySafe: boolean;
}

export interface WalletSurfacePresentation {
  label: string;
  explanation: string;
  tone: "success" | "neutral" | "warning";
}

export type ProgramSharingState =
  | "enrollment_open"
  | "enrollment_disabled"
  | "paused"
  | "archived"
  | "unavailable"
  | "not_published";

export interface ProgramSharingPresentation {
  state: ProgramSharingState;
  label: string;
  description: string;
  tone: "success" | "neutral" | "warning";
  canShare: boolean;
  canCopyJoinLink: boolean;
  canOpenJoinPage: boolean;
  canDownloadQr: boolean;
  canViewCustomers: boolean;
  blockingReason: string | null;
  primaryAction: "share" | "resume" | "restore" | "review-enrollment" | "launch";
  primaryActionLabel: string;
  secondaryActions: Array<"view-customers" | "view-history" | "return-to-cards">;
}

export function deriveProgramSharingPresentation(input: {
  lifecycle: ProgramOperationalStatus;
  enrollmentPolicy: { enrollmentOpen: boolean } | null;
  hasPublishedVersion: boolean;
  publicUrl: string | null;
  slug: string | null;
  qrAvailability: boolean;
  customerAccessState?: "available" | "unavailable" | undefined;
  locale: "en" | "ar";
}): ProgramSharingPresentation {
  const ar = input.locale === "ar";
  const canViewCustomers = input.hasPublishedVersion;

  if (!input.hasPublishedVersion)
    return {
      state: "not_published",
      label: ar ? "متاح بعد الإطلاق" : "Available after launch",
      description: ar
        ? "يصبح رابط الانضمام متاحاً بعد إطلاق بطاقة الولاء."
        : "The join link becomes available after this loyalty card launches.",
      tone: "neutral",
      canShare: false,
      canCopyJoinLink: false,
      canOpenJoinPage: false,
      canDownloadQr: false,
      canViewCustomers: false,
      blockingReason: ar ? "أطلق البطاقة قبل مشاركتها." : "Launch this card before sharing it.",
      primaryAction: "launch",
      primaryActionLabel: ar ? "إطلاق بطاقة الولاء" : "Launch loyalty card",
      secondaryActions: [],
    };

  if (input.lifecycle === "PAUSED")
    return {
      state: "paused",
      label: ar ? "التسجيل متوقف مؤقتاً" : "Enrollment paused",
      description: ar
        ? "روابط التسجيل متوقفة. استأنف بطاقة الولاء قبل مشاركتها مع عملاء جدد."
        : "Enrollment links are paused. Resume this loyalty card before sharing it with new customers.",
      tone: "warning",
      canShare: false,
      canCopyJoinLink: false,
      canOpenJoinPage: false,
      canDownloadQr: false,
      canViewCustomers,
      blockingReason: ar
        ? "المشاركة غير متاحة أثناء توقف بطاقة الولاء مؤقتاً."
        : "Sharing is unavailable while this loyalty card is paused.",
      primaryAction: "resume",
      primaryActionLabel: ar ? "استئناف البطاقة" : "Resume card",
      secondaryActions: ["view-customers"],
    };

  if (input.lifecycle === "ARCHIVED")
    return {
      state: "archived",
      label: ar ? "التسجيل غير متاح" : "Enrollment unavailable",
      description: ar
        ? "المشاركة غير متاحة أثناء أرشفة بطاقة الولاء. استعد البطاقة لقبول عملاء جدد مرة أخرى."
        : "Sharing is unavailable while this loyalty card is archived. Restore the card to accept new customers again.",
      tone: "neutral",
      canShare: false,
      canCopyJoinLink: false,
      canOpenJoinPage: false,
      canDownloadQr: false,
      canViewCustomers,
      blockingReason: ar
        ? "استعد بطاقة الولاء لمشاركتها مرة أخرى."
        : "Restore this loyalty card to share it again.",
      primaryAction: "restore",
      primaryActionLabel: ar ? "استعادة البطاقة" : "Restore card",
      secondaryActions: ["view-customers", "view-history", "return-to-cards"],
    };

  if (input.lifecycle !== "PUBLISHED")
    return {
      state: "unavailable",
      label: ar ? "المشاركة غير متاحة" : "Sharing unavailable",
      description: ar
        ? "لا يمكن تأكيد وصول العملاء إلى هذه البطاقة حالياً."
        : "Customer access for this card cannot be confirmed right now.",
      tone: "neutral",
      canShare: false,
      canCopyJoinLink: false,
      canOpenJoinPage: false,
      canDownloadQr: false,
      canViewCustomers,
      blockingReason: ar
        ? "راجع حالة بطاقة الولاء قبل مشاركتها."
        : "Review the loyalty card status before sharing it.",
      primaryAction: "review-enrollment",
      primaryActionLabel: ar ? "مراجعة وصول العملاء" : "Review customer access",
      secondaryActions: canViewCustomers ? ["view-customers"] : [],
    };

  if (input.enrollmentPolicy?.enrollmentOpen === false)
    return {
      state: "enrollment_disabled",
      label: ar ? "تسجيل العملاء متوقف" : "Customer enrollment is off",
      description: ar
        ? "البطاقة مباشرة للعملاء الحاليين، لكنها لا تقبل عضويات جديدة."
        : "The card remains live for existing customers but accepts no new memberships.",
      tone: "warning",
      canShare: false,
      canCopyJoinLink: false,
      canOpenJoinPage: false,
      canDownloadQr: false,
      canViewCustomers,
      blockingReason: ar
        ? "فعّل التسجيل في العملاء والمواقع قبل مشاركة رابط الانضمام."
        : "Enable enrollment in Customers & locations before sharing the join link.",
      primaryAction: "review-enrollment",
      primaryActionLabel: ar ? "مراجعة إعدادات التسجيل" : "Review enrollment settings",
      secondaryActions: ["view-customers"],
    };

  const linkAvailable = Boolean(input.publicUrl && input.slug);
  if (!linkAvailable || input.customerAccessState === "unavailable")
    return {
      state: "unavailable",
      label: ar ? "المشاركة غير متاحة" : "Sharing unavailable",
      description: ar
        ? "البطاقة مباشرة، لكن رابط الانضمام العام غير متاح حالياً."
        : "The card is live, but its public join link is unavailable right now.",
      tone: "warning",
      canShare: false,
      canCopyJoinLink: false,
      canOpenJoinPage: false,
      canDownloadQr: false,
      canViewCustomers,
      blockingReason: ar
        ? "راجع إعدادات التسجيل والرابط العام."
        : "Review enrollment settings and the public link.",
      primaryAction: "review-enrollment",
      primaryActionLabel: ar ? "مراجعة إعدادات التسجيل" : "Review enrollment settings",
      secondaryActions: ["view-customers"],
    };

  return {
    state: "enrollment_open",
    label: ar ? "التسجيل مفتوح" : "Enrollment open",
    description: ar
      ? "رابط الانضمام مخصص للعملاء الجدد للتسجيل."
      : "The join link is for new customers to enroll.",
    tone: "success",
    canShare: true,
    canCopyJoinLink: true,
    canOpenJoinPage: true,
    canDownloadQr: input.qrAvailability,
    canViewCustomers,
    blockingReason: null,
    primaryAction: "share",
    primaryActionLabel: ar ? "مشاركة بطاقة الولاء" : "Share loyalty card",
    secondaryActions: ["view-customers"],
  };
}

export function publicationMode(hasPublishedVersion: boolean): PublicationMode {
  return hasPublishedVersion ? "update" : "first-launch";
}

export function hasSavedUnpublishedChanges(input: {
  hasPublishedVersion: boolean;
  hasDraftVersion: boolean;
}): boolean {
  return input.hasPublishedVersion && input.hasDraftVersion;
}

export function selectCustomerPreviewSource<TPublished, TDraft>(input: {
  hasCurrentPublishedVersion: boolean;
  currentPublishedPreview: TPublished | null;
  savedDraft: TDraft | null;
  draftPreviewSupported: boolean;
}): CustomerPreviewSelection<TPublished, TDraft> {
  if (input.hasCurrentPublishedVersion) {
    return input.currentPublishedPreview !== null
      ? { source: "published", preview: input.currentPublishedPreview }
      : { source: "unavailable", preview: null };
  }

  if (input.draftPreviewSupported && input.savedDraft !== null) {
    return { source: "draft", preview: input.savedDraft };
  }

  return { source: "unavailable", preview: null };
}

export function isLocalPreviewUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".lvh.me");
  } catch {
    return false;
  }
}

/** Local QA routes may be local; shareable merchant copy is always canonical. */
export function canonicalPublicUrlForDisplay(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!url.hostname.endsWith(".localhost") && !url.hostname.endsWith(".lvh.me")) return value;
    const merchantSlug = url.hostname.split(".")[0];
    return `https://${merchantSlug}.waflo.app${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}

export function walletSurfacePresentation(
  provider: WalletHealth | undefined,
  ar: boolean,
): WalletSurfacePresentation {
  if (!provider)
    return {
      label: ar ? "الحالة غير متاحة" : "Status unavailable",
      explanation: ar
        ? "لا تتوفر بيانات تؤكد حالة هذا المزود. لا يمنع ذلك إطلاق بطاقة العميل على الويب."
        : "No provider data is available. This does not block Customer Web launch.",
      tone: "neutral",
    };

  if (provider.mode === "DISABLED")
    return {
      label: ar ? "غير متاحة" : "Unavailable",
      explanation: ar
        ? "واجهة Wallet هذه غير مفعّلة للمؤسسة. تبقى بطاقة العميل على الويب متاحة."
        : "This Wallet surface is disabled for the organization. Customer Web remains available.",
      tone: "neutral",
    };

  if (provider.status === "EXTERNALLY_UNCERTIFIED")
    return {
      label: ar ? "يلزم اختبار على جهاز" : "Device verification required",
      explanation: ar
        ? "إعداد Apple والتوقيع صالحان محلياً، لكن يجب إكمال اختبار الحفظ والتحديث على iPhone فعلي قبل اعتباره جاهزاً."
        : "Apple signing is locally valid, but save and update must pass on a physical iPhone before this is considered ready.",
      tone: "warning",
    };

  if (provider.status === "HEALTHY") {
    if (provider.mode === "TEST_ADAPTER")
      return {
        label: ar ? "للاختبار فقط" : "Test only",
        explanation: ar
          ? "هذا محاكي محلي ولا ينشئ بطاقة قابلة للحفظ في Wallet."
          : "This local adapter does not create a pass that can be saved to Wallet.",
        tone: "neutral",
      };

    if (provider.externallyCertified !== true)
      return {
        label: ar ? "متصل — اختبار الجهاز معلّق" : "Connected — device test pending",
        explanation: ar
          ? "تم التحقق من وصول المزود، لكن يجب إكمال حفظ البطاقة وتحديثها على جهاز فعلي قبل اعتبار المسار جاهزاً للبيع."
          : "Provider access is verified, but a physical-device save and update must pass before the path is sales-ready.",
        tone: "warning",
      };

    return {
      label: ar ? "جاهزة" : "Ready",
      explanation: ar
        ? "تم التحقق من إعداد المزود ومسار الجهاز الفعلي."
        : "Provider configuration and the physical-device path have been verified.",
      tone: "success",
    };
  }

  if (provider.status === "NOT_CONFIGURED" || provider.configured === false)
    return {
      label: ar ? "يلزم إعداد المؤسسة" : "Configuration required",
      explanation: ar
        ? "يتأثر هذا المزود فقط. لا يوجد مسار إعداد مدعوم داخل الاستوديو حالياً."
        : "Only this provider is affected. Studio does not currently offer a supported setup route.",
      tone: "warning",
    };

  if (provider.providerReachable === false)
    return {
      label: ar ? "غير متاحة مؤقتاً" : "Temporarily unavailable",
      explanation: ar
        ? "تعذر الوصول إلى المزود حالياً. تبقى بطاقة العميل على الويب متاحة."
        : "The provider cannot be reached right now. Customer Web remains available.",
      tone: "warning",
    };

  return {
    label: ar ? "الحالة غير متاحة" : "Status unavailable",
    explanation: ar
      ? "لا يمكن تأكيد حالة المزود الآن. لا يمنع ذلك إطلاق بطاقة العميل على الويب."
      : "Provider status cannot be confirmed right now. This does not block Customer Web launch.",
    tone: "neutral",
  };
}

export function publicationFailurePresentation(
  code: string,
  ar: boolean,
): PublicationFailurePresentation {
  const safe = ar
    ? "تغييراتك المحفوظة وبطاقتك المباشرة الحالية لم تتغير."
    : "Your saved changes and current live card remain unchanged.";

  const localized = (
    english: Omit<PublicationFailurePresentation, "remainsSafe">,
    arabic: Omit<PublicationFailurePresentation, "remainsSafe">,
  ): PublicationFailurePresentation => ({ ...(ar ? arabic : english), remainsSafe: safe });

  if (
    [
      "PROGRAM_PUBLICATION_VALIDATION_STALE",
      "PROGRAM_TEST_REQUIRED",
      "PROGRAM_PUBLICATION_PREVIEW_STALE",
    ].includes(code)
  )
    return localized(
      {
        title: "Launch checks changed",
        whatHappened:
          "The saved card changed after its latest checks. Review it and run the checks again.",
        actionLabel: "Run checks again",
        action: "checks",
        retrySafe: false,
      },
      {
        title: "تغيّرت فحوصات الإطلاق",
        whatHappened:
          "تغيّرت البطاقة المحفوظة بعد آخر فحص أو اختبار. راجعها وشغّل الفحوصات مرة أخرى.",
        actionLabel: "تشغيل الفحوصات مجدداً",
        action: "checks",
        retrySafe: false,
      },
    );

  if (code === "PROGRAM_PUBLICATION_LOCATION_STALE")
    return localized(
      {
        title: "Launch could not be completed",
        whatHappened: "The participating location selection changed after your checks ran.",
        actionLabel: "Review locations",
        action: "locations",
        retrySafe: false,
      },
      {
        title: "تعذر إكمال الإطلاق",
        whatHappened: "تغيّر اختيار المواقع المشاركة بعد تشغيل الفحوصات.",
        actionLabel: "مراجعة المواقع",
        action: "locations",
        retrySafe: false,
      },
    );

  if (code === "PROGRAM_PUBLICATION_ASSET_STALE")
    return localized(
      {
        title: "A required card asset is unavailable",
        whatHappened:
          "One of the saved card assets is missing or is no longer ready for publication.",
        actionLabel: "Review design",
        action: "design",
        retrySafe: false,
      },
      {
        title: "أحد أصول البطاقة المطلوبة غير متاح",
        whatHappened: "أحد أصول البطاقة المحفوظة مفقود أو لم يعد جاهزاً للنشر.",
        actionLabel: "مراجعة التصميم",
        action: "design",
        retrySafe: false,
      },
    );

  if (
    [
      "PROGRAM_PUBLICATION_PROGRAM_LIMIT_EXCEEDED",
      "PROGRAM_PUBLICATION_PLAN_BLOCKED",
      "PROGRAM_PUBLICATION_BILLING_BLOCKED",
      "PROGRAM_LIMIT_REACHED",
    ].includes(code)
  )
    return localized(
      {
        title: "Your plan currently blocks publication",
        whatHappened:
          "The current plan or billing state no longer allows this card to be published.",
        actionLabel: "Review plan",
        action: "billing",
        retrySafe: false,
      },
      {
        title: "الخطة الحالية تمنع النشر",
        whatHappened: "لم تعد الخطة أو حالة الفوترة الحالية تسمح بنشر هذه البطاقة.",
        actionLabel: "مراجعة الخطة",
        action: "billing",
        retrySafe: false,
      },
    );

  if (
    ["STALE_PROGRAM_DRAFT", "PROGRAM_DRAFT_REQUIRED", "PROGRAM_PUBLICATION_STATE_BLOCKED"].includes(
      code,
    )
  )
    return localized(
      {
        title: "This loyalty card changed in another session",
        whatHappened: "The latest saved state must be loaded before publishing can continue.",
        actionLabel: "Load latest changes",
        action: "reload",
        retrySafe: false,
      },
      {
        title: "تغيّرت بطاقة الولاء في جلسة أخرى",
        whatHappened: "يجب تحميل أحدث حالة للبطاقة قبل متابعة النشر.",
        actionLabel: "تحميل أحدث التغييرات",
        action: "reload",
        retrySafe: false,
      },
    );

  if (["ORGANIZATION_ACCESS_DENIED", "AUTHENTICATION_REQUIRED", "FORBIDDEN"].includes(code))
    return localized(
      {
        title: "You cannot publish this card",
        whatHappened: "Your current access does not include permission to publish loyalty cards.",
        actionLabel: "Return to Studio",
        action: "studio",
        retrySafe: false,
      },
      {
        title: "لا يمكنك نشر هذه البطاقة",
        whatHappened: "صلاحيتك الحالية لا تتضمن نشر بطاقات الولاء.",
        actionLabel: "العودة إلى الاستوديو",
        action: "studio",
        retrySafe: false,
      },
    );

  return localized(
    {
      title: "Publication could not be completed",
      whatHappened: "Waflo could not complete publication. Try publishing again.",
      actionLabel: "Retry publication",
      action: "retry",
      retrySafe: true,
    },
    {
      title: "تعذر إكمال النشر",
      whatHappened: "تعذر على Waflo إكمال النشر. حاول النشر مرة أخرى.",
      actionLabel: "إعادة محاولة النشر",
      action: "retry",
      retrySafe: true,
    },
  );
}

export function enrollmentOperationalCopy(
  status: ProgramOperationalStatus,
  enrollmentOpen: boolean,
  ar: boolean,
): { label: string; explanation: string; tone: "success" | "warning" | "neutral" } {
  if (status === "PAUSED")
    return {
      label: ar ? "التسجيل متوقف مؤقتاً" : "Enrollment paused",
      explanation: ar
        ? "يمكن للعملاء الحاليين عرض بطاقاتهم، لكن الانضمام والكسب والاستبدال متوقفة حتى الاستئناف."
        : "Existing customers can view their cards, but joining, earning, and redemption stop until resume.",
      tone: "warning",
    };
  if (status === "ARCHIVED")
    return {
      label: ar ? "التسجيل غير متاح" : "Enrollment unavailable",
      explanation: ar
        ? "لا تظهر البطاقة في الاكتشاف ولا تقبل عضويات جديدة. تبقى البطاقات الحالية قابلة للعرض من رابطها المباشر."
        : "The card is removed from discovery and accepts no new memberships. Existing cards remain viewable from their direct link.",
      tone: "neutral",
    };
  if (status !== "PUBLISHED")
    return {
      label: ar ? "متاح بعد الإطلاق" : "Available after launch",
      explanation: ar
        ? "سيصبح رابط الانضمام فعالاً بعد إطلاق البطاقة."
        : "The join link becomes active after the card launches.",
      tone: "neutral",
    };
  if (!enrollmentOpen)
    return {
      label: ar ? "تسجيل العملاء متوقف" : "Customer enrollment is off",
      explanation: ar
        ? "البطاقة مباشرة للعملاء الحاليين، لكنها لا تقبل عضويات جديدة."
        : "The card remains live for existing customers but accepts no new memberships.",
      tone: "warning",
    };
  return {
    label: ar ? "التسجيل مفتوح" : "Enrollment open",
    explanation: ar
      ? "يمكن للعملاء المؤهلين الانضمام من رابط البطاقة العام."
      : "Eligible customers can join from the public card link.",
    tone: "success",
  };
}
