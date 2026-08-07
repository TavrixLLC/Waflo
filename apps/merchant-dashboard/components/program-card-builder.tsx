"use client";

import { planCatalog } from "@waflo/billing";
import type { Locale } from "@waflo/contracts";
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  Card,
  Checkbox,
  FormField,
  Modal,
  Select,
  TextArea,
  TextInput,
} from "@waflo/ui";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  Eye,
  FlaskConical,
  Globe2,
  MapPin,
  Palette,
  RefreshCcw,
  RotateCcw,
  Save,
  Settings2,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import Image from "next/image";
import {
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiClientError, apiFetch } from "../lib/api-client";
import { ProgramAssetPicker } from "./program-asset-uploader";
import {
  BUILDER_AUTOSAVE_DELAY_MS,
  BUILDER_PREVIEW_DELAY_MS,
  type BuilderSaveState,
  type BuilderSection,
  builderPreviewCacheKey,
  builderReadiness,
  builderReadinessWithValidation,
  builderSectionForIssue,
  builderSections,
  isNeutralBuilderDraft,
  languageCompleteness,
  shouldScheduleBuilderAutosave,
  updateBuilderRewardCopy,
  updateBuilderStampGoal,
} from "./program-card-builder-state";
import {
  type AssetItem,
  apiDraft,
  type LocationItem,
  type PreviewProfile,
  type ProgramDetail,
  type ProgramDraftInput,
  type ProgramVersion,
  type TemplateItem,
  type TestSession,
  type ValidationResult,
  versionToDraft,
} from "./program-studio-types";
import {
  templateCategory,
  templateCategoryLabel,
  templateDisplayName,
  templateStyleLabel,
} from "./template-gallery-presentation";

const previewProfiles = ["CUSTOMER_WEB", "APPLE_WALLET", "GOOGLE_WALLET"] as const;

interface PreviewResult {
  svg: string;
  width: number;
  height: number;
  warnings: Array<{ code: string; message: string }>;
  profile: PreviewProfile;
}

interface PreviewState {
  key: string;
  result: PreviewResult;
}

interface ConflictState {
  localDraft: ProgramDraftInput;
  localRevision: number;
  serverRevision: number;
}

type DraftUpdate = (transform: (current: ProgramDraftInput) => ProgramDraftInput) => void;

const sectionIcons = {
  basics: Sparkles,
  reward: WandSparkles,
  languages: Globe2,
  locations: MapPin,
  appearance: Palette,
  review: Check,
} as const;

const copy = {
  en: {
    eyebrow: "CREATE LOYALTY CARD",
    title: "Customize your loyalty card",
    description: "Shape the reward, language, and look while the real card stays in view.",
    back: "Loyalty cards",
    saveDraft: "Save draft",
    review: "Review card",
    continueStudio: "Continue to Studio",
    opening: "Opening your card builder…",
    selectedDesign: "Starting design",
    changeDesign: "Change design",
    changeTitle: "Change this design?",
    changeDescription:
      "Changing the design updates colors, stamp artwork, card layout, and supported wallet branding. Your card name, reward, languages, goal, locations, and advanced policy stay unchanged.",
    chooseDesign: "Choose another design",
    keepDesign: "Keep this design",
    quick: "Quick Mode",
    pro: "Pro Mode",
    preview: "Live preview",
    previewOnly: "Preview only",
    previewPending: "Save your changes to prepare this preview.",
    previewPreparing: "Preparing your preview…",
    previewLoading: "Updating the real card preview…",
    previewError: "The preview could not be refreshed.",
    walletPreviewNote:
      "Visual preview only. Wallet availability and production readiness are shown separately in Studio.",
    retry: "Retry",
    customer: "Customer",
    previewProgress: "Preview stamp progress",
    openPreview: "Preview",
    closePreview: "Close live preview",
    advanced: "Advanced settings",
    advancedDescription: "Operational policy and Pro controls stay out of the Quick path.",
    sections: {
      basics: "Basics",
      reward: "Reward",
      languages: "Languages",
      locations: "Locations",
      appearance: "Appearance",
      review: "Review & test",
    },
    sectionDescriptions: {
      basics: "Name the card and confirm how customers earn stamps.",
      reward: "Describe what the customer receives at the goal.",
      languages: "Keep English and Arabic together and see what remains.",
      locations: "Choose where earning and redemption are available.",
      appearance: "Keep the template identity, then adjust supported visual controls.",
      review: "Resolve readiness issues and test the customer experience.",
    },
    saved: "Saved",
    unsaved: "Unsaved changes",
    saving: "Saving…",
    failed: "Save failed",
    conflict: "Conflict detected",
    conflictTitle: "This draft changed in another editor",
    conflictDescription:
      "Your local edits are still here. Reload the saved draft or reapply your edits to the latest saved version.",
    reloadSaved: "Reload saved draft",
    keepEdits: "Keep my edits",
    genericError: "Waflo could not update this loyalty card. Try again.",
    planError: "Your current plan cannot create another active loyalty card.",
    locationError: "Add an active location before creating a loyalty card.",
    templateError: "That starting design is no longer available. Choose another design.",
    featureError: "This control requires Growth or Scale.",
    assetError: "One of the selected design assets is unavailable. Choose it again.",
    ready: "Draft ready",
    needsAttention: "Needs attention",
    fieldsRemaining: "fields remaining",
    complete: "Complete",
    checksNotRun: "Readiness checks have not run yet.",
    runChecks: "Run readiness checks",
    runAgain: "Run again",
    checksPassed: "Readiness checks passed",
    issuesFound: "Readiness issues found",
    fix: "Fix",
    testMode: "Test the reward cycle",
    testModeDescription:
      "Test safely with a demo customer. No real customer activity will be created.",
    startTest: "Start Test Mode",
    addStamp: "Add one stamp",
    resetTest: "Reset test",
    redeemReward: "Redeem test reward",
    rewardReady: "Reward ready outside the stamp grid",
    testRequired: "Run readiness checks before starting Test Mode.",
    noPublish: "Publishing remains in Studio. Saving this draft does not start your trial.",
    starterAdvanced: "Pro Mode requires Growth or Scale. Quick Mode remains fully available.",
    mode: "Editing mode",
    basicsSummary: "Card name, earning rule, and goal",
    rewardSummary: "Final reward at the stamp goal",
    languageSummary: "English and Arabic customer content",
    locationSummary: "Participating active locations",
    appearanceSummary: "Template, colors, logo, and stamp artwork",
  },
  ar: {
    eyebrow: "إنشاء بطاقة ولاء",
    title: "خصّص بطاقة الولاء",
    description: "عدّل المكافأة واللغات والمظهر مع إبقاء البطاقة الحقيقية أمامك.",
    back: "بطاقات الولاء",
    saveDraft: "حفظ المسودة",
    review: "مراجعة البطاقة",
    continueStudio: "المتابعة إلى الاستوديو",
    opening: "جارٍ فتح محرر البطاقة…",
    selectedDesign: "التصميم الأساسي",
    changeDesign: "تغيير التصميم",
    changeTitle: "هل تريد تغيير التصميم؟",
    changeDescription:
      "يحدّث التصميم الجديد الألوان ورسومات الأختام وتخطيط البطاقة وعناصر هوية المحافظ المدعومة. سيبقى اسم البطاقة والمكافأة واللغات والهدف والمواقع والسياسات المتقدمة كما هي.",
    chooseDesign: "اختيار تصميم آخر",
    keepDesign: "الاحتفاظ بهذا التصميم",
    quick: "الوضع السريع",
    pro: "الوضع الاحترافي",
    preview: "معاينة مباشرة",
    previewOnly: "للمعاينة فقط",
    previewPending: "احفظ تغييراتك لإعداد هذه المعاينة.",
    previewPreparing: "جارٍ إعداد المعاينة…",
    previewLoading: "جارٍ تحديث المعاينة الحقيقية للبطاقة…",
    previewError: "تعذر تحديث المعاينة.",
    walletPreviewNote:
      "معاينة مرئية فقط. يظهر توفر المحافظ الرقمية وجاهزيتها للإنتاج بشكل منفصل في الاستوديو.",
    retry: "إعادة المحاولة",
    customer: "العميل",
    previewProgress: "تقدم الأختام في المعاينة",
    openPreview: "معاينة",
    closePreview: "إغلاق المعاينة المباشرة",
    advanced: "الإعدادات المتقدمة",
    advancedDescription: "تبقى سياسات التشغيل وأدوات Pro خارج المسار السريع.",
    sections: {
      basics: "الأساسيات",
      reward: "المكافأة",
      languages: "اللغات",
      locations: "المواقع",
      appearance: "المظهر",
      review: "المراجعة والاختبار",
    },
    sectionDescriptions: {
      basics: "سمّ البطاقة وأكّد طريقة حصول العملاء على الأختام.",
      reward: "وضّح ما الذي سيحصل عليه العميل عند بلوغ الهدف.",
      languages: "أدر الإنجليزية والعربية معًا واعرف ما تبقى.",
      locations: "اختر المواقع التي يتاح فيها الكسب والاسترداد.",
      appearance: "حافظ على هوية القالب وعدّل عناصر المظهر المدعومة.",
      review: "عالج ملاحظات الجاهزية واختبر تجربة العميل.",
    },
    saved: "تم الحفظ",
    unsaved: "تغييرات غير محفوظة",
    saving: "جارٍ الحفظ…",
    failed: "فشل الحفظ",
    conflict: "تم اكتشاف تعارض",
    conflictTitle: "تغيّرت هذه المسودة في محرر آخر",
    conflictDescription:
      "ما زالت تعديلاتك المحلية محفوظة هنا. حمّل المسودة المحفوظة أو أعد تطبيق تعديلاتك على أحدث نسخة محفوظة.",
    reloadSaved: "تحميل المسودة المحفوظة",
    keepEdits: "الاحتفاظ بتعديلاتي",
    genericError: "تعذر تحديث بطاقة الولاء. حاول مرة أخرى.",
    planError: "لا تسمح خطتك الحالية بإنشاء بطاقة ولاء نشطة إضافية.",
    locationError: "أضف موقعًا نشطًا قبل إنشاء بطاقة ولاء.",
    templateError: "لم يعد هذا التصميم متاحًا. اختر تصميمًا آخر.",
    featureError: "يتطلب هذا الخيار خطة Growth أو Scale.",
    assetError: "أحد أصول التصميم المحددة غير متاح. اختره مرة أخرى.",
    ready: "المسودة جاهزة",
    needsAttention: "تحتاج إلى مراجعة",
    fieldsRemaining: "حقول متبقية",
    complete: "مكتمل",
    checksNotRun: "لم تُشغّل فحوصات الجاهزية بعد.",
    runChecks: "تشغيل فحوصات الجاهزية",
    runAgain: "إعادة الفحص",
    checksPassed: "اجتازت البطاقة فحوصات الجاهزية",
    issuesFound: "توجد ملاحظات على الجاهزية",
    fix: "إصلاح",
    testMode: "اختبار دورة المكافأة",
    testModeDescription: "اختبر بأمان مع عميل تجريبي. لن يُنشأ أي نشاط حقيقي للعملاء.",
    startTest: "بدء وضع الاختبار",
    addStamp: "إضافة ختم واحد",
    resetTest: "إعادة ضبط الاختبار",
    redeemReward: "استرداد المكافأة التجريبية",
    rewardReady: "المكافأة جاهزة خارج شبكة الأختام",
    testRequired: "شغّل فحوصات الجاهزية قبل بدء وضع الاختبار.",
    noPublish: "يبقى النشر داخل الاستوديو. حفظ المسودة لا يبدأ الفترة التجريبية.",
    starterAdvanced: "يتطلب وضع Pro خطة Growth أو Scale. يبقى الوضع السريع متاحًا بالكامل.",
    mode: "وضع التحرير",
    basicsSummary: "اسم البطاقة وقاعدة الكسب والهدف",
    rewardSummary: "المكافأة النهائية عند هدف الأختام",
    languageSummary: "محتوى العميل بالإنجليزية والعربية",
    locationSummary: "المواقع النشطة المشاركة",
    appearanceSummary: "القالب والألوان والشعار ورسومات الأختام",
  },
} as const;

function previewSource(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function previewLabel(profile: PreviewProfile, locale: Locale): string {
  if (profile === "APPLE_WALLET") return "Apple Wallet";
  if (profile === "GOOGLE_WALLET") return "Google Wallet";
  return copy[locale].customer;
}

function merchantError(error: unknown, locale: Locale): string {
  const text = copy[locale];
  if (!(error instanceof ApiClientError)) return text.genericError;
  if (error.code === "PROGRAM_LIMIT_REACHED") return text.planError;
  if (error.code === "PROGRAM_LOCATION_INVALID") return text.locationError;
  if (error.code.includes("TEMPLATE")) return text.templateError;
  if (
    error.code.includes("UNAVAILABLE") ||
    error.code.includes("PRO_MODE") ||
    error.code.includes("MILESTONE")
  )
    return text.featureError;
  if (error.code.includes("ASSET")) return text.assetError;
  return text.genericError;
}

function finalRewardIndex(draft: ProgramDraftInput): number {
  const thresholdIndex = draft.rewards.findIndex(
    (reward) => reward.thresholdStampCount === draft.requiredStampCount,
  );
  if (thresholdIndex >= 0) return thresholdIndex;
  return draft.rewards.reduce(
    (selected, reward, index, rewards) =>
      reward.sortOrder >= (rewards[selected]?.sortOrder ?? -1) ? index : selected,
    0,
  );
}

export function ProgramCardBuilder({
  organizationId,
  programId,
  plan,
  templates,
  locations,
  assets,
  onAssetUploaded,
  locale,
  onBack,
  onChangeDesign,
  onOpenStudio,
  onChanged,
}: {
  organizationId: string;
  programId: string;
  plan: "STARTER" | "GROWTH" | "SCALE";
  templates: TemplateItem[];
  locations: LocationItem[];
  assets: AssetItem[];
  onAssetUploaded: (asset: AssetItem) => void;
  locale: Locale;
  onBack: () => void;
  onChangeDesign: () => void;
  onOpenStudio: () => void;
  onChanged: () => Promise<void>;
}) {
  const ar = locale === "ar";
  const text = copy[locale];
  const [detail, setDetail] = useState<ProgramDetail | null>(null);
  const [draft, setDraft] = useState<ProgramDraftInput | null>(null);
  const [saveState, setSaveState] = useState<BuilderSaveState>("saved");
  const [activeSection, setActiveSection] = useState<BuilderSection>("basics");
  const [language, setLanguage] = useState<"en" | "ar">(ar ? "ar" : "en");
  const [previewLocale, setPreviewLocale] = useState<"EN" | "AR">(ar ? "AR" : "EN");
  const [profile, setProfile] = useState<PreviewProfile>("CUSTOMER_WEB");
  const [progress, setProgress] = useState(0);
  const [previews, setPreviews] = useState<Partial<Record<PreviewProfile, PreviewState>>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [testSession, setTestSession] = useState<TestSession | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [changeDesignOpen, setChangeDesignOpen] = useState(false);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const persistedRef = useRef("");
  const draftRef = useRef<ProgramDraftInput | null>(null);
  const revisionRef = useRef(1);
  const initializedRef = useRef(false);
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const previewCacheRef = useRef(new Map<string, PreviewResult>());
  const initialLoadKeyRef = useRef("");
  const sectionNavRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    const program = await apiFetch<ProgramDetail>(
      `/v1/organizations/${organizationId}/programs/${programId}`,
    );
    setDetail(program);
    if (!program.currentDraftVersion) {
      setDraft(null);
      setError(
        ar
          ? "لا توجد مسودة قابلة للتحرير لهذه البطاقة. افتح الاستوديو لإنشاء نسخة جديدة."
          : "This card has no editable draft. Open Studio to create the next version.",
      );
      return;
    }
    const next = versionToDraft(program, program.currentDraftVersion);
    const serialized = JSON.stringify(apiDraft(next));
    draftRef.current = next;
    revisionRef.current = program.currentDraftVersion.revision;
    persistedRef.current = serialized;
    setDraft(next);
    setSaveState("saved");
    initializedRef.current = true;
  }, [ar, organizationId, programId]);

  useEffect(() => {
    const key = `${organizationId}:${programId}:${locale}`;
    if (initialLoadKeyRef.current === key) return;
    initialLoadKeyRef.current = key;
    void load().catch((caught) => setError(merchantError(caught, locale)));
  }, [load, locale, organizationId, programId]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const saveNow = useCallback(
    async function saveLatest(): Promise<boolean> {
      if (conflict) return false;
      if (saveInFlightRef.current) {
        const inFlightResult = await saveInFlightRef.current;
        if (!inFlightResult) return false;
      }
      const latest = draftRef.current;
      if (!latest) return false;
      const serialized = JSON.stringify(apiDraft(latest));
      if (serialized === persistedRef.current) {
        setSaveState("saved");
        return true;
      }
      const localRevision = revisionRef.current;
      setSaveState("saving");
      setError("");
      const request = apiFetch<{ currentDraftVersion: ProgramVersion }>(
        `/v1/organizations/${organizationId}/programs/${programId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ ...apiDraft(latest), revision: localRevision }),
        },
      )
        .then((updated) => {
          persistedRef.current = serialized;
          revisionRef.current = updated.currentDraftVersion.revision;
          setDetail((current) =>
            current ? { ...current, currentDraftVersion: updated.currentDraftVersion } : current,
          );
          setValidation(null);
          const currentSerialized = draftRef.current
            ? JSON.stringify(apiDraft(draftRef.current))
            : serialized;
          setSaveState(currentSerialized === serialized ? "saved" : "unsaved");
          return true;
        })
        .catch((caught) => {
          if (caught instanceof ApiClientError && caught.code === "STALE_PROGRAM_DRAFT") {
            const serverRevision =
              typeof caught.details?.expectedRevision === "number"
                ? caught.details.expectedRevision
                : localRevision + 1;
            setConflict({ localDraft: latest, localRevision, serverRevision });
            setSaveState("conflict");
          } else {
            setSaveState("failed");
            setError(merchantError(caught, locale));
          }
          return false;
        });
      saveInFlightRef.current = request;
      const result = await request;
      saveInFlightRef.current = null;
      if (
        result &&
        draftRef.current &&
        JSON.stringify(apiDraft(draftRef.current)) !== persistedRef.current
      )
        return saveLatest();
      return result;
    },
    [conflict, locale, organizationId, programId],
  );

  useEffect(() => {
    if (!draft || !initializedRef.current || conflict) return;
    const serialized = JSON.stringify(apiDraft(draft));
    if (!shouldScheduleBuilderAutosave(serialized, persistedRef.current, saveState)) return;
    if (saveState !== "unsaved") setSaveState("unsaved");
    const timer = window.setTimeout(() => void saveNow(), BUILDER_AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [conflict, draft, saveNow, saveState]);

  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (["unsaved", "saving", "failed", "conflict"].includes(saveState)) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [saveState]);

  useEffect(() => {
    if (!draft) return;
    setProgress((current) => Math.min(current, draft.requiredStampCount));
  }, [draft]);

  useEffect(() => {
    const navigation = sectionNavRef.current;
    if (!navigation || navigation.scrollWidth <= navigation.clientWidth) return;
    navigation
      .querySelector<HTMLElement>(`[data-builder-section-link="${activeSection}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeSection]);

  const previewKey = useCallback(
    (nextProfile: PreviewProfile) =>
      builderPreviewCacheKey(revisionRef.current, nextProfile, previewLocale, progress),
    [previewLocale, progress],
  );

  const loadPreview = useCallback(
    async (nextProfile: PreviewProfile, force = false): Promise<PreviewResult | null> => {
      if (!draftRef.current || JSON.stringify(apiDraft(draftRef.current)) !== persistedRef.current)
        return null;
      const key = previewKey(nextProfile);
      const cached = previewCacheRef.current.get(key);
      if (cached && !force) {
        setPreviews((current) => ({ ...current, [nextProfile]: { key, result: cached } }));
        return cached;
      }
      setPreviewLoading(true);
      setPreviewError(false);
      try {
        const result = await apiFetch<PreviewResult>(
          `/v1/organizations/${organizationId}/programs/${programId}/preview?progress=${progress}&profile=${nextProfile}&locale=${previewLocale}`,
        );
        previewCacheRef.current.set(key, result);
        setPreviews((current) => ({ ...current, [nextProfile]: { key, result } }));
        return result;
      } catch (caught) {
        setPreviewError(true);
        setError(merchantError(caught, locale));
        return null;
      } finally {
        setPreviewLoading(false);
      }
    },
    [locale, organizationId, previewKey, previewLocale, programId, progress],
  );

  useEffect(() => {
    if (saveState !== "saved") return;
    const timer = window.setTimeout(() => void loadPreview(profile), BUILDER_PREVIEW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [loadPreview, profile, saveState]);

  async function ensureAllPreviews(): Promise<boolean> {
    const results = await Promise.all(previewProfiles.map((item) => loadPreview(item)));
    return results.every(Boolean);
  }

  async function runChecks(): Promise<void> {
    if (!draft || !builderReadiness(draft).ready) {
      setActiveSection("review");
      return;
    }
    setWorking(true);
    setError("");
    try {
      if (!(await saveNow())) return;
      if (!(await ensureAllPreviews())) return;
      const result = await apiFetch<ValidationResult>(
        `/v1/organizations/${organizationId}/programs/${programId}/validate`,
        { method: "POST" },
      );
      setValidation(result);
      await load();
    } catch (caught) {
      setError(merchantError(caught, locale));
    } finally {
      setWorking(false);
    }
  }

  async function startTest(): Promise<void> {
    if (!validation || validation.errors.length > 0) return;
    setWorking(true);
    try {
      if (!(await saveNow())) return;
      const session = await apiFetch<TestSession>(
        `/v1/organizations/${organizationId}/programs/${programId}/test-sessions`,
        { method: "POST" },
      );
      setTestSession(session);
      setProgress(session.currentStampCount);
    } catch (caught) {
      setError(merchantError(caught, locale));
    } finally {
      setWorking(false);
    }
  }

  async function testCommand(kind: "add" | "reset" | "redeem"): Promise<void> {
    if (!testSession) return;
    setWorking(true);
    const base = `/v1/organizations/${organizationId}/programs/test-sessions/${testSession.id}`;
    try {
      if (kind === "add") {
        await apiFetch(`${base}/stamps`, {
          method: "POST",
          body: JSON.stringify({ amount: 1, idempotencyKey: crypto.randomUUID() }),
        });
      } else if (kind === "reset") {
        await apiFetch(`${base}/reset`, {
          method: "POST",
          body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
        });
      } else {
        const reward = testSession.version.rewards.find(
          (item) => item.thresholdStampCount === testSession.version.stampRule?.requiredStampCount,
        );
        if (!reward) return;
        await apiFetch(`${base}/redeem/${reward.id}`, {
          method: "POST",
          body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), managerApproved: true }),
        });
      }
      const refreshed = await apiFetch<TestSession>(base);
      setTestSession(refreshed);
      setProgress(refreshed.currentStampCount);
      await load();
    } catch (caught) {
      setError(merchantError(caught, locale));
    } finally {
      setWorking(false);
    }
  }

  async function leaveBuilder(destination: "back" | "studio"): Promise<void> {
    setWorking(true);
    const saved = await saveNow();
    if (saved) {
      await onChanged();
      if (destination === "studio") onOpenStudio();
      else onBack();
    }
    setWorking(false);
  }

  function update(transform: (current: ProgramDraftInput) => ProgramDraftInput): void {
    setValidation(null);
    setDraft((current) => (current ? transform(current) : current));
  }

  async function reloadConflict(): Promise<void> {
    setConflict(null);
    initializedRef.current = false;
    await load();
  }

  function reapplyConflict(): void {
    if (!conflict) return;
    revisionRef.current = conflict.serverRevision;
    setDraft(conflict.localDraft);
    setConflict(null);
    setSaveState("unsaved");
  }

  const selectedTemplate = useMemo(
    () =>
      draft
        ? templates.find(
            (item) => item.code === draft.templateCode && item.version === draft.templateVersion,
          )
        : undefined,
    [draft, templates],
  );

  if (!detail) {
    return (
      <Card className="builder-loading" role="status">
        <RefreshCcw className="studio-spin" size={20} aria-hidden="true" />
        {error || text.opening}
      </Card>
    );
  }

  if (!draft) {
    return (
      <Card className="builder-loading builder-loading--unavailable" role="alert">
        <CircleAlert size={24} aria-hidden="true" />
        <div>
          <strong>{text.needsAttention}</strong>
          <p>{error}</p>
        </div>
        <div className="builder-loading__actions">
          <Button type="button" variant="secondary" onClick={onBack}>
            <ArrowLeft className="builder-logical-back" size={16} aria-hidden="true" />
            {text.back}
          </Button>
          <Button type="button" onClick={onOpenStudio}>
            {text.continueStudio}
            <ChevronRight className="builder-logical-next" size={16} aria-hidden="true" />
          </Button>
        </div>
      </Card>
    );
  }

  const localReadiness = builderReadiness(draft);
  const readiness = builderReadinessWithValidation(draft, validation);
  const enCompleteness = languageCompleteness(draft.translations.en);
  const arCompleteness = languageCompleteness(draft.translations.ar);
  const blank = isNeutralBuilderDraft(draft);
  const selectedName = blank
    ? ar
      ? "ابدأ من الصفر"
      : "Start from scratch"
    : selectedTemplate
      ? templateDisplayName(selectedTemplate, locale)
      : ar
        ? "التصميم المحدد"
        : "Selected design";
  const selectedMeta = selectedTemplate
    ? `${templateCategoryLabel(templateCategory(selectedTemplate), locale)} · ${blank ? (ar ? "محايد" : "Neutral") : templateStyleLabel(selectedTemplate, locale)}`
    : text.selectedDesign;
  const accentStyle = {
    "--builder-live-accent": draft.visualTheme.accentColor,
  } as CSSProperties;

  return (
    <div className="builder-shell" dir={ar ? "rtl" : "ltr"} style={accentStyle}>
      <header className="builder-toolbar">
        <Button type="button" variant="secondary" onClick={() => void leaveBuilder("back")}>
          <ArrowLeft className="builder-logical-back" size={16} aria-hidden="true" />
          {text.back}
        </Button>
        <div className="builder-toolbar__title">
          <span className="dashboard-card__label">{text.eyebrow}</span>
          <h1>{text.title}</h1>
          <p>{text.description}</p>
        </div>
        <div
          className={`builder-save-state builder-save-state--${saveState}`}
          role="status"
          aria-live="polite"
        >
          {saveState === "saving" ? (
            <RefreshCcw className="studio-spin" size={16} aria-hidden="true" />
          ) : saveState === "conflict" || saveState === "failed" ? (
            <CircleAlert size={16} aria-hidden="true" />
          ) : (
            <Save size={16} aria-hidden="true" />
          )}
          <span>{text[saveState]}</span>
          {saveState === "failed" ? (
            <button type="button" onClick={() => void saveNow()}>
              {text.retry}
            </button>
          ) : null}
        </div>
      </header>

      {error ? <Alert tone="danger" title={error} /> : null}

      <div className="builder-template-context">
        <div>
          <span>{text.selectedDesign}</span>
          <strong>{selectedName}</strong>
          <small>{selectedMeta}</small>
        </div>
        <Badge tone={draft.editingMode === "pro" ? "brand" : "neutral"}>
          {draft.editingMode === "pro" ? text.pro : text.quick}
        </Badge>
        <Button type="button" variant="ghost" onClick={() => setChangeDesignOpen(true)}>
          <WandSparkles size={16} aria-hidden="true" />
          {text.changeDesign}
        </Button>
      </div>

      <div className="builder-workspace">
        <div className="builder-editor-column">
          <nav
            ref={sectionNavRef}
            className="builder-section-nav"
            aria-label={ar ? "أقسام محرر البطاقة" : "Card builder sections"}
          >
            {builderSections.map((section) => {
              const Icon = sectionIcons[section];
              const complete =
                section === "review"
                  ? Boolean(validation && validation.errors.length === 0)
                  : readiness[section];
              return (
                <button
                  type="button"
                  key={section}
                  data-builder-section-link={section}
                  className={activeSection === section ? "builder-section-nav__active" : ""}
                  aria-current={activeSection === section ? "page" : undefined}
                  onClick={() => setActiveSection(section)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{text.sections[section]}</span>
                  {complete ? <Check size={14} aria-label={text.complete} /> : null}
                </button>
              );
            })}
            <span className="builder-section-nav__divider" aria-hidden="true" />
            <button
              type="button"
              data-builder-section-link="advanced"
              className={activeSection === "advanced" ? "builder-section-nav__active" : ""}
              aria-current={activeSection === "advanced" ? "page" : undefined}
              onClick={() => setActiveSection("advanced")}
            >
              <Settings2 size={16} aria-hidden="true" />
              <span>{text.advanced}</span>
            </button>
          </nav>

          <section
            className="builder-editor"
            data-builder-section={activeSection}
            aria-labelledby="builder-editor-heading"
          >
            <div className="builder-section-heading">
              <div>
                <span className="dashboard-card__label">
                  {activeSection === "advanced" ? text.pro : text.quick}
                </span>
                <h2 id="builder-editor-heading">
                  {activeSection === "advanced" ? text.advanced : text.sections[activeSection]}
                </h2>
                <p>
                  {activeSection === "advanced"
                    ? text.advancedDescription
                    : text.sectionDescriptions[activeSection]}
                </p>
              </div>
              {activeSection !== "advanced" && activeSection !== "review" ? (
                <Badge tone={readiness[activeSection] ? "success" : "warning"}>
                  {readiness[activeSection] ? text.complete : text.needsAttention}
                </Badge>
              ) : null}
            </div>

            {activeSection === "basics" ? (
              <BasicsSection draft={draft} update={update} locale={locale} />
            ) : null}
            {activeSection === "reward" ? (
              <RewardSection draft={draft} update={update} locale={locale} />
            ) : null}
            {activeSection === "languages" ? (
              <LanguagesSection
                draft={draft}
                update={update}
                locale={locale}
                language={language}
                setLanguage={(next) => {
                  setLanguage(next);
                  setPreviewLocale(next === "ar" ? "AR" : "EN");
                }}
                enCompleteness={enCompleteness}
                arCompleteness={arCompleteness}
              />
            ) : null}
            {activeSection === "locations" ? (
              <LocationsSection
                draft={draft}
                update={update}
                locations={locations}
                locale={locale}
              />
            ) : null}
            {activeSection === "appearance" ? (
              <AppearanceSection
                draft={draft}
                update={update}
                organizationId={organizationId}
                assets={assets}
                onAssetUploaded={onAssetUploaded}
                locale={locale}
              />
            ) : null}
            {activeSection === "advanced" ? (
              <AdvancedSection draft={draft} update={update} plan={plan} locale={locale} />
            ) : null}
            {activeSection === "review" ? (
              <ReviewSection
                draft={draft}
                readiness={readiness}
                validation={validation}
                canRunChecks={localReadiness.ready}
                testSession={testSession}
                working={working}
                locale={locale}
                onSection={setActiveSection}
                onRunChecks={() => void runChecks()}
                onStartTest={() => void startTest()}
                onTestCommand={(kind) => void testCommand(kind)}
              />
            ) : null}
          </section>
        </div>

        <aside className="builder-preview-desktop" aria-label={text.preview}>
          <PreviewPanel
            idPrefix="builder-desktop"
            draft={draft}
            locale={locale}
            previewLocale={previewLocale}
            setPreviewLocale={setPreviewLocale}
            profile={profile}
            setProfile={setProfile}
            progress={progress}
            setProgress={setProgress}
            preview={previews[profile]?.result}
            previewLoading={previewLoading}
            previewError={previewError}
            stale={saveState !== "saved" || previews[profile]?.key !== previewKey(profile)}
            onRetry={() => void loadPreview(profile, true)}
          />
        </aside>
      </div>

      <footer className="builder-footer">
        <button
          type="button"
          className="builder-mobile-preview-action"
          onClick={() => setMobilePreviewOpen(true)}
        >
          <Eye size={18} aria-hidden="true" />
          {text.openPreview}
        </button>
        {activeSection === "review" ? (
          <Button
            type="button"
            disabled={
              !readiness.ready ||
              !validation ||
              validation.errors.length > 0 ||
              saveState === "conflict"
            }
            onClick={() => void leaveBuilder("studio")}
          >
            {text.continueStudio}
            <ChevronRight className="builder-logical-next" size={16} aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => {
              setActiveSection("review");
              if (localReadiness.ready) void runChecks();
            }}
          >
            {text.review}
            <ChevronRight className="builder-logical-next" size={16} aria-hidden="true" />
          </Button>
        )}
      </footer>

      <Modal
        open={mobilePreviewOpen}
        title={text.preview}
        onClose={() => setMobilePreviewOpen(false)}
        closeLabel={text.closePreview}
        className="builder-preview-modal"
      >
        <PreviewPanel
          idPrefix="builder-mobile"
          draft={draft}
          locale={locale}
          previewLocale={previewLocale}
          setPreviewLocale={setPreviewLocale}
          profile={profile}
          setProfile={setProfile}
          progress={progress}
          setProgress={setProgress}
          preview={previews[profile]?.result}
          previewLoading={previewLoading}
          previewError={previewError}
          stale={saveState !== "saved" || previews[profile]?.key !== previewKey(profile)}
          onRetry={() => void loadPreview(profile, true)}
        />
      </Modal>

      <AlertDialog
        open={changeDesignOpen}
        title={text.changeTitle}
        description={text.changeDescription}
        confirmLabel={text.chooseDesign}
        cancelLabel={text.keepDesign}
        onClose={() => setChangeDesignOpen(false)}
        onConfirm={() => {
          setChangeDesignOpen(false);
          void (async () => {
            if (await saveNow()) onChangeDesign();
          })();
        }}
      />

      <Modal
        open={Boolean(conflict)}
        title={text.conflictTitle}
        onClose={() => undefined}
        closeLabel={text.conflictTitle}
        className="builder-conflict-modal"
      >
        <Alert tone="warning" title={text.conflict}>
          {text.conflictDescription}
        </Alert>
        <div className="wf-dialog__actions">
          <Button type="button" variant="secondary" onClick={() => void reloadConflict()}>
            <RefreshCcw size={16} aria-hidden="true" />
            {text.reloadSaved}
          </Button>
          <Button type="button" onClick={reapplyConflict}>
            {text.keepEdits}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function BasicsSection({
  draft,
  update,
  locale,
}: {
  draft: ProgramDraftInput;
  update: DraftUpdate;
  locale: Locale;
}) {
  const ar = locale === "ar";
  return (
    <div className="builder-form-stack">
      <FormField
        label={ar ? "اسم البطاقة داخل لوحة التحكم" : "Card name in your dashboard"}
        hint={ar ? "لن يظهر هذا الاسم للعملاء." : "Customers do not see this internal name."}
        required
      >
        <TextInput
          dir="auto"
          name="builder-internal-name"
          value={draft.internalName}
          maxLength={120}
          onChange={(event) =>
            update((current) => ({ ...current, internalName: event.target.value }))
          }
        />
      </FormField>
      <FormField
        label={ar ? "كيف يحصل العميل على ختم؟" : "How does a customer earn a stamp?"}
        required
      >
        <TextInput
          dir="auto"
          name="builder-earning-rule"
          value={draft.earningDescription}
          maxLength={240}
          onChange={(event) =>
            update((current) => ({ ...current, earningDescription: event.target.value }))
          }
        />
      </FormField>
      <div className="builder-goal-control">
        <div>
          <label htmlFor="builder-stamp-goal">
            {ar ? "هدف الأختام" : "Stamp goal"} <span aria-hidden="true">*</span>
          </label>
          <small>
            {ar
              ? "تدعم البطاقة من ختمين إلى 30 ختمًا."
              : "This card supports an exact goal from 2 to 30 stamps."}
          </small>
        </div>
        <input
          id="builder-stamp-goal"
          type="range"
          min={2}
          max={30}
          value={draft.requiredStampCount}
          aria-valuetext={`${draft.requiredStampCount} ${ar ? "ختمًا" : "stamps"}`}
          onChange={(event) =>
            update((current) => updateBuilderStampGoal(current, Number(event.target.value)))
          }
        />
        <TextInput
          aria-label={ar ? "القيمة الدقيقة لهدف الأختام" : "Exact stamp goal"}
          type="number"
          min={2}
          max={30}
          value={draft.requiredStampCount}
          onChange={(event) =>
            update((current) => updateBuilderStampGoal(current, Number(event.target.value)))
          }
        />
      </div>
    </div>
  );
}

function RewardSection({
  draft,
  update,
  locale,
}: {
  draft: ProgramDraftInput;
  update: DraftUpdate;
  locale: Locale;
}) {
  const ar = locale === "ar";
  const index = finalRewardIndex(draft);
  const reward = draft.rewards[index];
  if (!reward) return null;
  return (
    <div className="builder-form-stack">
      <div className="builder-reward-callout">
        <span>{ar ? "عند اكتمال" : "Unlocked at"}</span>
        <strong>
          {draft.requiredStampCount} {ar ? "ختمًا" : "stamps"}
        </strong>
        <small>
          {ar
            ? "تظهر جاهزية المكافأة خارج شبكة الأختام."
            : "Reward readiness appears outside the stamp grid."}
        </small>
      </div>
      <div className="builder-form-grid">
        <FormField
          label={ar ? "ما الذي سيحصل عليه العميل؟ — English" : "What does the customer get?"}
          required
        >
          <TextInput
            dir="ltr"
            lang="en"
            name="builder-reward-en"
            value={draft.translations.en.rewardSummary}
            maxLength={120}
            onChange={(event) =>
              update((current) => updateBuilderRewardCopy(current, "en", event.target.value))
            }
          />
        </FormField>
        <FormField label={ar ? "ما الذي سيحصل عليه العميل؟" : "Arabic reward"} required>
          <TextInput
            dir="rtl"
            lang="ar"
            name="builder-reward-ar"
            value={draft.translations.ar.rewardSummary}
            maxLength={120}
            onChange={(event) =>
              update((current) => updateBuilderRewardCopy(current, "ar", event.target.value))
            }
          />
        </FormField>
      </div>
      <details className="builder-disclosure">
        <summary>{ar ? "خيارات المكافأة" : "Reward options"}</summary>
        <div className="builder-form-grid">
          <FormField label={ar ? "نوع المكافأة" : "Reward type"}>
            <Select
              value={reward.rewardType}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  rewards: current.rewards.map((item, rewardIndex) =>
                    rewardIndex === index
                      ? { ...item, rewardType: event.target.value as typeof item.rewardType }
                      : item,
                  ),
                }))
              }
            >
              <option value="FREE_ITEM">{ar ? "عنصر مجاني" : "Free item"}</option>
              <option value="DISCOUNT_DESCRIPTION">{ar ? "خصم" : "Discount"}</option>
              <option value="TEXT_REWARD">{ar ? "مكافأة وصفية" : "Descriptive reward"}</option>
              <option value="CUSTOM">{ar ? "مخصصة" : "Custom"}</option>
            </Select>
          </FormField>
        </div>
        <p className="builder-studio-ownership-note">
          {ar
            ? "تُضبط صلاحية المكافأة وموافقات الاسترداد في الاستوديو بعد اكتمال تصميم البطاقة."
            : "Reward validity and redemption approvals are set in Studio after the card design is complete."}
        </p>
      </details>
    </div>
  );
}

function LanguagesSection({
  draft,
  update,
  locale,
  language,
  setLanguage,
  enCompleteness,
  arCompleteness,
}: {
  draft: ProgramDraftInput;
  update: DraftUpdate;
  locale: Locale;
  language: "en" | "ar";
  setLanguage: (language: "en" | "ar") => void;
  enCompleteness: ReturnType<typeof languageCompleteness>;
  arCompleteness: ReturnType<typeof languageCompleteness>;
}) {
  const ar = locale === "ar";
  const value = draft.translations[language];
  const completeness = language === "en" ? enCompleteness : arCompleteness;
  const contentDirection = language === "ar" ? "rtl" : "ltr";
  const languageOptions = ["en", "ar"] as const;

  function selectLanguage(next: "en" | "ar"): void {
    setLanguage(next);
    requestAnimationFrame(() => document.getElementById(`builder-language-tab-${next}`)?.focus());
  }

  function handleLanguageTabKey(
    event: React.KeyboardEvent<HTMLButtonElement>,
    item: "en" | "ar",
  ): void {
    let next: "en" | "ar" | undefined;
    if (event.key === "Home") next = languageOptions[0];
    if (event.key === "End") next = languageOptions[languageOptions.length - 1];
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const current = languageOptions.indexOf(item);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      next =
        languageOptions[(current + direction + languageOptions.length) % languageOptions.length];
    }
    if (!next) return;
    event.preventDefault();
    selectLanguage(next);
  }

  function setField(key: keyof typeof value, next: string) {
    update((current) => ({
      ...current,
      translations: {
        ...current.translations,
        [language]: { ...current.translations[language], [key]: next },
      },
    }));
  }
  return (
    <div className="builder-form-stack">
      <div
        className="builder-language-tabs"
        role="tablist"
        aria-label={ar ? "لغات البطاقة" : "Card languages"}
      >
        {languageOptions.map((item) => {
          const status = item === "en" ? enCompleteness : arCompleteness;
          return (
            <button
              type="button"
              role="tab"
              key={item}
              id={`builder-language-tab-${item}`}
              aria-controls={`builder-language-panel-${item}`}
              aria-selected={language === item}
              tabIndex={language === item ? 0 : -1}
              onClick={() => setLanguage(item)}
              onKeyDown={(event) => handleLanguageTabKey(event, item)}
            >
              <span>{item === "en" ? "English" : "العربية"}</span>
              <small>
                {status.complete
                  ? copy[locale].complete
                  : `${status.missing} ${copy[locale].fieldsRemaining}`}
              </small>
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`builder-language-panel-${language}`}
        aria-labelledby={`builder-language-tab-${language}`}
        className="builder-language-panel"
        dir={language === "ar" ? "rtl" : "ltr"}
        lang={language}
      >
        <Alert
          tone={completeness.complete ? "success" : "warning"}
          title={
            completeness.complete
              ? language === "ar"
                ? "المحتوى العربي مكتمل"
                : "English content is complete"
              : language === "ar"
                ? `${completeness.missing} حقول عربية متبقية`
                : `${completeness.missing} English fields remaining`
          }
        />
        <FormField label={language === "ar" ? "اسم البطاقة" : "Card name"} required>
          <TextInput
            dir={contentDirection}
            lang={language}
            value={value.programName}
            onChange={(event) => setField("programName", event.target.value)}
          />
        </FormField>
        <FormField label={language === "ar" ? "الوصف القصير" : "Short description"} required>
          <TextInput
            dir={contentDirection}
            lang={language}
            value={value.shortDescription}
            maxLength={240}
            onChange={(event) => setField("shortDescription", event.target.value)}
          />
        </FormField>
        <details className="builder-disclosure">
          <summary>
            {language === "ar" ? "المحتوى التفصيلي والرسائل" : "Detailed content and messages"}
          </summary>
          <FormField label={language === "ar" ? "الوصف الكامل" : "Full description"}>
            <TextArea
              dir={contentDirection}
              lang={language}
              value={value.fullDescription ?? ""}
              onChange={(event) => setField("fullDescription", event.target.value)}
            />
          </FormField>
          <FormField label={language === "ar" ? "تعليمات الانضمام" : "Join instructions"}>
            <TextArea
              dir={contentDirection}
              lang={language}
              value={value.joinInstructions ?? ""}
              onChange={(event) => setField("joinInstructions", event.target.value)}
            />
          </FormField>
          <FormField
            label={language === "ar" ? "الشروط والأحكام" : "Terms and conditions"}
            required
          >
            <TextArea
              dir={contentDirection}
              lang={language}
              value={value.termsAndConditions}
              onChange={(event) => setField("termsAndConditions", event.target.value)}
            />
          </FormField>
          <div className="builder-form-grid">
            <FormField
              label={language === "ar" ? "رسالة اكتمال الهدف" : "Goal completion message"}
              required
            >
              <TextInput
                dir={contentDirection}
                lang={language}
                value={value.completionMessage}
                onChange={(event) => setField("completionMessage", event.target.value)}
              />
            </FormField>
            <FormField
              label={language === "ar" ? "رسالة جاهزية المكافأة" : "Reward-ready message"}
              required
            >
              <TextInput
                dir={contentDirection}
                lang={language}
                value={value.rewardUnlockedMessage}
                onChange={(event) => setField("rewardUnlockedMessage", event.target.value)}
              />
            </FormField>
          </div>
          <FormField label={language === "ar" ? "رسالة الإيقاف المؤقت" : "Paused-card message"}>
            <TextInput
              dir={contentDirection}
              lang={language}
              value={value.pausedMessage ?? ""}
              onChange={(event) => setField("pausedMessage", event.target.value)}
            />
          </FormField>
        </details>
      </div>
    </div>
  );
}

function LocationsSection({
  draft,
  update,
  locations,
  locale,
}: {
  draft: ProgramDraftInput;
  update: DraftUpdate;
  locations: LocationItem[];
  locale: Locale;
}) {
  const ar = locale === "ar";
  const active = locations.filter((location) => location.status.toUpperCase() === "ACTIVE");
  return (
    <div className="builder-form-stack">
      {active.length === 1 ? (
        <Alert tone="info" title={ar ? "تم تضمين موقعك النشط" : "Your active location is included"}>
          {ar
            ? "يمكنك إلغاء تحديده، لكن يلزم موقع واحد على الأقل لاجتياز فحص الجاهزية."
            : "You can remove it, but at least one location is required for readiness."}
        </Alert>
      ) : null}
      {!active.length ? (
        <Alert tone="warning" title={copy[locale].locationError} />
      ) : (
        <div className="builder-location-list">
          {locations.map((location) => {
            const isActive = location.status.toUpperCase() === "ACTIVE";
            const selected = draft.locationIds.includes(location.id);
            return (
              <label
                key={location.id}
                className={`builder-location${selected ? " builder-location--selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={!isActive}
                  onChange={(event) =>
                    update((current) => ({
                      ...current,
                      locationIds: event.target.checked
                        ? [...current.locationIds, location.id]
                        : current.locationIds.filter((id) => id !== location.id),
                    }))
                  }
                />
                <span>
                  <strong>{location.name}</strong>
                  <small>{isActive ? (ar ? "نشط" : "Active") : ar ? "غير نشط" : "Inactive"}</small>
                </span>
                <span className="builder-location__capabilities">
                  <Badge tone={selected ? "success" : "neutral"}>{ar ? "الكسب" : "Earning"}</Badge>
                  <Badge tone={selected ? "success" : "neutral"}>
                    {ar ? "الاسترداد" : "Redemption"}
                  </Badge>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AppearanceSection({
  draft,
  update,
  organizationId,
  assets,
  onAssetUploaded,
  locale,
}: {
  draft: ProgramDraftInput;
  update: DraftUpdate;
  organizationId: string;
  assets: AssetItem[];
  onAssetUploaded: (asset: AssetItem) => void;
  locale: Locale;
}) {
  const ar = locale === "ar";
  const colors = [
    ["backgroundColor", ar ? "الخلفية" : "Background"],
    ["foregroundColor", ar ? "النص" : "Text"],
    ["accentColor", ar ? "لون التمييز" : "Accent"],
    ["secondaryColor", ar ? "اللون الثانوي" : "Secondary"],
  ] as const;
  return (
    <div className="builder-form-stack">
      <div className="builder-color-grid">
        {colors.map(([key, label]) => (
          <FormField key={key} label={label}>
            <div className="builder-color-control">
              <input
                type="color"
                aria-label={label}
                value={draft.visualTheme[key]}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    visualTheme: { ...current.visualTheme, [key]: event.target.value },
                  }))
                }
              />
              <TextInput
                dir="ltr"
                lang="en"
                value={draft.visualTheme[key]}
                maxLength={7}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    visualTheme: { ...current.visualTheme, [key]: event.target.value },
                  }))
                }
              />
            </div>
          </FormField>
        ))}
      </div>
      <ProgramAssetPicker
        organizationId={organizationId}
        category="LOGO"
        label={ar ? "الشعار" : "Logo"}
        assets={assets}
        selectedId={draft.visualTheme.logoAssetId}
        onSelected={(assetId) =>
          update((current) => ({
            ...current,
            visualTheme: { ...current.visualTheme, logoAssetId: assetId },
          }))
        }
        onUploaded={onAssetUploaded}
        ar={ar}
      />
      <div className="builder-artwork-grid">
        <ProgramAssetPicker
          organizationId={organizationId}
          category="STAMP_FILLED"
          label={ar ? "أيقونة الختم" : "Stamped icon"}
          assets={assets}
          selectedId={draft.visualTheme.filledStampAssetId}
          onSelected={(assetId) =>
            update((current) => ({
              ...current,
              visualTheme: { ...current.visualTheme, filledStampAssetId: assetId ?? undefined },
            }))
          }
          onUploaded={onAssetUploaded}
          ar={ar}
        />
        <ProgramAssetPicker
          organizationId={organizationId}
          category="STAMP_EMPTY"
          label={ar ? "الختم الفارغ" : "Empty stamp"}
          assets={assets}
          selectedId={draft.visualTheme.emptyStampAssetId}
          onSelected={(assetId) =>
            update((current) => ({
              ...current,
              visualTheme: { ...current.visualTheme, emptyStampAssetId: assetId ?? undefined },
            }))
          }
          onUploaded={onAssetUploaded}
          ar={ar}
        />
      </div>
    </div>
  );
}

function AdvancedSection({
  draft,
  update,
  plan,
  locale,
}: {
  draft: ProgramDraftInput;
  update: DraftUpdate;
  plan: "STARTER" | "GROWTH" | "SCALE";
  locale: Locale;
}) {
  const ar = locale === "ar";
  const planCode = plan.toLocaleLowerCase("en-US") as "starter" | "growth" | "scale";
  const proAvailable = planCatalog[planCode].features.advancedCustomization;
  const milestones = draft.rewards.filter(
    (reward) => reward.thresholdStampCount < draft.requiredStampCount,
  );
  function addMilestone() {
    if (!proAvailable || draft.editingMode !== "pro") return;
    const threshold = Math.max(2, draft.requiredStampCount - 2);
    update((current) => ({
      ...current,
      rewards: [
        ...current.rewards,
        {
          clientId: crypto.randomUUID(),
          thresholdStampCount: threshold,
          rewardType: "TEXT_REWARD",
          internalName: "Milestone reward",
          sortOrder: Math.max(...current.rewards.map((reward) => reward.sortOrder)) + 1,
          requiresManagerApproval: false,
          maximumRedemptionsPerEarned: 1,
          translations: {
            en: { name: "Milestone reward", description: "Milestone reward" },
            ar: { name: "مكافأة مرحلية", description: "مكافأة مرحلية" },
          },
        },
      ],
    }));
  }
  return (
    <div className="builder-form-stack">
      {!proAvailable ? <Alert tone="info" title={copy[locale].starterAdvanced} /> : null}
      <FormField label={copy[locale].mode}>
        <Select
          value={draft.editingMode}
          onChange={(event) => {
            const mode = event.target.value as "quick" | "pro";
            if (mode === "pro" && !proAvailable) return;
            if (mode === "quick" && milestones.length > 0) return;
            update((current) => ({ ...current, editingMode: mode }));
          }}
        >
          <option value="quick">{copy[locale].quick}</option>
          <option value="pro" disabled={!proAvailable}>
            {copy[locale].pro}
          </option>
        </Select>
      </FormField>
      {milestones.length > 0 ? (
        <Alert
          tone="warning"
          title={
            ar
              ? "أزل المكافآت المرحلية قبل العودة إلى الوضع السريع"
              : "Remove milestones before returning to Quick Mode"
          }
        />
      ) : null}
      {draft.editingMode === "pro" ? (
        <div className="builder-pro-rewards">
          <div className="builder-subheading">
            <div>
              <h3>{ar ? "المكافآت المرحلية" : "Milestone rewards"}</h3>
              <p>
                {ar
                  ? "تظهر المكافآت خارج شبكة الأختام ولا تستبدل أي خانة."
                  : "Milestones remain outside the stamp grid and never replace a slot."}
              </p>
            </div>
            <Button type="button" variant="secondary" onClick={addMilestone}>
              {ar ? "إضافة مكافأة مرحلية" : "Add milestone"}
            </Button>
          </div>
          {milestones.map((reward) => (
            <Card key={reward.clientId} className="builder-milestone">
              <div className="builder-form-grid">
                <FormField label={ar ? "عند عدد أختام" : "Stamp threshold"}>
                  <TextInput
                    type="number"
                    min={2}
                    max={Math.max(2, draft.requiredStampCount - 1)}
                    value={reward.thresholdStampCount}
                    onChange={(event) =>
                      update((current) => ({
                        ...current,
                        rewards: current.rewards.map((item) =>
                          item.clientId === reward.clientId
                            ? { ...item, thresholdStampCount: Number(event.target.value) }
                            : item,
                        ),
                      }))
                    }
                  />
                </FormField>
                <FormField label={ar ? "اسم المكافأة" : "Reward name"}>
                  <TextInput
                    value={ar ? reward.translations.ar.name : reward.translations.en.name}
                    onChange={(event) =>
                      update((current) => ({
                        ...current,
                        rewards: current.rewards.map((item) =>
                          item.clientId === reward.clientId
                            ? {
                                ...item,
                                translations: {
                                  ...item.translations,
                                  [ar ? "ar" : "en"]: {
                                    ...item.translations[ar ? "ar" : "en"],
                                    name: event.target.value,
                                    description: event.target.value,
                                  },
                                },
                              }
                            : item,
                        ),
                      }))
                    }
                  />
                </FormField>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  update((current) => ({
                    ...current,
                    rewards: current.rewards.filter((item) => item.clientId !== reward.clientId),
                  }))
                }
              >
                {ar ? "إزالة المكافأة المرحلية" : "Remove milestone"}
              </Button>
            </Card>
          ))}
        </div>
      ) : null}
      <div className="builder-studio-ownership-note" role="note">
        <strong>{ar ? "قواعد التشغيل في الاستوديو" : "Operational rules live in Studio"}</strong>
        <p>
          {ar
            ? "بعد إنهاء التصميم، اضبط حدود الأختام ومتطلبات الشراء وفترات التراجع وصلاحيات المدير من منطقة «طريقة العمل»."
            : "After design, set stamp limits, purchase requirements, reversal windows, and manager permissions in How it works."}
        </p>
      </div>
      <details className="builder-disclosure">
        <summary>{ar ? "تخطيط الأختام" : "Stamp arrangement"}</summary>
        <div className="builder-layout-options">
          {(["ROW", "GRID", "PATH", "RING"] as const).map((layout) => {
            const locked = !proAvailable && (layout === "PATH" || layout === "RING");
            const labels = {
              ROW: ar ? "أفقي" : "Horizontal",
              GRID: ar ? "كلاسيكي" : "Classic",
              PATH: ar ? "متدرج" : "Flowing",
              RING: ar ? "دائري" : "Circular",
            };
            return (
              <button
                type="button"
                key={layout}
                disabled={locked}
                aria-pressed={draft.visualTheme.layoutType === layout}
                onClick={() =>
                  update((current) => ({
                    ...current,
                    visualTheme: { ...current.visualTheme, layoutType: layout },
                  }))
                }
              >
                <strong>{labels[layout]}</strong>
                <small>
                  {locked
                    ? ar
                      ? "يتطلب Growth"
                      : "Growth required"
                    : ar
                      ? "ترتيب متجاوب"
                      : "Responsive arrangement"}
                </small>
              </button>
            );
          })}
        </div>
      </details>
      <details className="builder-disclosure">
        <summary>{ar ? "تفاصيل أسطح المعاينة" : "Preview surface details"}</summary>
        <div className="builder-form-stack">
          <div className="builder-subheading">
            <div>
              <h3>{ar ? "بطاقة العميل" : "Customer card"}</h3>
              <p>
                {ar
                  ? "اختر تركيب بطاقة الويب الغني الذي يراه العميل."
                  : "Choose the richer web-card composition customers see."}
              </p>
            </div>
          </div>
          <FormField label={ar ? "تركيب بطاقة العميل" : "Customer card layout"}>
            <Select
              value={draft.visualTheme.customerWebVariant}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  visualTheme: {
                    ...current.visualTheme,
                    customerWebVariant: event.target.value as "CARD" | "MINIMAL" | "HERO",
                  },
                }))
              }
            >
              <option value="CARD">{ar ? "بطاقة" : "Card"}</option>
              <option value="MINIMAL">{ar ? "مبسطة" : "Minimal"}</option>
              <option value="HERO">{ar ? "بارزة" : "Hero"}</option>
            </Select>
          </FormField>
          <div className="builder-subheading">
            <div>
              <h3>Apple Wallet</h3>
              <p>
                {ar
                  ? "هذه النصوص تخص المعاينة التي يدعمها Apple Wallet."
                  : "These labels apply to the fields supported by Apple Wallet."}
              </p>
            </div>
          </div>
          <div className="builder-form-grid">
            {(
              [
                ["headerLabel", ar ? "عنوان الرأس" : "Header label"],
                ["headerValue", ar ? "قيمة الرأس" : "Header value"],
                ["secondaryLabel", ar ? "العنوان الثانوي" : "Secondary label"],
                ["barcodeLabel", ar ? "عنوان الرمز" : "Barcode label"],
              ] as const
            ).map(([key, label]) => (
              <FormField key={key} label={label}>
                <TextInput
                  value={draft.visualTheme.applePreviewConfig[key]}
                  onChange={(event) =>
                    update((current) => ({
                      ...current,
                      visualTheme: {
                        ...current.visualTheme,
                        applePreviewConfig: {
                          ...current.visualTheme.applePreviewConfig,
                          [key]: event.target.value,
                        },
                      },
                    }))
                  }
                />
              </FormField>
            ))}
          </div>
          <Checkbox
            checked={draft.visualTheme.applePreviewConfig.showBackContent}
            label={ar ? "إظهار محتوى ظهر بطاقة Apple" : "Show Apple card back content"}
            onChange={(event) =>
              update((current) => ({
                ...current,
                visualTheme: {
                  ...current.visualTheme,
                  applePreviewConfig: {
                    ...current.visualTheme.applePreviewConfig,
                    showBackContent: event.target.checked,
                  },
                },
              }))
            }
          />
          <div className="builder-subheading">
            <div>
              <h3>Google Wallet</h3>
              <p>
                {ar
                  ? "هذه النصوص تخص المعاينة التي يدعمها Google Wallet."
                  : "These labels apply to the fields supported by Google Wallet."}
              </p>
            </div>
          </div>
          <div className="builder-form-grid">
            {(
              [
                ["title", ar ? "العنوان" : "Title"],
                ["subtitle", ar ? "العنوان الفرعي" : "Subtitle"],
                ["detailsLabel", ar ? "عنوان التفاصيل" : "Details label"],
                ["barcodeLabel", ar ? "عنوان الرمز" : "Barcode label"],
              ] as const
            ).map(([key, label]) => (
              <FormField key={key} label={label}>
                <TextInput
                  value={draft.visualTheme.googlePreviewConfig[key]}
                  onChange={(event) =>
                    update((current) => ({
                      ...current,
                      visualTheme: {
                        ...current.visualTheme,
                        googlePreviewConfig: {
                          ...current.visualTheme.googlePreviewConfig,
                          [key]: event.target.value,
                        },
                      },
                    }))
                  }
                />
              </FormField>
            ))}
          </div>
        </div>
      </details>
      <FormField label={ar ? "ملخص التغييرات" : "Change summary"}>
        <TextInput
          value={draft.changeSummary ?? ""}
          maxLength={240}
          onChange={(event) =>
            update((current) => ({ ...current, changeSummary: event.target.value }))
          }
        />
      </FormField>
      <Alert
        tone="info"
        title={ar ? "سلوك المكافأة النهائية ثابت" : "Final reward behavior is fixed"}
      >
        {ar
          ? "تبقى جميع الخانات ممتلئة عند بلوغ الهدف، وتُعاد إلى فارغة فقط بعد نجاح استرداد المكافأة النهائية."
          : "At the goal every slot remains filled; the grid resets to empty only after final reward redemption succeeds."}
      </Alert>
    </div>
  );
}

function ReviewSection({
  draft,
  readiness,
  validation,
  canRunChecks,
  testSession,
  working,
  locale,
  onSection,
  onRunChecks,
  onStartTest,
  onTestCommand,
}: {
  draft: ProgramDraftInput;
  readiness: ReturnType<typeof builderReadiness>;
  validation: ValidationResult | null;
  canRunChecks: boolean;
  testSession: TestSession | null;
  working: boolean;
  locale: Locale;
  onSection: (section: BuilderSection) => void;
  onRunChecks: () => void;
  onStartTest: () => void;
  onTestCommand: (kind: "add" | "reset" | "redeem") => void;
}) {
  const ar = locale === "ar";
  const text = copy[locale];
  const items: Array<{
    section: Exclude<BuilderSection, "advanced" | "review">;
    label: string;
    summary: string;
    complete: boolean;
  }> = [
    {
      section: "basics",
      label: text.sections.basics,
      summary: text.basicsSummary,
      complete: readiness.basics,
    },
    {
      section: "reward",
      label: text.sections.reward,
      summary: text.rewardSummary,
      complete: readiness.reward,
    },
    {
      section: "languages",
      label: text.sections.languages,
      summary: text.languageSummary,
      complete: readiness.languages,
    },
    {
      section: "locations",
      label: text.sections.locations,
      summary: text.locationSummary,
      complete: readiness.locations,
    },
    {
      section: "appearance",
      label: text.sections.appearance,
      summary: text.appearanceSummary,
      complete: readiness.appearance,
    },
  ];
  const goal = testSession?.version.stampRule?.requiredStampCount ?? draft.requiredStampCount;
  const rewardReady = Boolean(testSession && testSession.currentStampCount >= goal);
  return (
    <div className="builder-form-stack">
      <Alert
        tone={readiness.ready ? "success" : "warning"}
        title={readiness.ready ? text.ready : text.needsAttention}
      >
        {text.noPublish}
      </Alert>
      <div className="builder-readiness-list">
        {items.map((item) => (
          <button type="button" key={item.section} onClick={() => onSection(item.section)}>
            <span
              className={
                item.complete ? "builder-readiness__complete" : "builder-readiness__missing"
              }
            >
              {item.complete ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <CircleAlert size={16} aria-hidden="true" />
              )}
            </span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.summary}</small>
            </span>
            <span>{item.complete ? text.complete : text.fix}</span>
          </button>
        ))}
      </div>
      <Card className="builder-checks">
        <div className="builder-subheading">
          <div>
            <h3>{ar ? "فحوصات الجاهزية" : "Readiness checks"}</h3>
            <p>
              {!validation
                ? text.checksNotRun
                : validation.errors.length
                  ? text.issuesFound
                  : text.checksPassed}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={onRunChecks}
            loading={working}
            disabled={!canRunChecks}
          >
            {validation && validation.errors.length === 0 ? text.runAgain : text.runChecks}
          </Button>
        </div>
        {validation ? (
          <div className="builder-validation-list">
            {[...validation.errors, ...validation.warnings].map((issue) => (
              <button
                type="button"
                key={`${issue.code}-${issue.path}`}
                onClick={() => onSection(builderSectionForIssue(issue))}
              >
                <CircleAlert size={17} aria-hidden="true" />
                <span>
                  <strong>{issue.message}</strong>
                  <small>{issue.suggestedAction}</small>
                </span>
                <span>{text.fix}</span>
              </button>
            ))}
            {!validation.errors.length && !validation.warnings.length ? (
              <p className="builder-checks__clear">
                <Check size={17} aria-hidden="true" /> {text.checksPassed}
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>
      <Card className="builder-test-mode">
        <FlaskConical size={26} aria-hidden="true" />
        <div>
          <h3>{text.testMode}</h3>
          <p>{text.testModeDescription}</p>
        </div>
        {!testSession ? (
          <Button
            type="button"
            variant="secondary"
            disabled={!validation || validation.errors.length > 0}
            onClick={onStartTest}
            loading={working}
          >
            {text.startTest}
          </Button>
        ) : (
          <div className="builder-test-controls">
            <div className="builder-test-meter">
              <strong>
                {testSession.currentStampCount}/{goal}
              </strong>
              <progress value={testSession.currentStampCount} max={goal} />
            </div>
            {rewardReady ? <Alert tone="success" title={text.rewardReady} /> : null}
            <div className="builder-test-actions">
              <Button
                type="button"
                disabled={working || rewardReady}
                onClick={() => onTestCommand("add")}
              >
                {text.addStamp}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={working}
                onClick={() => onTestCommand("reset")}
              >
                <RotateCcw size={15} aria-hidden="true" />
                {text.resetTest}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={working || !rewardReady}
                onClick={() => onTestCommand("redeem")}
              >
                {text.redeemReward}
              </Button>
            </div>
          </div>
        )}
        {!validation ? <small>{text.testRequired}</small> : null}
      </Card>
    </div>
  );
}

function PreviewPanel({
  idPrefix,
  draft,
  locale,
  previewLocale,
  setPreviewLocale,
  profile,
  setProfile,
  progress,
  setProgress,
  preview,
  previewLoading,
  previewError,
  stale,
  onRetry,
}: {
  idPrefix: string;
  draft: ProgramDraftInput;
  locale: Locale;
  previewLocale: "EN" | "AR";
  setPreviewLocale: Dispatch<SetStateAction<"EN" | "AR">>;
  profile: PreviewProfile;
  setProfile: Dispatch<SetStateAction<PreviewProfile>>;
  progress: number;
  setProgress: Dispatch<SetStateAction<number>>;
  preview: PreviewResult | undefined;
  previewLoading: boolean;
  previewError: boolean;
  stale: boolean;
  onRetry: () => void;
}) {
  const text = copy[locale];
  return (
    <div className="builder-preview-panel">
      <div className="builder-preview-header">
        <div>
          <span className="dashboard-card__label">{text.previewOnly}</span>
          <h2>{text.preview}</h2>
        </div>
        <fieldset className="builder-preview-language">
          <legend className="wf-sr-only">
            {locale === "ar" ? "لغة المعاينة" : "Preview language"}
          </legend>
          <button
            type="button"
            aria-pressed={previewLocale === "EN"}
            onClick={() => setPreviewLocale("EN")}
          >
            EN
          </button>
          <button
            type="button"
            aria-pressed={previewLocale === "AR"}
            onClick={() => setPreviewLocale("AR")}
          >
            AR
          </button>
        </fieldset>
      </div>
      <div className="builder-preview-tabs" role="tablist" aria-label={text.preview}>
        {previewProfiles.map((item) => (
          <button
            type="button"
            role="tab"
            id={`${idPrefix}-${item}`}
            aria-selected={profile === item}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={profile === item ? 0 : -1}
            key={item}
            onClick={() => setProfile(item)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const current = previewProfiles.indexOf(profile);
              const logicalForward = locale === "ar" ? -1 : 1;
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? previewProfiles.length - 1
                    : (current +
                        (event.key === "ArrowRight" ? logicalForward : -logicalForward) +
                        previewProfiles.length) %
                      previewProfiles.length;
              const nextProfile = previewProfiles[next];
              if (!nextProfile) return;
              setProfile(nextProfile);
              requestAnimationFrame(() =>
                document.getElementById(`${idPrefix}-${nextProfile}`)?.focus(),
              );
            }}
          >
            {previewLabel(item, locale)}
          </button>
        ))}
      </div>
      <p className="builder-preview-provider-note">{text.walletPreviewNote}</p>
      <div
        id={`${idPrefix}-panel`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-${profile}`}
        aria-busy={previewLoading}
        className={`builder-preview-canvas builder-preview-canvas--${profile.toLocaleLowerCase("en-US")} ${preview ? "builder-preview-canvas--ready" : "builder-preview-canvas--empty"}`}
      >
        {preview ? (
          <Image
            src={previewSource(preview.svg)}
            alt={`${previewLabel(profile, locale)} ${text.previewOnly}`}
            width={preview.width}
            height={preview.height}
            unoptimized
            priority
          />
        ) : (
          <div className="builder-preview-empty" role="status">
            <RefreshCcw
              className={previewLoading ? "studio-spin" : ""}
              size={20}
              aria-hidden="true"
            />
            <strong>{previewLabel(profile, locale)}</strong>
            <span>{previewLoading ? text.previewPreparing : text.previewPending}</span>
          </div>
        )}
        {preview && (previewLoading || stale) ? (
          <div className="builder-preview-status" role="status">
            <RefreshCcw
              className={previewLoading ? "studio-spin" : ""}
              size={18}
              aria-hidden="true"
            />
            {previewLoading ? text.previewLoading : text.previewPending}
          </div>
        ) : null}
      </div>
      {previewError ? (
        <Alert tone="warning" title={text.previewError}>
          <Button type="button" variant="secondary" onClick={onRetry}>
            {text.retry}
          </Button>
        </Alert>
      ) : null}
      {preview?.warnings.map((warning) => (
        <Alert key={warning.code} tone="warning" title={warning.message} />
      ))}
      <FormField label={text.previewProgress}>
        <div className="builder-preview-progress">
          <input
            type="range"
            min={0}
            max={draft.requiredStampCount}
            value={progress}
            onChange={(event) => setProgress(Number(event.target.value))}
          />
          <output>
            {progress}/{draft.requiredStampCount}
          </output>
        </div>
      </FormField>
    </div>
  );
}
