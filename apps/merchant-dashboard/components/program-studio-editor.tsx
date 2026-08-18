"use client";

import {
  decideProgramPublicationState,
  type ProgramOperationalStatus,
  type ProgramPreviewPlatform,
  programPlatformCapabilities,
  timeZoneOptions,
} from "@waflo/contracts";
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  Card,
  Checkbox,
  ColorInput,
  FormField,
  Modal,
  SearchableSelect,
  Select,
  TextArea,
  TextInput,
} from "@waflo/ui";
import {
  Archive,
  ArrowLeft,
  BellRing,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  Eye,
  Gift,
  History,
  LayoutDashboard,
  MapPinned,
  Menu,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Rocket,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Store,
  Trash2,
  UploadCloud,
  Workflow,
  X,
} from "lucide-react";
import Image from "next/image";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiClientError, apiFetch } from "../lib/api-client";
import {
  type MerchantProgramLifecycleAction,
  merchantProgramLifecycleLabel,
} from "./loyalty-card-presentation";
import { ProgramAssetPicker } from "./program-asset-uploader";
import {
  type EnrollmentSettings,
  ProgramEnrollmentSettings,
  type WalletHealth,
} from "./program-enrollment-settings";
import {
  LaunchPanel,
  LiveAccessSummary,
  type OrganizationPublicationContext,
  type PublicationCommandResult,
  PublicationConfirmationDialog,
  type PublicationFailureState,
  type PublicationSuccessState,
} from "./program-launch-experience";
import {
  deriveProgramSharingPresentation,
  hasSavedUnpublishedChanges,
  publicationFailurePresentation,
  publicationMode,
  selectCustomerPreviewSource,
} from "./program-publication-presentation";
import {
  selectStudioLocalizedProgramContent,
  selectStudioLocalizedRewardContent,
} from "./program-studio-localization";
import {
  deriveStudioLifecyclePresentation,
  type StudioArea,
  type StudioLifecyclePresentation,
  studioAreaCopy,
  studioAreaForPublicationError,
  studioAreaForValidationPath,
  studioAreas,
  studioOperationError,
} from "./program-studio-presentation";
import {
  type AssetItem,
  apiDraft,
  type LocationItem,
  type PreviewProfile,
  type ProgramDetail,
  type ProgramDraftInput,
  type ProgramVersion,
  type RewardInput,
  type StudioSection,
  type ValidationIssue,
  type ValidationResult,
  versionToDraft,
} from "./program-studio-types";
import { WalletEngagementPanel } from "./wallet-engagement-panel";

type SaveState = "saved" | "unsaved" | "saving" | "failed" | "conflict";
type PreviewLoadState = "idle" | "loading" | "available" | "unavailable";
type LifecycleAction = MerchantProgramLifecycleAction;

interface PreviewResult {
  svg: string;
  width: number;
  height: number;
  warnings: Array<{ code: string; message: string }>;
  profile: PreviewProfile;
}

interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

interface ConflictState {
  localRevision: number;
  serverRevision: number;
  localDraft: ProgramDraftInput;
}

interface ProgramAuditEvent {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  createdAt: string;
  actor: { id: string; displayName: string } | null;
  metadata?: Record<string, unknown> | null;
}

function statusLabel(state: SaveState, ar: boolean) {
  const labels: Record<SaveState, [string, string]> = {
    saved: ["Saved", "تم الحفظ"],
    unsaved: ["Unsaved changes", "تغييرات غير محفوظة"],
    saving: ["Saving…", "جارٍ الحفظ…"],
    failed: ["Save failed", "فشل الحفظ"],
    conflict: ["Edited elsewhere", "تم التحرير في مكان آخر"],
  };
  return labels[state][ar ? 1 : 0];
}

function hasPublishedCustomerPreviewPayload(version: ProgramVersion): boolean {
  return Boolean(version.translations.length && version.stampRule && version.visualTheme);
}

function lifecycleActionLabel(action: LifecycleAction, ar: boolean): string {
  return merchantProgramLifecycleLabel(action, ar ? "ar" : "en");
}

function lifecycleActionDescription(
  action: LifecycleAction,
  ar: boolean,
  options: { hasPublishedVersion: boolean; pausedWithPublishedVersion: boolean },
): string {
  if (action === "publish") {
    if (options.pausedWithPublishedVersion) {
      return ar
        ? "ستُنشر التغييرات الجديدة، لكن البطاقة ستظل متوقفة مؤقتاً. استخدم الاستئناف بشكل منفصل عندما تكون مستعداً لإعادتها للعمل."
        : "The new changes will be published, but the card will remain paused. Resume it separately when you are ready to make it live.";
    }
    return ar
      ? "تصبح التغييرات التي راجعتها مباشرة للعملاء بعد اكتمال التحقق الآلي."
      : "The reviewed changes become live for customers after automatic validation is complete.";
  }
  if (action === "abandon") {
    return ar
      ? "ستُعلَّم المسودة القابلة للتحرير كمسودة متروكة، بينما تبقى البطاقة المنشورة مباشرة."
      : "The editable draft will be marked abandoned. The published card remains live.";
  }
  if (action === "archive" && !options.hasPublishedVersion) {
    return ar
      ? "تُؤرشف البطاقة غير المنشورة بأمان، مع الاحتفاظ بمسودتها الحالية وسجل تغييراتها لاستعادتها لاحقاً."
      : "Archive this unpublished card safely. Its current draft and change history will be preserved for restoration.";
  }
  if (action === "restore" && !options.hasPublishedVersion) {
    return ar
      ? "تعود البطاقة غير المنشورة إلى حالة المسودة المحفوظة."
      : "Restore this unpublished card to its preserved draft state.";
  }
  const descriptions: Record<Exclude<LifecycleAction, "publish" | "abandon">, [string, string]> = {
    pause: [
      "New enrollment, stamp earning, and reward use will stop. Existing customer cards remain viewable while paused, and a Wallet status sync will be queued.",
      "سيتوقف التسجيل الجديد وإصدار الأختام واستخدام المكافآت. تبقى بطاقات العملاء الحاليين قابلة للعرض، وستتم جدولة مزامنة حالة Wallet.",
    ],
    resume: [
      "Enrollment and loyalty operations return according to the published policy, and a Wallet status sync will be queued.",
      "يعود التسجيل وعمليات الولاء وفق السياسة المنشورة، وستتم جدولة مزامنة حالة Wallet.",
    ],
    archive: [
      "The card leaves discovery and stops enrollment and loyalty operations. Existing direct cards remain viewable, setup and history are preserved, the active-card slot is freed, and Wallet invalidation is queued.",
      "ستغادر البطاقة الاكتشاف ويتوقف التسجيل وعمليات الولاء. تبقى البطاقات المباشرة الحالية قابلة للعرض، وتُحفظ الإعدادات والسجل، وتتحرر خانة بطاقة نشطة، وتتم جدولة إبطال Wallet.",
    ],
    restore: [
      "The plan limit will be checked, then the card returns to its preserved published or draft state and a Wallet status sync is queued.",
      "سيتم فحص حد الخطة، ثم تعود البطاقة إلى حالتها المنشورة أو مسودتها المحفوظة وتتم جدولة مزامنة Wallet.",
    ],
  };
  return descriptions[action][ar ? 1 : 0];
}

function publicationStateGuidance(status: ProgramOperationalStatus, ar: boolean) {
  if (status === "ARCHIVED")
    return {
      title: ar ? "البطاقة مؤرشفة" : "Restore required before publishing",
      message: ar
        ? "استعد البطاقة أولاً، ثم راجع المسودة وانشرها."
        : "Restore this card before publishing. Its preserved draft will remain available.",
    };
  if (status === "SUSPENDED")
    return {
      title: ar ? "النشر غير متاح" : "Publishing is unavailable",
      message: ar
        ? "لا يمكن نشر هذه البطاقة في حالتها الحالية. تواصل مع الدعم للمساعدة."
        : "This card cannot be published in its current state. Contact support for assistance.",
    };
  if (status === "SCHEDULED")
    return {
      title: ar ? "النشر المجدول غير متاح" : "Scheduled publishing is unavailable",
      message: ar
        ? "لا يمكن نشر البطاقة المجدولة حتى تتوفر ميزة الجدولة."
        : "This card cannot publish while scheduling is not implemented.",
    };
  return {
    title: ar ? "حالة البطاقة تمنع النشر" : "Card status blocks publishing",
    message: ar
      ? "راجع حالة البطاقة قبل محاولة النشر."
      : "Review the card status before publishing.",
  };
}

export function ProgramStudioEditor({
  organizationId,
  programId,
  plan,
  locations,
  assets,
  onAssetUploaded,
  ar,
  canManageEngagement,
  initialArea = "overview",
  onAreaChange,
  onClose,
  onEditDesign,
  onOpenCustomers,
  onOpenBilling,
  onChanged,
}: {
  organizationId: string;
  programId: string;
  plan: "STARTER" | "GROWTH" | "SCALE";
  locations: LocationItem[];
  assets: AssetItem[];
  onAssetUploaded: (asset: AssetItem) => void;
  ar: boolean;
  canManageEngagement: boolean;
  builderHandoff?: boolean;
  initialArea?: StudioArea;
  onAreaChange?: (area: StudioArea, options?: { restoreFocus?: boolean }) => void;
  onClose: () => void;
  onEditDesign: () => void;
  onOpenCustomers: () => void;
  onOpenBilling: () => void;
  onChanged: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<ProgramDetail | null>(null);
  const [draft, setDraft] = useState<ProgramDraftInput | null>(null);
  const [revision, setRevision] = useState(1);
  const [activeArea, setActiveArea] = useState<StudioArea>(initialArea);
  const [selectedProfile, setSelectedProfile] = useState<PreviewProfile>("CUSTOMER_WEB");
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [previews, setPreviews] = useState<Partial<Record<PreviewProfile, PreviewResult>>>({});
  const [previewLoadState, setPreviewLoadState] = useState<PreviewLoadState>("idle");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [historicalVersion, setHistoricalVersion] = useState<ProgramVersion | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<LifecycleAction | null>(null);
  const [working, setWorking] = useState(false);
  const [organization, setOrganization] = useState<OrganizationPublicationContext | null>(null);
  const [enrollmentAccess, setEnrollmentAccess] = useState<EnrollmentSettings | null>(null);
  const [walletHealth, setWalletHealth] = useState<WalletHealth[]>([]);
  const [publicationSuccess, setPublicationSuccess] = useState<PublicationSuccessState | null>(
    null,
  );
  const [publicationFailure, setPublicationFailure] = useState<PublicationFailureState | null>(
    null,
  );
  const [auditEvents, setAuditEvents] = useState<ProgramAuditEvent[]>([]);
  const [lifecycleNotice, setLifecycleNotice] = useState<{
    title: string;
    message: string;
    action: Exclude<LifecycleAction, "publish">;
  } | null>(null);
  const persistedRef = useRef("");
  const initializedRef = useRef(false);
  const mobileNavigationTriggerRef = useRef<HTMLButtonElement>(null);
  const publishKeyRef = useRef<string | null>(null);

  function selectArea(area: StudioArea) {
    const restoreMobileFocus = mobileNavigationOpen;
    setActiveArea(area);
    onAreaChange?.(area, { restoreFocus: restoreMobileFocus });
    setMobileNavigationOpen(false);
    if (restoreMobileFocus && !onAreaChange) {
      window.requestAnimationFrame(() => mobileNavigationTriggerRef.current?.focus());
    }
  }

  useEffect(() => {
    setActiveArea(initialArea);
  }, [initialArea]);

  const load = useCallback(async () => {
    const [program, history, nextOrganization, access, providers, audit] = await Promise.all([
      apiFetch<ProgramDetail>(`/v1/organizations/${organizationId}/programs/${programId}`),
      apiFetch<CursorPage<ProgramVersion>>(
        `/v1/organizations/${organizationId}/programs/${programId}/versions?limit=20`,
      ),
      apiFetch<OrganizationPublicationContext>(`/v1/organizations/${organizationId}`),
      apiFetch<EnrollmentSettings>(
        `/v1/organizations/${organizationId}/programs/${programId}/enrollment`,
      ),
      apiFetch<WalletHealth[]>(`/v1/organizations/${organizationId}/wallet/providers`).catch(
        () => [] as WalletHealth[],
      ),
      apiFetch<CursorPage<ProgramAuditEvent>>(
        `/v1/organizations/${organizationId}/audit?action=program.&limit=50`,
      ).catch(() => ({ items: [], nextCursor: null }) as CursorPage<ProgramAuditEvent>),
    ]);
    program.versions = history.items;
    const versionIds = new Set(history.items.map((version) => version.id));
    setAuditEvents(
      audit.items.filter(
        (event) =>
          event.targetId === programId ||
          (event.targetId ? versionIds.has(event.targetId) : false) ||
          event.metadata?.programId === programId,
      ),
    );
    setHistoryCursor(history.nextCursor);
    setDetail(program);
    setPreviews({});
    setPreviewLoadState("idle");
    setOrganization(nextOrganization);
    setEnrollmentAccess(access);
    setWalletHealth(providers);
    if (program.currentDraftVersion) {
      const next = versionToDraft(program, program.currentDraftVersion);
      setDraft(next);
      setRevision(program.currentDraftVersion.revision);
      persistedRef.current = JSON.stringify(apiDraft(next));
      setSaveState("saved");
    } else {
      setDraft(null);
    }
    initializedRef.current = true;
  }, [organizationId, programId]);

  async function loadMoreVersions() {
    if (!historyCursor) return;
    const page = await apiFetch<CursorPage<ProgramVersion>>(
      `/v1/organizations/${organizationId}/programs/${programId}/versions?limit=20&cursor=${encodeURIComponent(historyCursor)}`,
    );
    setDetail((current) =>
      current
        ? {
            ...current,
            versions: [
              ...current.versions,
              ...page.items.filter(
                (item) => !current.versions.some((existing) => existing.id === item.id),
              ),
            ],
          }
        : current,
    );
    setHistoryCursor(page.nextCursor);
  }

  useEffect(() => {
    void load().catch(() => setError(studioOperationError("load", ar ? "ar" : "en")));
  }, [ar, load]);

  useEffect(() => {
    if (!draft || !initializedRef.current || conflict) return;
    const serialized = JSON.stringify(apiDraft(draft));
    if (serialized === persistedRef.current) return;
    setSaveState("unsaved");
    setPreviews({});
    setPreviewLoadState("idle");
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        const updated = await apiFetch<{
          currentDraftVersion: ProgramVersion;
        }>(`/v1/organizations/${organizationId}/programs/${programId}`, {
          method: "PATCH",
          body: JSON.stringify({ ...apiDraft(draft), revision }),
        });
        persistedRef.current = serialized;
        setRevision(updated.currentDraftVersion.revision);
        setDetail((current) =>
          current ? { ...current, currentDraftVersion: updated.currentDraftVersion } : current,
        );
        setSaveState("saved");
        setValidation(null);
      } catch (caught) {
        if (caught instanceof ApiClientError && caught.code === "STALE_PROGRAM_DRAFT") {
          const serverRevision =
            typeof caught.details?.expectedRevision === "number"
              ? caught.details.expectedRevision
              : revision + 1;
          setConflict({ localRevision: revision, serverRevision, localDraft: draft });
          setSaveState("conflict");
        } else {
          setSaveState("failed");
          setError(studioOperationError("save", ar ? "ar" : "en"));
        }
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [ar, conflict, draft, organizationId, programId, revision]);

  const generatePreviews = useCallback(async () => {
    if (!draft) return;
    if (saveState !== "saved" || JSON.stringify(apiDraft(draft)) !== persistedRef.current) return;
    setPreviewLoadState("loading");
    try {
      const results: PreviewResult[] = [];
      for (const profile of ["CUSTOMER_WEB", "APPLE_WALLET", "GOOGLE_WALLET"] as const) {
        results.push(
          await apiFetch<PreviewResult>(
            `/v1/organizations/${organizationId}/programs/${programId}/preview?progress=${progress}&profile=${profile}&locale=${ar ? "AR" : "EN"}`,
          ),
        );
      }
      setPreviews(Object.fromEntries(results.map((item) => [item.profile, item])));
      setPreviewLoadState("available");
    } catch {
      setPreviews({});
      setPreviewLoadState("unavailable");
      setError(studioOperationError("preview", ar ? "ar" : "en"));
    }
  }, [ar, draft, organizationId, programId, progress, saveState]);

  useEffect(() => {
    const timer = window.setTimeout(() => void generatePreviews(), 250);
    return () => window.clearTimeout(timer);
  }, [generatePreviews]);

  async function reloadLatest() {
    setConflict(null);
    initializedRef.current = false;
    await load();
  }

  function reapplyLocal() {
    if (!conflict) return;
    setDraft(conflict.localDraft);
    setRevision(conflict.serverRevision);
    setConflict(null);
    setSaveState("unsaved");
  }

  async function copyLocal() {
    if (!conflict) return;
    await navigator.clipboard.writeText(JSON.stringify(apiDraft(conflict.localDraft), null, 2));
  }

  function exportLocal() {
    if (!conflict) return;
    const blob = new Blob([JSON.stringify(apiDraft(conflict.localDraft), null, 2)], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `waflo-local-draft-rev-${conflict.localRevision}.json`;
    link.click();
    URL.revokeObjectURL(href);
  }

  async function validate() {
    setWorking(true);
    setError("");
    try {
      await generatePreviews();
      const result = await apiFetch<ValidationResult>(
        `/v1/organizations/${organizationId}/programs/${programId}/validate`,
        { method: "POST" },
      );
      setValidation(result);
      await load();
    } catch {
      setError(studioOperationError("readiness", ar ? "ar" : "en"));
    } finally {
      setWorking(false);
    }
  }

  async function lifecycle(action: NonNullable<typeof confirmation>) {
    if (working) return;
    setWorking(true);
    setError("");
    if (action === "publish") setPublicationFailure(null);
    try {
      if (action === "publish") {
        const mode = publicationMode(Boolean(detail?.currentPublishedVersion));
        const remainedPaused = detail?.status === "PAUSED";
        const idempotencyKey = publishKeyRef.current ?? crypto.randomUUID();
        publishKeyRef.current = idempotencyKey;
        let command: PublicationCommandResult | null = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            command = await apiFetch<PublicationCommandResult>(
              `/v1/organizations/${organizationId}/programs/${programId}/publish`,
              {
                method: "POST",
                body: JSON.stringify({ idempotencyKey }),
              },
            );
            break;
          } catch (caught) {
            const transientConflict =
              caught instanceof ApiClientError && caught.code === "CONCURRENT_MODIFICATION_RETRY";
            if (!transientConflict || attempt === 1) throw caught;
            await new Promise<void>((resolve) => window.setTimeout(resolve, 180));
          }
        }
        if (!command) throw new ApiClientError("PUBLICATION_FAILED", "Publication failed.");
        setConfirmation(null);
        await load();
        await onChanged();
        setPublicationSuccess({ mode, remainedPaused, command });
        publishKeyRef.current = null;
        window.requestAnimationFrame(() =>
          window.requestAnimationFrame(() =>
            document.getElementById("publication-success")?.focus(),
          ),
        );
        return;
      } else if (action === "abandon")
        await apiFetch(`/v1/organizations/${organizationId}/programs/${programId}/draft/abandon`, {
          method: "POST",
        });
      else
        await apiFetch(`/v1/organizations/${organizationId}/programs/${programId}/${action}`, {
          method: "POST",
        });
      setConfirmation(null);
      await load();
      await onChanged();
      if (action === "archive") selectArea("settings");
      const notices: Record<
        Exclude<LifecycleAction, "publish">,
        [string, string, string, string]
      > = {
        pause: [
          "Loyalty card paused",
          "New enrollment and loyalty operations are stopped. Existing cards remain viewable.",
          "تم إيقاف بطاقة الولاء",
          "توقف التسجيل الجديد وعمليات الولاء. تبقى البطاقات الحالية قابلة للعرض.",
        ],
        resume: [
          "Loyalty card resumed",
          "Customer access and loyalty operations now follow the published policy.",
          "تم استئناف بطاقة الولاء",
          "يتبع وصول العملاء وعمليات الولاء الآن السياسة المنشورة.",
        ],
        archive: [
          "Loyalty card archived",
          "The setup and change history are preserved, and the active-card slot is available again.",
          "تمت أرشفة بطاقة الولاء",
          "تم حفظ الإعدادات وسجل التغييرات، وأصبحت خانة البطاقة النشطة متاحة مجددًا.",
        ],
        restore: [
          "Loyalty card restored",
          "The card returned to its preserved state after the plan check passed.",
          "تمت استعادة بطاقة الولاء",
          "عادت البطاقة إلى حالتها المحفوظة بعد اجتياز فحص الخطة.",
        ],
        abandon: [
          "Draft abandoned",
          "The published card remains unchanged and the abandoned update stays in history.",
          "تم التخلي عن المسودة",
          "تبقى البطاقة المنشورة دون تغيير ويظل الإصدار المتروك في السجل.",
        ],
      };
      const notice = notices[action];
      setLifecycleNotice({
        title: notice[ar ? 2 : 0],
        message: notice[ar ? 3 : 1],
        action,
      });
    } catch (caught) {
      if (action === "publish") {
        const code = caught instanceof ApiClientError ? caught.code : "NETWORK_ERROR";
        setPublicationFailure({ code, presentation: publicationFailurePresentation(code, ar) });
        setConfirmation(null);
        selectArea("launch");
        return;
      }
      if (caught instanceof ApiClientError) selectArea(studioAreaForPublicationError(caught.code));
      if (
        caught instanceof ApiClientError &&
        caught.code === "PROGRAM_PUBLICATION_STATE_BLOCKED" &&
        typeof caught.details?.programStatus === "string"
      )
        setError(
          publicationStateGuidance(caught.details.programStatus as ProgramOperationalStatus, ar)
            .message,
        );
      else setError(studioOperationError("lifecycle", ar ? "ar" : "en"));
    } finally {
      setWorking(false);
    }
  }

  async function createDraft() {
    setWorking(true);
    try {
      await apiFetch(`/v1/organizations/${organizationId}/programs/${programId}/draft`, {
        method: "POST",
      });
      await load();
      await onChanged();
      setPublicationSuccess(null);
      setPublicationFailure(null);
    } catch {
      setError(studioOperationError("create-draft", ar ? "ar" : "en"));
    } finally {
      setWorking(false);
    }
  }

  async function viewHistorical(versionId: string) {
    const version = await apiFetch<ProgramVersion>(
      `/v1/organizations/${organizationId}/programs/${programId}/versions/${versionId}`,
    );
    setHistoricalVersion(version);
  }

  const editingVersion = detail?.currentDraftVersion ?? null;
  const displayVersion = editingVersion ?? detail?.currentPublishedVersion ?? null;
  const displayDraft =
    draft ?? (detail && displayVersion ? versionToDraft(detail, displayVersion) : null);
  const designComplete = Boolean(
    displayDraft?.internalName.trim() &&
      displayDraft.translations.en.programName.trim() &&
      displayDraft.translations.ar.programName.trim() &&
      displayDraft.rewards.length,
  );
  const locationsReady = Boolean(displayDraft?.locationIds.length);
  const validated =
    ["VALIDATED", "TEST_READY"].includes(editingVersion?.status ?? "") ||
    Boolean(validation && validation.errors.length === 0);
  const selectedPreview = previews[selectedProfile];

  if (!detail) {
    if (error) {
      return (
        <Card className="builder-loading builder-loading--unavailable" role="alert">
          <CircleAlert aria-hidden="true" />
          <div>
            <strong>{ar ? "تعذر فتح استوديو الولاء" : "Loyalty Studio could not open"}</strong>
            <p>
              {ar
                ? "لم تتغير أي بيانات. ارجع إلى بطاقات الولاء وتحقق من البطاقة أو صلاحية الوصول."
                : "No card data was changed. Return to Loyalty cards and check the card or your access."}
            </p>
          </div>
          <Button variant="secondary" onClick={onClose}>
            <ArrowLeft className="studio-back-icon" size={16} aria-hidden="true" />
            {ar ? "بطاقات الولاء" : "Loyalty cards"}
          </Button>
        </Card>
      );
    }
    return <StudioLoadingSkeleton ar={ar} />;
  }

  if (!displayDraft || !displayVersion) {
    return (
      <div className="studio-shell" dir={ar ? "rtl" : "ltr"}>
        <Button variant="secondary" onClick={onClose}>
          <ArrowLeft className="studio-back-icon" size={16} aria-hidden="true" />
          {ar ? "بطاقات الولاء" : "Loyalty cards"}
        </Button>
        <Card className="studio-live-only" role="status">
          <CircleAlert size={32} aria-hidden="true" />
          <h1>{ar ? "لا يوجد إعداد محفوظ لهذه البطاقة" : "This card has no saved setup"}</h1>
          <p>
            {ar
              ? "ارجع إلى بطاقات الولاء واختر بطاقة أخرى."
              : "Return to Loyalty cards and choose another card."}
          </p>
        </Card>
      </div>
    );
  }

  const locale = ar ? "ar" : "en";
  const areaCopy = studioAreaCopy[locale][activeArea];
  const publicationDecision = decideProgramPublicationState({
    programStatus: detail.status,
    hasCurrentPublishedVersion: detail.currentPublishedVersion !== null,
  });
  const savedUnpublishedChanges = hasSavedUnpublishedChanges({
    hasPublishedVersion: detail.currentPublishedVersion !== null,
    hasDraftVersion: detail.currentDraftVersion !== null,
  });
  const activePublicationMode = publicationMode(detail.currentPublishedVersion !== null);
  const lifecycleState = deriveStudioLifecyclePresentation({
    programStatus: detail.status,
    draftVersionStatus: editingVersion?.status ?? displayVersion.status,
    locale,
    validationState: validated ? "passed" : validation ? "failed" : "not-run",
    designComplete,
    locationsReady,
    hasPublishedVersion: detail.currentPublishedVersion !== null,
    hasUnpublishedChanges: savedUnpublishedChanges,
    publicationAllowed: publicationDecision.allowed,
    planName: plan,
    validationIssues: validation?.errors,
  });

  return (
    <div className="studio-shell studio-shell--p4" dir={ar ? "rtl" : "ltr"}>
      <div className="studio-toolbar">
        <Button variant="secondary" onClick={onClose}>
          <ArrowLeft className="studio-back-icon" size={16} aria-hidden="true" />
          {ar ? "بطاقات الولاء" : "Loyalty cards"}
        </Button>
        <div className="studio-toolbar__title">
          <span className="dashboard-card__label">{ar ? "استوديو الولاء" : "LOYALTY STUDIO"}</span>
          <div className="studio-title-line">
            <h1>{displayDraft.internalName}</h1>
            <Badge tone={lifecycleState.tone}>{lifecycleState.label}</Badge>
          </div>
          <small>{lifecycleState.description}</small>
        </div>
        {draft ? (
          <div
            className={`studio-save-state studio-save-state--${saveState}`}
            role="status"
            aria-live="polite"
          >
            {saveState === "saving" ? (
              <RefreshCcw className="studio-spin" size={16} aria-hidden="true" />
            ) : saveState === "failed" || saveState === "conflict" ? (
              <CircleAlert size={16} aria-hidden="true" />
            ) : (
              <Save size={16} aria-hidden="true" />
            )}
            <span>
              {savedUnpublishedChanges && saveState === "saved"
                ? ar
                  ? "تغييرات غير منشورة محفوظة"
                  : "Unpublished changes saved"
                : statusLabel(saveState, ar)}
            </span>
          </div>
        ) : (
          <div className="studio-save-state studio-save-state--saved" role="status">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>{ar ? "الإعداد المنشور محفوظ" : "Published setup saved"}</span>
          </div>
        )}
      </div>

      <div
        className={`studio-handoff studio-handoff--${lifecycleState.guidance.tone}`}
        role="status"
      >
        <span className="studio-handoff__mark">
          {lifecycleState.guidance.tone === "danger" ? (
            <CircleAlert size={17} aria-hidden="true" />
          ) : lifecycleState.guidance.tone === "warning" ? (
            <Pause size={17} aria-hidden="true" />
          ) : lifecycleState.guidance.tone === "neutral" ? (
            <Archive size={17} aria-hidden="true" />
          ) : (
            <Check size={17} aria-hidden="true" />
          )}
        </span>
        <div>
          <strong>{lifecycleState.guidance.title}</strong>
          <small>{lifecycleState.guidance.description}</small>
        </div>
        <ChevronRight className="studio-logical-next" size={18} aria-hidden="true" />
      </div>

      <StudioJourney
        activeArea={activeArea}
        presentation={lifecycleState}
        ar={ar}
        onArea={selectArea}
      />

      {error ? <Alert tone="danger" title={error} /> : null}
      {lifecycleNotice ? (
        <Alert tone="success" title={lifecycleNotice.title}>
          {lifecycleNotice.message}
          {lifecycleNotice.action === "archive" ? (
            <div className="studio-lifecycle-notice__actions">
              <Button onClick={onClose}>
                {ar ? "العودة إلى بطاقات الولاء" : "Return to Loyalty Cards"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  selectArea("settings");
                  window.requestAnimationFrame(() =>
                    document.getElementById("studio-change-history")?.focus(),
                  );
                }}
              >
                <History size={16} aria-hidden="true" />
                {ar ? "عرض سجل التغييرات" : "View change history"}
              </Button>
            </div>
          ) : null}
        </Alert>
      ) : null}

      <div className="studio-mobile-navigation">
        <button
          ref={mobileNavigationTriggerRef}
          type="button"
          disabled={working}
          aria-expanded={mobileNavigationOpen}
          aria-controls="studio-mobile-navigation-menu"
          data-studio-area={activeArea}
          onClick={() => setMobileNavigationOpen((open) => !open)}
        >
          <span>
            <Menu size={18} aria-hidden="true" /> {areaCopy.label}
          </span>
          <ChevronDown size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="studio-workspace">
        <StudioNavigation
          activeArea={activeArea}
          ar={ar}
          disabled={working}
          mobileOpen={mobileNavigationOpen}
          onArea={selectArea}
        />

        <main className="studio-editor-panel" id="studio-area-content" tabIndex={-1}>
          <div className="studio-panel-heading">
            <div>
              <span className="dashboard-card__label">
                {ar ? "إدارة بطاقة الولاء" : "MANAGE LOYALTY CARD"}
              </span>
              <h2>{areaCopy.label}</h2>
              <p>{areaCopy.description}</p>
            </div>
            {draft?.editingMode === "pro" ? (
              <Badge tone="brand">PRO</Badge>
            ) : (
              <Badge>{ar ? "أساسي" : "QUICK"}</Badge>
            )}
          </div>

          <StudioAreaContent
            area={activeArea}
            displayDraft={displayDraft}
            editableDraft={draft}
            setDraft={setDraft}
            displayVersion={displayVersion}
            detail={detail}
            auditEvents={auditEvents}
            organizationId={organizationId}
            programId={programId}
            locations={locations}
            assets={assets}
            onAssetUploaded={onAssetUploaded}
            plan={plan}
            ar={ar}
            canManageEngagement={canManageEngagement}
            lifecycleState={lifecycleState}
            validation={validation}
            validating={working}
            selectedProfile={selectedProfile}
            selectedPreview={selectedPreview}
            previewLoadState={previewLoadState}
            progress={progress}
            onProgress={setProgress}
            onProfile={setSelectedProfile}
            onEditDesign={onEditDesign}
            onOpenCustomers={onOpenCustomers}
            onOpenBilling={onOpenBilling}
            onArea={selectArea}
            onValidate={() => void validate()}
            onIssue={(issue) => selectArea(studioAreaForValidationPath(issue.path))}
            onCreateDraft={() => void createDraft()}
            onPublish={() => setConfirmation("publish")}
            onLifecycle={setConfirmation}
            organization={organization}
            enrollmentAccess={enrollmentAccess}
            walletHealth={walletHealth}
            publicationMode={activePublicationMode}
            publicationSuccess={publicationSuccess}
            publicationFailure={publicationFailure}
            hasUnpublishedChanges={savedUnpublishedChanges}
            onRetryPublication={() => void lifecycle("publish")}
            onReloadPublication={() => void reloadLatest()}
            onViewVersion={(id) => void viewHistorical(id)}
            onLoadMoreVersions={historyCursor ? () => void loadMoreVersions() : undefined}
          />
        </main>
      </div>

      <ConflictModal
        conflict={conflict}
        ar={ar}
        onCopy={() => void copyLocal()}
        onExport={exportLocal}
        onReload={() => void reloadLatest()}
        onReapply={reapplyLocal}
      />
      <HistoricalModal
        version={historicalVersion}
        onClose={() => setHistoricalVersion(null)}
        ar={ar}
      />
      <PublicationConfirmationDialog
        open={confirmation === "publish"}
        mode={activePublicationMode}
        paused={detail.status === "PAUSED"}
        startsTrial={Boolean(
          activePublicationMode === "first-launch" &&
            organization?.billingProfile?.subscriptionStatus === "PENDING_ACTIVATION" &&
            organization.billingProfile.trialStart === null,
        )}
        working={working && confirmation === "publish"}
        ar={ar}
        onClose={() => setConfirmation(null)}
        onConfirm={() => void lifecycle("publish")}
      />
      <AlertDialog
        open={Boolean(confirmation && confirmation !== "publish")}
        title={confirmation ? lifecycleActionLabel(confirmation, ar) : ""}
        description={
          confirmation
            ? lifecycleActionDescription(confirmation, ar, {
                hasPublishedVersion: Boolean(detail.currentPublishedVersion),
                pausedWithPublishedVersion:
                  detail.status === "PAUSED" && Boolean(detail.currentPublishedVersion),
              })
            : ""
        }
        confirmLabel={
          confirmation && confirmation !== "publish" ? lifecycleActionLabel(confirmation, ar) : ""
        }
        cancelLabel={ar ? "إلغاء" : "Cancel"}
        closeLabel={ar ? "إغلاق" : "Close"}
        danger={confirmation === "archive" || confirmation === "abandon"}
        loading={working && Boolean(confirmation && confirmation !== "publish")}
        onClose={() => setConfirmation(null)}
        onConfirm={() => {
          if (confirmation) void lifecycle(confirmation);
        }}
      />
    </div>
  );
}

function StudioLoadingSkeleton({ ar }: { ar: boolean }) {
  return (
    <section className="studio-loading-skeleton" aria-busy="true" aria-live="polite" role="status">
      <span className="wf-sr-only">{ar ? "جارٍ فتح الاستوديو…" : "Opening Studio…"}</span>
      <div className="studio-loading-skeleton__header" aria-hidden="true">
        <span className="wf-skeleton studio-loading-skeleton__title" />
        <span className="wf-skeleton studio-loading-skeleton__action" />
      </div>
      <div className="studio-loading-skeleton__status" aria-hidden="true">
        <span className="wf-skeleton" />
        <span className="wf-skeleton" />
        <span className="wf-skeleton" />
      </div>
      <div className="studio-loading-skeleton__body" aria-hidden="true">
        <aside>
          <span className="wf-skeleton" />
          <span className="wf-skeleton" />
          <span className="wf-skeleton" />
          <span className="wf-skeleton" />
        </aside>
        <div className="studio-loading-skeleton__content">
          <span className="wf-skeleton studio-loading-skeleton__line--wide" />
          <span className="wf-skeleton studio-loading-skeleton__line" />
          <span className="wf-skeleton studio-loading-skeleton__surface" />
        </div>
        <div className="wf-skeleton studio-loading-skeleton__preview" />
      </div>
    </section>
  );
}

function StudioAreaIcon({ area }: { area: StudioArea }) {
  if (area === "overview") return <LayoutDashboard size={19} aria-hidden="true" />;
  if (area === "how-it-works") return <Workflow size={19} aria-hidden="true" />;
  if (area === "customers-locations") return <MapPinned size={19} aria-hidden="true" />;
  if (area === "engagement") return <BellRing size={19} aria-hidden="true" />;
  if (area === "launch") return <Rocket size={19} aria-hidden="true" />;
  return <Settings2 size={19} aria-hidden="true" />;
}

function StudioJourney({
  activeArea,
  presentation,
  ar,
  onArea,
}: {
  activeArea: StudioArea;
  presentation: StudioLifecyclePresentation;
  ar: boolean;
  onArea: (area: StudioArea) => void;
}) {
  const stageRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const locationStage =
    activeArea === "launch"
      ? "checks"
      : activeArea === "overview"
        ? presentation.currentJourneyStage === "live"
          ? "live"
          : "design"
        : null;
  const currentIndex = presentation.journeyStages.findIndex(
    (stage) => stage.key === presentation.currentJourneyStage,
  );

  useEffect(() => {
    stageRefs.current[currentIndex]?.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "center",
    });
  }, [currentIndex]);

  function moveFocus(index: number, direction: -1 | 1) {
    const nextIndex = Math.max(
      0,
      Math.min(presentation.journeyStages.length - 1, index + direction),
    );
    stageRefs.current[nextIndex]?.focus();
    stageRefs.current[nextIndex]?.scrollIntoView({ block: "nearest", inline: "center" });
  }

  return (
    <div className="studio-journey-shell">
      <section
        className="studio-journey"
        aria-label={ar ? "رحلة إطلاق البطاقة" : "Card launch journey"}
      >
        {presentation.journeyStages.map((stage, index) => (
          <button
            ref={(node) => {
              stageRefs.current[index] = node;
            }}
            type="button"
            key={stage.key}
            className={`studio-journey__${stage.state}${
              locationStage === stage.key ? " studio-journey__active" : ""
            }`}
            aria-label={`${stage.label}: ${stage.stateLabel}. ${stage.hint}`}
            aria-current={locationStage === stage.key ? "page" : undefined}
            data-progression-state={stage.state}
            onClick={() => onArea(stage.area)}
            onKeyDown={(event) => {
              const previousKey = ar ? "ArrowRight" : "ArrowLeft";
              const nextKey = ar ? "ArrowLeft" : "ArrowRight";
              if (event.key === previousKey) {
                event.preventDefault();
                moveFocus(index, -1);
              }
              if (event.key === nextKey) {
                event.preventDefault();
                moveFocus(index, 1);
              }
            }}
          >
            <span className="studio-journey__node">
              {stage.state === "complete" ? (
                <Check size={15} aria-hidden="true" />
              ) : stage.state === "paused" ? (
                <Pause size={14} aria-hidden="true" />
              ) : stage.state === "archived" ? (
                <Archive size={14} aria-hidden="true" />
              ) : stage.state === "blocked" ? (
                <CircleAlert size={14} aria-hidden="true" />
              ) : (
                <span aria-hidden="true" />
              )}
            </span>
            <span>
              <strong>{stage.label}</strong>
              <small>
                {stage.stateLabel} · {stage.hint}
              </small>
            </span>
          </button>
        ))}
      </section>
      <small className="studio-journey-hint">
        {ar
          ? "مرّر أو استخدم مفاتيح الأسهم لعرض جميع المراحل"
          : "Swipe or use the arrow keys to see every stage"}
      </small>
    </div>
  );
}

function StudioNavigation({
  activeArea,
  ar,
  disabled,
  mobileOpen,
  onArea,
}: {
  activeArea: StudioArea;
  ar: boolean;
  disabled: boolean;
  mobileOpen: boolean;
  onArea: (area: StudioArea) => void;
}) {
  const locale = ar ? "ar" : "en";
  return (
    <nav
      className={`studio-section-nav${mobileOpen ? " studio-section-nav--mobile-open" : ""}`}
      id="studio-mobile-navigation-menu"
      aria-label={ar ? "أقسام الاستوديو" : "Studio sections"}
    >
      {studioAreas.map((area) => {
        const copy = studioAreaCopy[locale][area];
        const group =
          area === "overview"
            ? ar
              ? "البناء"
              : "Build"
            : area === "launch"
              ? ar
                ? "الإطلاق"
                : "Go live"
              : area === "engagement"
                ? ar
                  ? "الإدارة"
                  : "Manage"
                : null;
        return (
          <Fragment key={area}>
            {group ? <span className="studio-section-nav__group">{group}</span> : null}
            <button
              type="button"
              disabled={disabled}
              className={activeArea === area ? "studio-section-nav__active" : ""}
              onClick={() => onArea(area)}
              aria-current={activeArea === area ? "page" : undefined}
            >
              <span className="studio-section-nav__icon">
                <StudioAreaIcon area={area} />
              </span>
              <span>
                <strong>{copy.label}</strong>
                <small>{copy.description}</small>
              </span>
              <ChevronRight className="studio-logical-next" size={16} aria-hidden="true" />
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}

function StudioAreaContent({
  area,
  displayDraft,
  editableDraft,
  setDraft,
  displayVersion,
  detail,
  auditEvents,
  organizationId,
  programId,
  locations,
  assets,
  onAssetUploaded,
  plan,
  ar,
  canManageEngagement,
  lifecycleState,
  validation,
  validating,
  selectedProfile,
  selectedPreview,
  previewLoadState,
  progress,
  onProgress,
  onProfile,
  onEditDesign,
  onOpenCustomers,
  onOpenBilling,
  onArea,
  onValidate,
  onIssue,
  onCreateDraft,
  onPublish,
  onLifecycle,
  organization,
  enrollmentAccess,
  walletHealth,
  publicationMode: activePublicationMode,
  publicationSuccess,
  publicationFailure,
  hasUnpublishedChanges,
  onRetryPublication,
  onReloadPublication,
  onViewVersion,
  onLoadMoreVersions,
}: {
  area: StudioArea;
  displayDraft: ProgramDraftInput;
  editableDraft: ProgramDraftInput | null;
  setDraft: React.Dispatch<React.SetStateAction<ProgramDraftInput | null>>;
  displayVersion: ProgramVersion;
  detail: ProgramDetail;
  auditEvents: ProgramAuditEvent[];
  organizationId: string;
  programId: string;
  locations: LocationItem[];
  assets: AssetItem[];
  onAssetUploaded: (asset: AssetItem) => void;
  plan: "STARTER" | "GROWTH" | "SCALE";
  ar: boolean;
  canManageEngagement: boolean;
  lifecycleState: StudioLifecyclePresentation;
  validation: ValidationResult | null;
  validating: boolean;
  selectedProfile: PreviewProfile;
  selectedPreview: PreviewResult | undefined;
  previewLoadState: PreviewLoadState;
  progress: number;
  onProgress: (progress: number) => void;
  onProfile: (profile: PreviewProfile) => void;
  onEditDesign: () => void;
  onOpenCustomers: () => void;
  onOpenBilling: () => void;
  onArea: (area: StudioArea) => void;
  onValidate: () => void;
  onIssue: (issue: ValidationIssue) => void;
  onCreateDraft: () => void;
  onPublish: () => void;
  onLifecycle: (action: LifecycleAction) => void;
  organization: OrganizationPublicationContext | null;
  enrollmentAccess: EnrollmentSettings | null;
  walletHealth: WalletHealth[];
  publicationMode: ReturnType<typeof publicationMode>;
  publicationSuccess: PublicationSuccessState | null;
  publicationFailure: PublicationFailureState | null;
  hasUnpublishedChanges: boolean;
  onRetryPublication: () => void;
  onReloadPublication: () => void;
  onViewVersion: (versionId: string) => void;
  onLoadMoreVersions?: (() => void) | undefined;
}) {
  const nestedSection = (section: StudioSection) =>
    editableDraft ? (
      <StudioSectionContent
        section={section}
        draft={editableDraft}
        setDraft={setDraft}
        locations={locations}
        assets={assets}
        organizationId={organizationId}
        onAssetUploaded={onAssetUploaded}
        plan={plan}
        ar={ar}
        validation={validation}
        onValidate={onValidate}
        validating={validating}
        onIssue={onIssue}
        detail={detail}
        auditEvents={auditEvents}
        onViewVersion={onViewVersion}
        onLoadMoreVersions={onLoadMoreVersions}
        onAbandon={() => onLifecycle("abandon")}
      />
    ) : null;

  if (area === "overview")
    return (
      <StudioOverview
        displayDraft={displayDraft}
        displayVersion={displayVersion}
        detail={detail}
        locations={locations}
        lifecycleState={lifecycleState}
        editable={Boolean(editableDraft)}
        ar={ar}
        selectedProfile={selectedProfile}
        selectedPreview={selectedPreview}
        previewLoadState={previewLoadState}
        progress={progress}
        onProgress={onProgress}
        onProfile={onProfile}
        onEditDesign={onEditDesign}
        organizationId={organizationId}
        programId={programId}
        enrollmentAccess={enrollmentAccess}
        walletHealth={walletHealth}
        hasUnpublishedChanges={hasUnpublishedChanges}
        onOpenCustomers={onOpenCustomers}
        onArea={onArea}
        onLifecycle={onLifecycle}
      />
    );

  if (area === "how-it-works")
    return (
      <HowItWorksPanel
        draft={displayDraft}
        editable={Boolean(editableDraft)}
        setDraft={setDraft}
        ar={ar}
        onEditDesign={onEditDesign}
        advancedRules={nestedSection("policies")}
        onCreateDraft={onCreateDraft}
      />
    );

  if (area === "customers-locations")
    return (
      <CustomersLocationsPanel
        draft={displayDraft}
        editable={Boolean(editableDraft)}
        locations={locations}
        organizationId={organizationId}
        programId={programId}
        ar={ar}
        locationEditor={nestedSection("locations")}
        onCreateDraft={onCreateDraft}
      />
    );

  if (area === "engagement")
    return (
      <WalletEngagementPanel
        organizationId={organizationId}
        programId={programId}
        ar={ar}
        canManage={canManageEngagement}
      />
    );

  if (area === "launch")
    return (
      <LaunchPanel
        editable={Boolean(editableDraft)}
        organizationId={organizationId}
        programId={programId}
        draft={displayDraft}
        detail={detail}
        locations={locations}
        plan={plan}
        organization={organization}
        access={enrollmentAccess}
        walletHealth={walletHealth}
        ar={ar}
        lifecycleState={lifecycleState}
        mode={activePublicationMode}
        success={publicationSuccess}
        failure={publicationFailure}
        validationPanel={nestedSection("validation")}
        onValidate={onValidate}
        onArea={onArea}
        onPublish={onPublish}
        onRetry={onRetryPublication}
        onReload={onReloadPublication}
        onEditDesign={onEditDesign}
        onOpenBilling={onOpenBilling}
        onViewCustomers={onOpenCustomers}
        onLifecycle={onLifecycle}
      />
    );

  return (
    <StudioSettingsPanel
      draft={displayDraft}
      editable={Boolean(editableDraft)}
      lifecycleState={lifecycleState}
      ar={ar}
      history={
        editableDraft ? (
          nestedSection("versions")
        ) : (
          <VersionHistory
            versions={detail.versions}
            auditEvents={auditEvents}
            ar={ar}
            onView={onViewVersion}
            onLoadMore={onLoadMoreVersions}
          />
        )
      }
      onEditDesign={onEditDesign}
      onCreateDraft={onCreateDraft}
      onLifecycle={onLifecycle}
    />
  );
}

function StudioOverview({
  displayDraft,
  displayVersion,
  detail,
  locations,
  lifecycleState,
  editable,
  ar,
  selectedProfile,
  selectedPreview,
  previewLoadState,
  progress,
  onProgress,
  onProfile,
  onEditDesign,
  organizationId,
  programId,
  enrollmentAccess,
  walletHealth,
  hasUnpublishedChanges,
  onOpenCustomers,
  onArea,
  onLifecycle,
}: {
  displayDraft: ProgramDraftInput;
  displayVersion: ProgramVersion;
  detail: ProgramDetail;
  locations: LocationItem[];
  lifecycleState: StudioLifecyclePresentation;
  editable: boolean;
  ar: boolean;
  selectedProfile: PreviewProfile;
  selectedPreview: PreviewResult | undefined;
  previewLoadState: PreviewLoadState;
  progress: number;
  onProgress: (progress: number) => void;
  onProfile: (profile: PreviewProfile) => void;
  onEditDesign: () => void;
  organizationId: string;
  programId: string;
  enrollmentAccess: EnrollmentSettings | null;
  walletHealth: WalletHealth[];
  hasUnpublishedChanges: boolean;
  onOpenCustomers: () => void;
  onArea: (area: StudioArea) => void;
  onLifecycle: (action: LifecycleAction) => void;
}) {
  const finalReward = [...displayDraft.rewards].sort(
    (left, right) => right.thresholdStampCount - left.thresholdStampCount,
  )[0];
  const customerContent = selectStudioLocalizedProgramContent(displayDraft, ar ? "ar" : "en");
  const rewardName = finalReward
    ? selectStudioLocalizedRewardContent(finalReward, ar ? "ar" : "en").name
    : customerContent.rewardSummary;
  const activeLocations = locations.filter((location) =>
    displayDraft.locationIds.includes(location.id),
  );
  const changedAt = detail.updatedAt ?? displayVersion.publishedAt ?? null;
  const publishedDraft =
    detail.currentPublishedVersion &&
    hasPublishedCustomerPreviewPayload(detail.currentPublishedVersion)
      ? versionToDraft(detail, detail.currentPublishedVersion)
      : null;
  const customerPreview = selectCustomerPreviewSource({
    hasCurrentPublishedVersion: Boolean(detail.currentPublishedVersion),
    currentPublishedPreview: publishedDraft,
    savedDraft: displayDraft,
    draftPreviewSupported: lifecycleState.key !== "archived",
  });
  const customerPreviewDraft = customerPreview.preview ?? displayDraft;
  const publishedPreviewContext = Boolean(detail.currentPublishedVersion);
  const publishedPolicy = enrollmentAccess?.publishedVersion?.policy ?? null;
  const sharing = deriveProgramSharingPresentation({
    lifecycle: detail.status,
    enrollmentPolicy: publishedPolicy,
    hasPublishedVersion: Boolean(detail.currentPublishedVersion),
    publicUrl: enrollmentAccess?.publicUrl ?? null,
    slug: enrollmentAccess?.publicSlug ?? null,
    qrAvailability: Boolean(enrollmentAccess?.publicSlug),
    customerAccessState:
      enrollmentAccess?.enrollmentLinkStatus === "ACTIVE" ? "available" : "unavailable",
    locale: ar ? "ar" : "en",
  });
  const primaryAction =
    detail.currentPublishedVersion && lifecycleState.key === "paused"
      ? ({ kind: "lifecycle", action: "resume", label: sharing.primaryActionLabel } as const)
      : detail.currentPublishedVersion && lifecycleState.key === "archived"
        ? ({ kind: "lifecycle", action: "restore", label: sharing.primaryActionLabel } as const)
        : hasUnpublishedChanges
          ? ({
              kind: "navigate",
              area: "launch",
              label: ar ? "مراجعة التغييرات" : "Review changes",
            } as const)
          : detail.currentPublishedVersion && sharing.primaryAction === "share"
            ? ({ kind: "share", label: sharing.primaryActionLabel } as const)
            : detail.currentPublishedVersion && sharing.primaryAction === "review-enrollment"
              ? ({
                  kind: "navigate",
                  area: "customers-locations",
                  label: sharing.primaryActionLabel,
                } as const)
              : lifecycleState.primaryAction;

  function runPrimaryAction() {
    if (primaryAction.kind === "share") {
      document.getElementById("studio-live-sharing")?.focus();
      document.getElementById("studio-live-sharing")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } else if (primaryAction.kind === "navigate") onArea(primaryAction.area);
    else if (primaryAction.kind === "lifecycle") onLifecycle(primaryAction.action);
    else onArea("launch");
  }

  return (
    <div className="studio-overview">
      <div className="studio-overview__hero">
        <StudioPreview
          draft={customerPreviewDraft}
          ar={ar}
          selectedProfile={selectedProfile}
          preview={customerPreview.source === "draft" ? selectedPreview : undefined}
          loadState={previewLoadState}
          source={customerPreview.source}
          publishedPreviewContext={publishedPreviewContext}
          publishedStatus={detail.status}
          progress={progress}
          onProgress={onProgress}
          onProfile={onProfile}
        />
        <section className="studio-next-action" aria-labelledby="studio-next-action-title">
          <span className="dashboard-card__label">{ar ? "الخطوة التالية" : "NEXT"}</span>
          <h3 id="studio-next-action-title">{primaryAction.label}</h3>
          <p>
            {hasUnpublishedChanges
              ? ar
                ? "راجع التغييرات المحفوظة قبل نشرها. البطاقة المباشرة الحالية لم تتغير."
                : "Review the saved changes before publishing them. The current live card is unchanged."
              : lifecycleState.key === "draft" || lifecycleState.key === "ready"
                ? lifecycleState.launch.description
                : lifecycleState.guidance.description}
          </p>
          <Button onClick={runPrimaryAction}>
            {primaryAction.kind === "lifecycle" && primaryAction.action === "resume" ? (
              <Play size={16} aria-hidden="true" />
            ) : primaryAction.kind === "lifecycle" && primaryAction.action === "restore" ? (
              <RotateCcw size={16} aria-hidden="true" />
            ) : null}
            {primaryAction.label}
            {primaryAction.kind === "navigate" || primaryAction.kind === "run-checks" ? (
              <ChevronRight className="studio-logical-next" size={16} aria-hidden="true" />
            ) : null}
          </Button>
        </section>
      </div>

      <div className="studio-overview__summary">
        <section>
          <span>
            <Workflow size={18} aria-hidden="true" />
          </span>
          <div>
            <small>{ar ? "طريقة العمل" : "How it works"}</small>
            <strong>
              {displayDraft.requiredStampCount} {ar ? "أختام" : "stamps"} · {rewardName}
            </strong>
            <p>{customerContent.earningDescription}</p>
          </div>
          <button type="button" onClick={() => onArea("how-it-works")}>
            {ar ? "فتح" : "Open"}
            <ChevronRight className="studio-logical-next" size={15} aria-hidden="true" />
          </button>
        </section>
        <section>
          <span>
            <Store size={18} aria-hidden="true" />
          </span>
          <div>
            <small>{ar ? "المواقع المشاركة" : "Participating locations"}</small>
            <strong>
              {activeLocations.length === 1
                ? activeLocations[0]?.name
                : ar
                  ? `${activeLocations.length} مواقع`
                  : `${activeLocations.length} locations`}
            </strong>
            <p>
              {activeLocations.length
                ? activeLocations.map((location) => location.name).join(" · ")
                : ar
                  ? "لم يتم اختيار موقع بعد"
                  : "No location selected yet"}
            </p>
          </div>
          <button type="button" onClick={() => onArea("customers-locations")}>
            {ar ? "فتح" : "Open"}
            <ChevronRight className="studio-logical-next" size={15} aria-hidden="true" />
          </button>
        </section>
        <section>
          <span>
            <Clock3 size={18} aria-hidden="true" />
          </span>
          <div>
            <small>{ar ? "آخر تغيير" : "Last changed"}</small>
            <strong>
              {changedAt ? (
                <time dateTime={changedAt}>
                  {new Intl.DateTimeFormat(ar ? "ar-IQ-u-nu-latn" : "en-IQ", {
                    dateStyle: "medium",
                  }).format(new Date(changedAt))}
                </time>
              ) : ar ? (
                "محفوظ"
              ) : (
                "Saved"
              )}
            </strong>
            <p>
              {displayVersion.changeSummary || (ar ? "لا يوجد ملخص للتغيير" : "No change summary")}
            </p>
          </div>
          <button type="button" onClick={() => onArea("settings")}>
            {ar ? "السجل" : "History"}
            <ChevronRight className="studio-logical-next" size={15} aria-hidden="true" />
          </button>
        </section>
      </div>

      {detail.currentPublishedVersion ? (
        <LiveAccessSummary
          detail={detail}
          access={enrollmentAccess}
          walletHealth={walletHealth}
          organizationId={organizationId}
          programId={programId}
          ar={ar}
          hasUnpublishedChanges={hasUnpublishedChanges}
          onReviewChanges={() => onArea("launch")}
          onViewCustomers={onOpenCustomers}
        />
      ) : null}

      <div className="studio-design-owner">
        <div>
          <Eye size={19} aria-hidden="true" />
          <span>
            <strong>{ar ? "التصميم ومحتوى العميل" : "Design and customer content"}</strong>
            <small>
              {ar
                ? "تُدار في منشئ البطاقة وتظهر هنا كملخص فقط."
                : "Managed in the Card Builder and shown here as a read-only summary."}
            </small>
          </span>
        </div>
        {editable ? (
          <Button variant="secondary" onClick={onEditDesign}>
            {ar ? "تعديل التصميم" : "Edit design"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function StudioPreview({
  draft,
  ar,
  selectedProfile,
  preview,
  loadState,
  source,
  publishedPreviewContext,
  publishedStatus,
  progress,
  onProgress,
  onProfile,
}: {
  draft: ProgramDraftInput;
  ar: boolean;
  selectedProfile: PreviewProfile;
  preview: PreviewResult | undefined;
  loadState: PreviewLoadState;
  source: "published" | "draft" | "unavailable";
  publishedPreviewContext: boolean;
  publishedStatus: ProgramOperationalStatus;
  progress: number;
  onProgress: (progress: number) => void;
  onProfile: (profile: PreviewProfile) => void;
}) {
  const profileLabel = publishedPreviewContext
    ? ar
      ? "ملخص البطاقة المنشورة"
      : "Published card summary"
    : selectedProfile === "CUSTOMER_WEB"
      ? ar
        ? "بطاقة العميل"
        : "Customer card"
      : selectedProfile === "APPLE_WALLET"
        ? "Apple Wallet"
        : "Google Wallet";
  const publishedState =
    publishedStatus === "PUBLISHED"
      ? {
          eyebrow: ar ? "المنشور حالياً" : "CURRENTLY LIVE",
          label: ar ? "مباشرة الآن" : "Currently live",
          tone: "success" as const,
        }
      : publishedStatus === "PAUSED"
        ? {
            eyebrow: ar ? "الإعداد المنشور" : "PUBLISHED SETUP",
            label: ar ? "متوقفة" : "Paused",
            tone: "warning" as const,
          }
        : publishedStatus === "ARCHIVED"
          ? {
              eyebrow: ar ? "الإعداد المحفوظ" : "PRESERVED SETUP",
              label: ar ? "مؤرشفة" : "Archived",
              tone: "neutral" as const,
            }
          : {
              eyebrow: ar ? "الإعداد المنشور" : "PUBLISHED SETUP",
              label: ar ? "منشورة" : "Published",
              tone: "neutral" as const,
            };
  const loading = source === "draft" && (loadState === "idle" || loadState === "loading");
  return (
    <section
      className="studio-preview-panel studio-preview-panel--overview"
      aria-label={ar ? "معاينة البطاقة" : "Card preview"}
    >
      <div className="studio-preview-header">
        <div>
          <span className="dashboard-card__label">
            {publishedPreviewContext
              ? publishedState.eyebrow
              : ar
                ? "ما يراه العميل"
                : "CUSTOMER VIEW"}
          </span>
          <h3>{profileLabel}</h3>
        </div>
        {publishedPreviewContext ? (
          <Badge tone={publishedState.tone}>{publishedState.label}</Badge>
        ) : (
          <Eye size={20} aria-hidden="true" />
        )}
      </div>
      {source === "draft" ? (
        <div
          className="studio-preview-tabs"
          role="tablist"
          aria-label={ar ? "أسطح المعاينة" : "Preview surfaces"}
        >
          {(["CUSTOMER_WEB", "APPLE_WALLET", "GOOGLE_WALLET"] as const).map((profile) => (
            <button
              type="button"
              role="tab"
              key={profile}
              aria-selected={selectedProfile === profile}
              onClick={() => onProfile(profile)}
            >
              {profile === "CUSTOMER_WEB"
                ? ar
                  ? "العميل"
                  : "Customer"
                : profile === "APPLE_WALLET"
                  ? "Apple"
                  : "Google"}
            </button>
          ))}
        </div>
      ) : null}
      <div
        dir={ar ? "rtl" : "ltr"}
        lang={ar ? "ar" : "en"}
        className={`studio-device-frame studio-device-frame--${publishedPreviewContext ? "published" : selectedProfile.toLowerCase()}`}
      >
        {source === "published" ? (
          <PublishedCardSummary draft={draft} progress={progress} ar={ar} />
        ) : source === "draft" && preview ? (
          <Image
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.svg)}`}
            alt={ar ? `معاينة ${profileLabel}` : `${profileLabel} preview`}
            width={preview.width}
            height={preview.height}
            unoptimized
          />
        ) : (
          <div className="studio-preview-loading" role="status">
            {loading ? (
              <RefreshCcw className="studio-spin" aria-hidden="true" />
            ) : (
              <CircleAlert aria-hidden="true" />
            )}
            <span>
              {loading
                ? ar
                  ? "جارٍ تحميل المعاينة…"
                  : "Loading preview…"
                : ar
                  ? "المعاينة غير متاحة"
                  : "Preview unavailable"}
            </span>
          </div>
        )}
      </div>
      {source !== "unavailable" ? (
        <FormField label={ar ? "تقدم العميل" : "Customer progress"}>
          <div className="studio-preview-progress">
            <input
              type="range"
              min={0}
              max={draft.requiredStampCount}
              value={progress}
              onChange={(event) => onProgress(Number(event.target.value))}
            />
            <output dir="ltr">
              {progress}/{draft.requiredStampCount}
            </output>
          </div>
        </FormField>
      ) : null}
      {source === "draft" &&
        preview?.warnings.map((warning) => (
          <Alert key={warning.code} tone="warning" title={warning.message} />
        ))}
    </section>
  );
}

function PublishedCardSummary({
  draft,
  progress,
  ar,
}: {
  draft: ProgramDraftInput;
  progress: number;
  ar: boolean;
}) {
  const content = selectStudioLocalizedProgramContent(draft, ar ? "ar" : "en");
  const reward = [...draft.rewards].sort(
    (left, right) => right.thresholdStampCount - left.thresholdStampCount,
  )[0];
  const rewardName = reward
    ? selectStudioLocalizedRewardContent(reward, ar ? "ar" : "en").name
    : content.rewardSummary;
  const stampSlots = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].slice(
    0,
    Math.min(draft.requiredStampCount, 12),
  );
  return (
    <div
      className="studio-published-customer-preview"
      style={{
        backgroundColor: draft.visualTheme.backgroundColor,
        color: draft.visualTheme.foregroundColor,
        borderRadius: `${Math.max(14, draft.visualTheme.borderRadius)}px`,
      }}
      role="img"
      aria-label={ar ? "ملخص البطاقة المنشورة حاليًا" : "Current published card summary"}
    >
      <small>{ar ? "بطاقة الولاء" : "LOYALTY CARD"}</small>
      <h4>{content.programName}</h4>
      <p>{content.shortDescription}</p>
      <div className="studio-published-customer-preview__stamps" aria-hidden="true">
        {stampSlots.map((slot, index) => (
          <span
            key={slot}
            className={index < progress ? "is-earned" : ""}
            style={{
              borderColor: draft.visualTheme.accentColor,
              backgroundColor: index < progress ? draft.visualTheme.accentColor : "transparent",
            }}
          />
        ))}
      </div>
      <div className="studio-published-customer-preview__reward">
        <small>{ar ? "المكافأة" : "REWARD"}</small>
        <strong>{rewardName}</strong>
      </div>
      <output dir="ltr">
        {Math.min(progress, draft.requiredStampCount)}/{draft.requiredStampCount}
      </output>
    </div>
  );
}

function HowItWorksPanel({
  draft,
  editable,
  setDraft,
  ar,
  onEditDesign,
  advancedRules,
  onCreateDraft,
}: {
  draft: ProgramDraftInput;
  editable: boolean;
  setDraft: React.Dispatch<React.SetStateAction<ProgramDraftInput | null>>;
  ar: boolean;
  onEditDesign: () => void;
  advancedRules: React.ReactNode;
  onCreateDraft: () => void;
}) {
  const reward = [...draft.rewards].sort(
    (left, right) => right.thresholdStampCount - left.thresholdStampCount,
  )[0];
  const content = selectStudioLocalizedProgramContent(draft, ar ? "ar" : "en");
  const rewardName = reward
    ? selectStudioLocalizedRewardContent(reward, ar ? "ar" : "en").name
    : content.rewardSummary;
  return (
    <div className="studio-area-stack">
      <div className="studio-rule-summary">
        <section>
          <span className="studio-rule-summary__stamp" aria-hidden="true">
            {draft.requiredStampCount}
          </span>
          <div>
            <small>{ar ? "هدف الأختام" : "Stamp goal"}</small>
            <h3>
              {draft.requiredStampCount} {ar ? "أختام" : "stamps"}
            </h3>
            <p>{content.earningDescription}</p>
          </div>
        </section>
        <section>
          <span className="studio-rule-summary__gift">
            <Gift size={22} aria-hidden="true" />
          </span>
          <div>
            <small>{ar ? "المكافأة" : "Reward"}</small>
            <h3>{rewardName}</h3>
            <p>
              {reward?.requiresManagerApproval
                ? ar
                  ? "تتطلب موافقة المدير عند الاسترداد."
                  : "Manager approval is required at redemption."
                : ar
                  ? "يمكن استردادها دون موافقة المدير."
                  : "Can be redeemed without manager approval."}
            </p>
          </div>
        </section>
      </div>

      <div className="studio-design-owner">
        <div>
          <Eye size={19} aria-hidden="true" />
          <span>
            <strong>{ar ? "اسم المكافأة وشكل البطاقة" : "Reward name and card appearance"}</strong>
            <small>
              {ar
                ? "يُعدّلان في منشئ البطاقة حتى يبقى لكل حقل مكان واحد."
                : "Edit these in the Card Builder so every field has one clear home."}
            </small>
          </span>
        </div>
        {editable ? (
          <Button variant="secondary" onClick={onEditDesign}>
            {ar ? "تعديل التصميم" : "Edit design"}
          </Button>
        ) : null}
      </div>

      {editable ? (
        <details className="studio-advanced-disclosure">
          <summary>
            <span>
              <Settings2 size={19} aria-hidden="true" />
              <strong>
                {ar ? "قواعد الكسب والاسترداد المتقدمة" : "Advanced earning and redemption rules"}
              </strong>
            </span>
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <div className="studio-advanced-disclosure__content">
            <RewardOperationsPanel draft={draft} setDraft={setDraft} ar={ar} />
            {advancedRules}
          </div>
        </details>
      ) : (
        <CreateUpdatePrompt ar={ar} onCreate={onCreateDraft} compact />
      )}
    </div>
  );
}

function RewardOperationsPanel({
  draft,
  setDraft,
  ar,
}: {
  draft: ProgramDraftInput;
  setDraft: React.Dispatch<React.SetStateAction<ProgramDraftInput | null>>;
  ar: boolean;
}) {
  function updateReward(clientId: string, transform: (reward: RewardInput) => RewardInput) {
    setDraft((current) =>
      current
        ? {
            ...current,
            rewards: current.rewards.map((reward) =>
              reward.clientId === clientId ? transform(reward) : reward,
            ),
          }
        : current,
    );
  }
  return (
    <section className="studio-operational-rewards">
      <div>
        <span className="dashboard-card__label">{ar ? "عند الاسترداد" : "AT REDEMPTION"}</span>
        <h3>{ar ? "طريقة استخدام المكافآت" : "How rewards are used"}</h3>
      </div>
      {draft.rewards.map((reward) => {
        const name = selectStudioLocalizedRewardContent(reward, ar ? "ar" : "en").name;
        return (
          <Card key={reward.clientId} className="studio-operational-reward">
            <div className="studio-section-heading">
              <div>
                <small>
                  {ar
                    ? `تُفتح عند ${reward.thresholdStampCount} أختام`
                    : `Unlocks at ${reward.thresholdStampCount} stamps`}
                </small>
                <h4>{name}</h4>
              </div>
              <Badge
                tone={reward.thresholdStampCount === draft.requiredStampCount ? "success" : "brand"}
              >
                {reward.thresholdStampCount === draft.requiredStampCount
                  ? ar
                    ? "نهائية"
                    : "Final"
                  : ar
                    ? "مرحلية"
                    : "Milestone"}
              </Badge>
            </div>
            <div className="studio-form-grid">
              <FormField label={ar ? "مدة الصلاحية بالأيام" : "Valid for (days)"}>
                <TextInput
                  type="number"
                  min={1}
                  max={3650}
                  value={reward.validityDurationDays ?? ""}
                  onChange={(event) =>
                    updateReward(reward.clientId, (current) => ({
                      ...current,
                      validityDurationDays: event.target.value ? Number(event.target.value) : null,
                    }))
                  }
                />
              </FormField>
              <FormField label={ar ? "مرات الاستخدام لكل مكافأة" : "Uses per earned reward"}>
                <TextInput
                  type="number"
                  min={1}
                  max={10}
                  value={reward.maximumRedemptionsPerEarned}
                  onChange={(event) =>
                    updateReward(reward.clientId, (current) => ({
                      ...current,
                      maximumRedemptionsPerEarned: Number(event.target.value),
                    }))
                  }
                />
              </FormField>
            </div>
            <Checkbox
              checked={reward.requiresManagerApproval}
              label={ar ? "طلب موافقة المدير عند الاسترداد" : "Require manager approval to redeem"}
              onChange={(event) =>
                updateReward(reward.clientId, (current) => ({
                  ...current,
                  requiresManagerApproval: event.target.checked,
                }))
              }
            />
          </Card>
        );
      })}
    </section>
  );
}

function CustomersLocationsPanel({
  draft,
  editable,
  locations,
  organizationId,
  programId,
  ar,
  locationEditor,
  onCreateDraft,
}: {
  draft: ProgramDraftInput;
  editable: boolean;
  locations: LocationItem[];
  organizationId: string;
  programId: string;
  ar: boolean;
  locationEditor: React.ReactNode;
  onCreateDraft: () => void;
}) {
  const participating = locations.filter((location) => draft.locationIds.includes(location.id));
  return (
    <div className="studio-area-stack">
      <section className="studio-locations-block">
        <div className="studio-section-heading">
          <div>
            <span className="dashboard-card__label">
              {ar ? "أماكن المشاركة" : "WHERE IT WORKS"}
            </span>
            <h3>{ar ? "المواقع المشاركة" : "Participating locations"}</h3>
            <p>
              {ar
                ? "يمكن للعملاء كسب الأختام في المواقع النشطة المحددة هنا."
                : "Customers can earn stamps at the active locations selected here."}
            </p>
          </div>
          <Badge tone={participating.length ? "success" : "warning"}>
            {ar ? `${participating.length} محددة` : `${participating.length} selected`}
          </Badge>
        </div>
        {editable ? (
          locationEditor
        ) : (
          <div className="studio-location-list">
            {participating.map((location) => (
              <span key={location.id}>
                <Store size={17} aria-hidden="true" /> {location.name}
              </span>
            ))}
          </div>
        )}
      </section>

      {!editable ? <CreateUpdatePrompt ar={ar} onCreate={onCreateDraft} compact /> : null}

      <ProgramEnrollmentSettings
        organizationId={organizationId}
        programId={programId}
        ar={ar}
        showWalletReadiness={false}
      />
    </div>
  );
}

function CreateUpdatePrompt({
  ar,
  onCreate,
  compact = false,
}: {
  ar: boolean;
  onCreate: () => void;
  compact?: boolean;
}) {
  return (
    <Card className={`studio-create-update${compact ? " studio-create-update--compact" : ""}`}>
      <Plus size={24} aria-hidden="true" />
      <div>
        <h3>{ar ? "أنشئ تحديثًا للتعديل" : "Create an update to make changes"}</h3>
        <p>
          {ar
            ? "ستبقى البطاقة المباشرة كما هي حتى تختبر التحديث وتنشره."
            : "The live card stays unchanged until you review and publish the update."}
        </p>
      </div>
      <Button onClick={onCreate}>{ar ? "إنشاء تحديث" : "Create update"}</Button>
    </Card>
  );
}

function StudioSettingsPanel({
  draft,
  editable,
  lifecycleState,
  ar,
  history,
  onEditDesign,
  onCreateDraft,
  onLifecycle,
}: {
  draft: ProgramDraftInput;
  editable: boolean;
  lifecycleState: StudioLifecyclePresentation;
  ar: boolean;
  history: React.ReactNode;
  onEditDesign: () => void;
  onCreateDraft: () => void;
  onLifecycle: (action: LifecycleAction) => void;
}) {
  const customerContent = selectStudioLocalizedProgramContent(draft, ar ? "ar" : "en");
  return (
    <div className="studio-area-stack">
      <section className="studio-settings-section">
        <div className="studio-section-heading">
          <div>
            <span className="dashboard-card__label">{ar ? "ملكية الحقول" : "FIELD OWNERSHIP"}</span>
            <h3>{ar ? "التصميم ومحتوى العميل" : "Design and customer content"}</h3>
            <p>
              {ar
                ? "تظهر هذه القيم هنا كملخص. يعدّلها منشئ البطاقة فقط."
                : "These values are summarized here. The Card Builder is their only editor."}
            </p>
          </div>
          {editable ? (
            <Button variant="secondary" onClick={onEditDesign}>
              {ar ? "تعديل التصميم" : "Edit design"}
            </Button>
          ) : null}
        </div>
        <dl className="studio-settings-summary">
          <div>
            <dt>{ar ? "اسم البطاقة" : "Card name"}</dt>
            <dd>{customerContent.programName}</dd>
          </div>
          <div>
            <dt>{ar ? "هدف الأختام" : "Stamp goal"}</dt>
            <dd>{draft.requiredStampCount}</dd>
          </div>
          <div>
            <dt>{ar ? "لغة العرض" : "Customer languages"}</dt>
            <dd>{ar ? "العربية والإنجليزية" : "English and Arabic"}</dd>
          </div>
        </dl>
      </section>

      <section className="studio-settings-section">
        <div className="studio-section-heading">
          <div>
            <span className="dashboard-card__label">{ar ? "حالة البطاقة" : "CARD STATE"}</span>
            <h3>{lifecycleState.label}</h3>
            <p>{lifecycleState.description}</p>
          </div>
          <Badge tone={lifecycleState.tone}>{lifecycleState.label}</Badge>
        </div>
        <div className="studio-lifecycle-actions">
          {lifecycleState.capabilities.canPause ? (
            <Button variant="secondary" onClick={() => onLifecycle("pause")}>
              <Pause size={16} aria-hidden="true" /> {lifecycleActionLabel("pause", ar)}
            </Button>
          ) : null}
          {lifecycleState.capabilities.canResume ? (
            <Button onClick={() => onLifecycle("resume")}>
              <Play size={16} aria-hidden="true" /> {lifecycleActionLabel("resume", ar)}
            </Button>
          ) : null}
          {lifecycleState.capabilities.canArchive ? (
            <Button variant="secondary" onClick={() => onLifecycle("archive")}>
              <Archive size={16} aria-hidden="true" /> {lifecycleActionLabel("archive", ar)}
            </Button>
          ) : null}
          {lifecycleState.capabilities.canRestore ? (
            <Button onClick={() => onLifecycle("restore")}>
              <RotateCcw size={16} aria-hidden="true" /> {lifecycleActionLabel("restore", ar)}
            </Button>
          ) : null}
        </div>
      </section>

      {!editable && lifecycleState.key === "live" ? (
        <CreateUpdatePrompt ar={ar} onCreate={onCreateDraft} compact />
      ) : null}

      {history ?? (
        <Alert tone="info" title={ar ? "لا يوجد سجل تغييرات بعد" : "No change history yet"} />
      )}
    </div>
  );
}

function StudioSectionContent({
  section,
  draft,
  setDraft,
  locations,
  assets,
  organizationId,
  onAssetUploaded,
  plan,
  ar,
  validation,
  onValidate,
  validating,
  onIssue,
  detail,
  auditEvents,
  onViewVersion,
  onLoadMoreVersions,
  onAbandon,
}: {
  section: StudioSection;
  draft: ProgramDraftInput;
  setDraft: React.Dispatch<React.SetStateAction<ProgramDraftInput | null>>;
  locations: LocationItem[];
  assets: AssetItem[];
  organizationId: string;
  onAssetUploaded: (asset: AssetItem) => void;
  plan: "STARTER" | "GROWTH" | "SCALE";
  ar: boolean;
  validation: ValidationResult | null;
  onValidate: () => void;
  validating: boolean;
  onIssue: (issue: ValidationIssue) => void;
  detail: ProgramDetail;
  auditEvents: ProgramAuditEvent[];
  onViewVersion: (versionId: string) => void;
  onLoadMoreVersions?: (() => void) | undefined;
  onAbandon: () => void;
}) {
  const update = (transform: (current: ProgramDraftInput) => ProgramDraftInput) =>
    setDraft((current) => (current ? transform(current) : current));
  if (section === "overview")
    return (
      <div className="studio-section-content">
        <FormField label={ar ? "الاسم الداخلي" : "Internal name"} required>
          <TextInput
            value={draft.internalName}
            onChange={(event) =>
              update((current) => ({ ...current, internalName: event.target.value }))
            }
          />
        </FormField>
        <FormField label={ar ? "وضع التحرير" : "Editing mode"}>
          <Select
            value={draft.editingMode}
            onChange={(event) => {
              const mode = event.target.value as "quick" | "pro";
              if (mode === "pro" && plan === "STARTER") return;
              update((current) => ({ ...current, editingMode: mode }));
            }}
          >
            <option value="quick">Quick Mode</option>
            <option value="pro" disabled={plan === "STARTER"}>
              Pro Mode {plan === "STARTER" ? "· Growth required" : ""}
            </option>
          </Select>
        </FormField>
        {plan === "STARTER" ? (
          <Alert
            tone="info"
            title={
              ar ? "قيود Starter مفعلة على الخادم" : "Starter restrictions are enforced by the API"
            }
          >
            {ar
              ? "يتطلب Pro والمكافآت المتعددة وتخطيطات Path/Ring خطة Growth أو Scale."
              : "Pro, multiple rewards, milestones, Path, and Ring require Growth or Scale."}
          </Alert>
        ) : null}
        <FormField label={ar ? "ملخص التغيير" : "Change summary"}>
          <TextInput
            value={draft.changeSummary ?? ""}
            onChange={(event) =>
              update((current) => ({ ...current, changeSummary: event.target.value }))
            }
            placeholder="Summarize what changed"
          />
        </FormField>
      </div>
    );

  if (section === "earning")
    return (
      <div className="studio-section-content">
        <FormField label={ar ? "عدد الأختام المطلوبة" : "Required stamp count"}>
          <input
            type="range"
            min={2}
            max={30}
            value={draft.requiredStampCount}
            onChange={(event) => {
              const goal = Number(event.target.value);
              update((current) => ({
                ...current,
                requiredStampCount: goal,
                rewards: current.rewards.map((reward, index) =>
                  index === current.rewards.length - 1 && reward.thresholdStampCount > goal
                    ? { ...reward, thresholdStampCount: goal }
                    : reward,
                ),
              }));
            }}
          />
          <strong>
            {draft.requiredStampCount} {ar ? "أختام" : "stamps"}
          </strong>
        </FormField>
        <FormField label={ar ? "وصف طريقة الكسب" : "Earning description"}>
          <TextInput
            value={draft.earningDescription}
            onChange={(event) =>
              update((current) => ({ ...current, earningDescription: event.target.value }))
            }
          />
        </FormField>
        <Alert tone="info" title={ar ? "سياسة العمليات" : "Operations policy"}>
          {ar
            ? "تُطبّق حدود العملية واليوم وسياسة الشراء من إصدار البرنامج المثبت للعضوية."
            : "Operation limits, daily caps, purchase policy, and reset behavior follow the setup each customer joined under."}
        </Alert>
      </div>
    );

  if (section === "rewards")
    return (
      <RewardsEditor
        draft={draft}
        update={update}
        assets={assets}
        organizationId={organizationId}
        onAssetUploaded={onAssetUploaded}
        plan={plan}
        ar={ar}
      />
    );

  if (section === "locations")
    return (
      <div className="studio-section-content">
        <p>
          {ar
            ? "اختر موقعاً نشطاً واحداً أو أكثر."
            : "Select one or more active locations explicitly."}
        </p>
        <div className="studio-check-grid">
          {locations.map((location) => (
            <Checkbox
              key={location.id}
              label={`${location.name}${location.status !== "ACTIVE" ? ` · ${location.status}` : ""}`}
              disabled={location.status !== "ACTIVE"}
              checked={draft.locationIds.includes(location.id)}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  locationIds: event.target.checked
                    ? [...current.locationIds, location.id]
                    : current.locationIds.filter((id) => id !== location.id),
                }))
              }
            />
          ))}
        </div>
      </div>
    );

  if (section === "english" || section === "arabic")
    return (
      <TranslationEditor
        locale={section === "english" ? "en" : "ar"}
        value={draft.translations[section === "english" ? "en" : "ar"]}
        update={(key, value) =>
          update((current) => {
            const locale = section === "english" ? "en" : "ar";
            return {
              ...current,
              translations: {
                ...current.translations,
                [locale]: { ...current.translations[locale], [key]: value },
              },
            };
          })
        }
      />
    );

  if (section === "visual")
    return (
      <div className="studio-section-content">
        <div className="studio-color-grid">
          {(
            [
              ["backgroundColor", ar ? "الخلفية" : "Background"],
              ["foregroundColor", ar ? "النص" : "Foreground"],
              ["accentColor", ar ? "التمييز" : "Accent"],
              ["secondaryColor", ar ? "الثانوي" : "Secondary"],
              ["mutedColor", ar ? "الهادئ" : "Muted"],
            ] as const
          ).map(([key, label]) => (
            <FormField key={key} label={label}>
              <div className="studio-color-input">
                <ColorInput
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
                  value={draft.visualTheme[key]}
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
        <FormField label={ar ? "نمط ويب العميل" : "Customer Web style"}>
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
            <option value="CARD">Card</option>
            <option value="MINIMAL">Minimal</option>
            <option value="HERO">Hero</option>
          </Select>
        </FormField>
      </div>
    );

  if (section === "artwork")
    return (
      <div className="studio-section-content">
        {(
          [
            ["LOGO", "logoAssetId", ar ? "الشعار" : "Logo"],
            ["HERO", "heroAssetId", ar ? "صورة البطل" : "Hero"],
            ["BACKGROUND", "backgroundAssetId", ar ? "الخلفية" : "Background"],
            ["STAMP_FILLED", "filledStampAssetId", ar ? "الختم الممتلئ" : "Filled stamp"],
            ["STAMP_EMPTY", "emptyStampAssetId", ar ? "الختم الفارغ" : "Empty stamp"],
            ["STAMP_MILESTONE", "defaultMilestoneAssetId", ar ? "ختم المعلم" : "Milestone stamp"],
          ] as const
        ).map(([category, key, label]) => (
          <div key={key}>
            <ProgramAssetPicker
              organizationId={organizationId}
              category={category}
              label={label}
              assets={assets}
              selectedId={draft.visualTheme[key]}
              onSelected={(assetId) =>
                update((current) => ({
                  ...current,
                  visualTheme: {
                    ...current.visualTheme,
                    [key]: assetId,
                  },
                }))
              }
              onUploaded={onAssetUploaded}
              ar={ar}
            />
            {key === "backgroundAssetId" ? (
              <p className="field-help">
                Customer Web:{" "}
                {programPlatformCapabilities.CUSTOMER_WEB.backgroundArtwork.explanation} Apple:{" "}
                {programPlatformCapabilities.APPLE_WALLET.backgroundArtwork.explanation} Google:{" "}
                {programPlatformCapabilities.GOOGLE_WALLET.backgroundArtwork.explanation}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    );

  if (section === "layout")
    return <LayoutEditor draft={draft} update={update} plan={plan} ar={ar} />;

  if (["customer-preview", "apple-preview", "google-preview"].includes(section))
    return <PreviewSettings section={section} draft={draft} update={update} ar={ar} />;

  if (section === "policies")
    return <OperationsPolicyEditor draft={draft} update={update} ar={ar} />;

  if (section === "validation")
    return (
      <ValidationPanel
        result={validation}
        onValidate={onValidate}
        validating={validating}
        onIssue={onIssue}
        ar={ar}
      />
    );

  return (
    <div className="studio-section-content">
      <VersionHistory
        versions={detail.versions}
        auditEvents={auditEvents}
        ar={ar}
        onView={onViewVersion}
        onLoadMore={onLoadMoreVersions}
      />
      {detail.currentPublishedVersion ? (
        <Button variant="danger" onClick={onAbandon}>
          <Trash2 size={16} /> {ar ? "التخلي عن المسودة" : "Abandon draft"}
        </Button>
      ) : (
        <Alert tone="info" title={ar ? "المسودة الأولى محفوظة" : "Initial draft is preserved"}>
          {ar
            ? "استخدم إجراء الأرشفة الآمن لإخفاء البطاقة غير المنشورة مع الاحتفاظ بالمسودة وسجل الإصدارات."
            : "Use Archive to hide this unpublished card while preserving its draft and change history."}
        </Alert>
      )}
    </div>
  );
}

function TranslationEditor({
  locale,
  value,
  update,
}: {
  locale: "en" | "ar";
  value: ProgramDraftInput["translations"]["en"];
  update: (key: keyof ProgramDraftInput["translations"]["en"], value: string) => void;
}) {
  const rtl = locale === "ar";
  return (
    <div className="studio-section-content" dir={rtl ? "rtl" : "ltr"}>
      <div className="studio-form-grid">
        <FormField label={rtl ? "اسم البطاقة" : "Card name"}>
          <TextInput
            value={value.programName}
            onChange={(event) => update("programName", event.target.value)}
          />
        </FormField>
        <FormField label={rtl ? "ملخص المكافأة" : "Reward summary"}>
          <TextInput
            value={value.rewardSummary}
            onChange={(event) => update("rewardSummary", event.target.value)}
          />
        </FormField>
      </div>
      <FormField label={rtl ? "الوصف القصير" : "Short description"}>
        <TextInput
          value={value.shortDescription}
          onChange={(event) => update("shortDescription", event.target.value)}
        />
      </FormField>
      <FormField label={rtl ? "الوصف الكامل" : "Full description"}>
        <TextArea
          value={value.fullDescription ?? ""}
          onChange={(event) => update("fullDescription", event.target.value)}
        />
      </FormField>
      <FormField label={rtl ? "تعليمات الانضمام" : "Join instructions"}>
        <TextArea
          value={value.joinInstructions ?? ""}
          onChange={(event) => update("joinInstructions", event.target.value)}
        />
      </FormField>
      <FormField label={rtl ? "الشروط والأحكام" : "Terms and conditions"}>
        <TextArea
          value={value.termsAndConditions}
          onChange={(event) => update("termsAndConditions", event.target.value)}
        />
      </FormField>
      <div className="studio-form-grid">
        <FormField label={rtl ? "رسالة الإكمال" : "Completion message"}>
          <TextInput
            value={value.completionMessage}
            onChange={(event) => update("completionMessage", event.target.value)}
          />
        </FormField>
        <FormField label={rtl ? "رسالة فتح المكافأة" : "Reward unlocked message"}>
          <TextInput
            value={value.rewardUnlockedMessage}
            onChange={(event) => update("rewardUnlockedMessage", event.target.value)}
          />
        </FormField>
      </div>
      <FormField label={rtl ? "رسالة الإيقاف" : "Paused message"}>
        <TextInput
          value={value.pausedMessage ?? ""}
          onChange={(event) => update("pausedMessage", event.target.value)}
        />
      </FormField>
    </div>
  );
}

function RewardsEditor({
  draft,
  update,
  assets,
  organizationId,
  onAssetUploaded,
  plan,
  ar,
}: {
  draft: ProgramDraftInput;
  update: (transform: (current: ProgramDraftInput) => ProgramDraftInput) => void;
  assets: AssetItem[];
  organizationId: string;
  onAssetUploaded: (asset: AssetItem) => void;
  plan: "STARTER" | "GROWTH" | "SCALE";
  ar: boolean;
}) {
  function updateReward(clientId: string, transform: (reward: RewardInput) => RewardInput) {
    update((current) => ({
      ...current,
      rewards: current.rewards.map((reward) =>
        reward.clientId === clientId ? transform(reward) : reward,
      ),
    }));
  }
  function addReward() {
    if (plan === "STARTER" || draft.editingMode !== "pro") return;
    const threshold = Math.max(2, draft.requiredStampCount - 2);
    update((current) => ({
      ...current,
      rewards: [
        ...current.rewards,
        {
          clientId: crypto.randomUUID(),
          thresholdStampCount: threshold,
          rewardType: "TEXT_REWARD" as const,
          internalName: `Milestone ${current.rewards.length + 1}`,
          sortOrder: current.rewards.length,
          requiresManagerApproval: false,
          maximumRedemptionsPerEarned: 1,
          translations: {
            en: { name: "Milestone reward", description: "Milestone reward" },
            ar: { name: "مكافأة مرحلية", description: "مكافأة مرحلية" },
          },
        },
      ].sort((left, right) => left.thresholdStampCount - right.thresholdStampCount),
    }));
  }
  return (
    <div className="studio-section-content">
      <div className="studio-section-heading">
        <div>
          <h3>{ar ? "مكافآت وصفية ومعالم" : "Descriptive rewards and milestones"}</h3>
          <p>
            {ar
              ? "يجب أن تكون العتبات فريدة وأن توجد مكافأة نهائية عند الهدف."
              : "Thresholds must be unique and one final reward must sit at the goal."}
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={addReward}
          disabled={plan === "STARTER" || draft.editingMode !== "pro"}
          title={plan === "STARTER" ? "Growth or Scale required." : undefined}
        >
          <Plus size={16} /> {ar ? "إضافة معلم" : "Add milestone"}
        </Button>
      </div>
      {draft.rewards.map((reward, index) => (
        <Card className="studio-reward-card" key={reward.clientId}>
          <div className="studio-section-heading">
            <div>
              <Badge
                tone={reward.thresholdStampCount === draft.requiredStampCount ? "success" : "brand"}
              >
                {reward.thresholdStampCount === draft.requiredStampCount ? "FINAL" : "MILESTONE"}
              </Badge>
              <h4>{reward.internalName}</h4>
            </div>
            {draft.rewards.length > 1 ? (
              <Button
                variant="ghost"
                onClick={() =>
                  update((current) => ({
                    ...current,
                    rewards: current.rewards.filter((item) => item.clientId !== reward.clientId),
                  }))
                }
              >
                <X size={16} /> {ar ? "إزالة" : "Remove"}
              </Button>
            ) : null}
          </div>
          <div className="studio-form-grid">
            <FormField label={ar ? "العتبة" : "Threshold"}>
              <TextInput
                type="number"
                min={2}
                max={draft.requiredStampCount}
                value={reward.thresholdStampCount}
                onChange={(event) =>
                  updateReward(reward.clientId, (current) => ({
                    ...current,
                    thresholdStampCount: Number(event.target.value),
                  }))
                }
              />
            </FormField>
            <FormField label={ar ? "الاسم الداخلي" : "Internal name"}>
              <TextInput
                value={reward.internalName}
                onChange={(event) =>
                  updateReward(reward.clientId, (current) => ({
                    ...current,
                    internalName: event.target.value,
                  }))
                }
              />
            </FormField>
            <FormField label={ar ? "الصلاحية بالأيام" : "Validity days"}>
              <TextInput
                type="number"
                min={1}
                max={3650}
                value={reward.validityDurationDays ?? ""}
                onChange={(event) =>
                  updateReward(reward.clientId, (current) => ({
                    ...current,
                    validityDurationDays: event.target.value ? Number(event.target.value) : null,
                  }))
                }
              />
            </FormField>
            <FormField label={ar ? "الاسترداد لكل كسب" : "Redemptions per earned reward"}>
              <TextInput
                type="number"
                min={1}
                max={10}
                value={reward.maximumRedemptionsPerEarned}
                onChange={(event) =>
                  updateReward(reward.clientId, (current) => ({
                    ...current,
                    maximumRedemptionsPerEarned: Number(event.target.value),
                  }))
                }
              />
            </FormField>
          </div>
          <Checkbox
            label={ar ? "يتطلب موافقة المدير" : "Requires manager approval"}
            checked={reward.requiresManagerApproval}
            onChange={(event) =>
              updateReward(reward.clientId, (current) => ({
                ...current,
                requiresManagerApproval: event.target.checked,
              }))
            }
          />
          <div className="studio-form-grid">
            <FormField label="English reward">
              <TextInput
                value={reward.translations.en.name}
                onChange={(event) =>
                  updateReward(reward.clientId, (current) => ({
                    ...current,
                    translations: {
                      ...current.translations,
                      en: {
                        ...current.translations.en,
                        name: event.target.value,
                        description: event.target.value,
                      },
                    },
                  }))
                }
              />
            </FormField>
            <FormField label="المكافأة العربية">
              <TextInput
                dir="rtl"
                value={reward.translations.ar.name}
                onChange={(event) =>
                  updateReward(reward.clientId, (current) => ({
                    ...current,
                    translations: {
                      ...current.translations,
                      ar: {
                        ...current.translations.ar,
                        name: event.target.value,
                        description: event.target.value,
                      },
                    },
                  }))
                }
              />
            </FormField>
          </div>
          <div className="studio-form-grid">
            <FormField label="English redemption instructions">
              <TextArea
                value={reward.translations.en.redemptionInstructions ?? ""}
                onChange={(event) =>
                  updateReward(reward.clientId, (current) => ({
                    ...current,
                    translations: {
                      ...current.translations,
                      en: {
                        ...current.translations.en,
                        redemptionInstructions: event.target.value,
                      },
                    },
                  }))
                }
              />
            </FormField>
            <FormField label="تعليمات الاسترداد العربية">
              <TextArea
                dir="rtl"
                value={reward.translations.ar.redemptionInstructions ?? ""}
                onChange={(event) =>
                  updateReward(reward.clientId, (current) => ({
                    ...current,
                    translations: {
                      ...current.translations,
                      ar: {
                        ...current.translations.ar,
                        redemptionInstructions: event.target.value,
                      },
                    },
                  }))
                }
              />
            </FormField>
          </div>
          <ProgramAssetPicker
            organizationId={organizationId}
            category="STAMP_MILESTONE"
            label={`${ar ? "رسم المعلم" : "Milestone artwork"} ${index + 1}`}
            assets={assets}
            selectedId={reward.visualOverride?.stampAssetId}
            onSelected={(assetId) =>
              updateReward(reward.clientId, (current) => ({
                ...current,
                visualOverride: {
                  ...current.visualOverride,
                  stampAssetId: assetId,
                },
              }))
            }
            onUploaded={onAssetUploaded}
            ar={ar}
          />
        </Card>
      ))}
    </div>
  );
}

function OperationsPolicyEditor({
  draft,
  update,
  ar,
}: {
  draft: ProgramDraftInput;
  update: (transform: (current: ProgramDraftInput) => ProgramDraftInput) => void;
  ar: boolean;
}) {
  const timezoneChoices = useMemo(
    () =>
      timeZoneOptions(ar ? "ar" : "en").map((option) => ({
        value: option.id,
        label: option.label,
        group: option.group,
      })),
    [ar],
  );
  return (
    <div className="studio-section-content">
      <Alert tone="info" title={ar ? "قواعد التحديث" : "How rule changes take effect"}>
        {ar
          ? "تطبّق التغييرات الجديدة على العملاء الذين ينضمون بعد نشر التحديث، بينما تبقى شروط العملاء الحاليين كما هي."
          : "New rules apply to customers who join after this update is published. Existing customers keep their current terms."}
      </Alert>
      <FormField label={ar ? "المنطقة الزمنية للنشاط" : "Business timezone"} required>
        <SearchableSelect
          name="operationalTimezone"
          options={timezoneChoices}
          value={draft.operationalTimezone}
          onValueChange={(value) =>
            value && update((current) => ({ ...current, operationalTimezone: value }))
          }
          placeholder={ar ? "ابحث عن منطقة زمنية" : "Search timezones"}
          required
        />
        <span className="field-help">
          {ar
            ? "تحدد حدود اليوم والتقارير وتواريخ انتهاء المكافآت."
            : "Controls daily limits, reporting days, and reward expiry dates."}
        </span>
      </FormField>
      <FormField label={ar ? "أقصى أختام لكل عملية شراء" : "Most stamps per purchase"}>
        <TextInput
          type="number"
          min={1}
          max={30}
          value={draft.maximumStampsPerOperation}
          onChange={(event) =>
            update((current) => ({
              ...current,
              maximumStampsPerOperation: Number(event.target.value),
            }))
          }
        />
      </FormField>
      <Checkbox
        checked={draft.maximumStampsPerCustomerPerDay !== null}
        onChange={(event) =>
          update((current) => ({
            ...current,
            maximumStampsPerCustomerPerDay: event.target.checked
              ? Math.max(current.maximumStampsPerOperation, 5)
              : null,
          }))
        }
        label={ar ? "تفعيل حد يومي لكل عميل" : "Set a daily limit per customer"}
      />
      {draft.maximumStampsPerCustomerPerDay !== null ? (
        <FormField label={ar ? "أقصى أختام يومية للعميل" : "Most stamps per customer per day"}>
          <TextInput
            type="number"
            min={1}
            max={1000}
            value={draft.maximumStampsPerCustomerPerDay}
            onChange={(event) =>
              update((current) => ({
                ...current,
                maximumStampsPerCustomerPerDay: Number(event.target.value),
              }))
            }
          />
          <span className="field-help">
            {ar
              ? "يُحسب كل ختم تمت إضافته خلال اليوم، حتى عند تصحيح عملية لاحقًا."
              : "Every stamp added that day counts, even if a purchase is corrected later."}
          </span>
        </FormField>
      ) : null}
      <Checkbox
        checked={draft.minimumPurchaseAmountMinor !== null}
        onChange={(event) =>
          update((current) => ({
            ...current,
            minimumPurchaseAmountMinor: event.target.checked ? 0 : null,
            minimumPurchaseCurrency: event.target.checked ? "IQD" : null,
          }))
        }
        label={ar ? "اشتراط حد أدنى للشراء" : "Require a minimum purchase"}
      />
      {draft.minimumPurchaseAmountMinor !== null ? (
        <div className="studio-form-grid">
          <FormField label={ar ? "أصغر قيمة شراء مؤهلة" : "Smallest qualifying purchase"}>
            <TextInput
              type="number"
              min={0}
              step={1}
              value={draft.minimumPurchaseAmountMinor}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  minimumPurchaseAmountMinor: Number(event.target.value),
                }))
              }
            />
          </FormField>
          <FormField label={ar ? "عملة الشراء" : "Purchase currency"}>
            <TextInput
              value={draft.minimumPurchaseCurrency ?? ""}
              maxLength={3}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  minimumPurchaseCurrency: event.target.value.toUpperCase(),
                }))
              }
              placeholder="IQD"
            />
          </FormField>
        </div>
      ) : null}
      <div className="studio-form-grid">
        <FormField label={ar ? "مهلة تصحيح الموظف (ثوانٍ)" : "Staff correction window (seconds)"}>
          <TextInput
            type="number"
            min={15}
            max={900}
            value={draft.staffOwnReversalWindowSeconds}
            onChange={(event) =>
              update((current) => ({
                ...current,
                staffOwnReversalWindowSeconds: Number(event.target.value),
              }))
            }
          />
        </FormField>
        <FormField label={ar ? "مهلة تصحيح المدير (دقائق)" : "Manager correction window (minutes)"}>
          <TextInput
            type="number"
            min={1}
            max={10080}
            value={draft.managerReversalWindowMinutes}
            onChange={(event) =>
              update((current) => ({
                ...current,
                managerReversalWindowMinutes: Number(event.target.value),
              }))
            }
          />
        </FormField>
      </div>
      <Checkbox
        checked={draft.managerOverrideAllowed}
        onChange={(event) =>
          update((current) => ({
            ...current,
            managerOverrideAllowed: event.target.checked,
          }))
        }
        label={
          ar
            ? "السماح للمدير بإجراء استثناء مع توضيح السبب"
            : "Allow manager exceptions with a required reason"
        }
      />
      <FormField label={ar ? "بعد استخدام المكافأة النهائية" : "After the final reward is used"}>
        <TextInput
          value={ar ? "يبدأ العميل دورة أختام جديدة" : "Start a new stamp cycle"}
          disabled
        />
        <span className="field-help">
          {ar
            ? "تبقى الأختام ممتلئة حتى يتم استخدام المكافأة بنجاح."
            : "Stamps stay filled until the reward is successfully used."}
        </span>
      </FormField>
    </div>
  );
}

function LayoutEditor({
  draft,
  update,
  plan,
  ar,
}: {
  draft: ProgramDraftInput;
  update: (transform: (current: ProgramDraftInput) => ProgramDraftInput) => void;
  plan: "STARTER" | "GROWTH" | "SCALE";
  ar: boolean;
}) {
  return (
    <div className="studio-section-content">
      <div className="studio-layout-grid">
        {(["ROW", "GRID", "PATH", "RING"] as const).map((layout) => {
          const locked = plan === "STARTER" && ["PATH", "RING"].includes(layout);
          return (
            <button
              type="button"
              key={layout}
              disabled={locked}
              className={
                draft.visualTheme.layoutType === layout ? "studio-layout-option--selected" : ""
              }
              onClick={() =>
                update((current) => ({
                  ...current,
                  visualTheme: { ...current.visualTheme, layoutType: layout },
                }))
              }
            >
              <strong>{layout}</strong>
              <small>
                {locked ? "Growth required" : ar ? "تخطيط متجاوب" : "Responsive layout"}
              </small>
            </button>
          );
        })}
      </div>
      <div className="studio-form-grid">
        <FormField label={ar ? "حجم الختم" : "Stamp size"}>
          <input
            type="range"
            min={24}
            max={96}
            value={draft.visualTheme.stampSize}
            onChange={(event) =>
              update((current) => ({
                ...current,
                visualTheme: { ...current.visualTheme, stampSize: Number(event.target.value) },
              }))
            }
          />
        </FormField>
        <FormField label={ar ? "تباعد الأختام" : "Stamp spacing"}>
          <input
            type="range"
            min={0}
            max={32}
            value={draft.visualTheme.stampSpacing}
            onChange={(event) =>
              update((current) => ({
                ...current,
                visualTheme: { ...current.visualTheme, stampSpacing: Number(event.target.value) },
              }))
            }
          />
        </FormField>
        {["GRID", "PATH"].includes(draft.visualTheme.layoutType) ? (
          <FormField label={ar ? "الأعمدة" : "Columns"}>
            <TextInput
              type="number"
              min={draft.visualTheme.layoutType === "PATH" ? 3 : 2}
              max={6}
              value={draft.visualTheme.layoutConfiguration.columns ?? 4}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  visualTheme: {
                    ...current.visualTheme,
                    layoutConfiguration: {
                      ...current.visualTheme.layoutConfiguration,
                      columns: Number(event.target.value),
                    },
                  },
                }))
              }
            />
          </FormField>
        ) : null}
        {draft.visualTheme.layoutType === "RING" ? (
          <FormField label={ar ? "زاوية البداية" : "Start angle"}>
            <TextInput
              type="number"
              min={-180}
              max={180}
              value={draft.visualTheme.layoutConfiguration.startAngle ?? -90}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  visualTheme: {
                    ...current.visualTheme,
                    layoutConfiguration: {
                      ...current.visualTheme.layoutConfiguration,
                      startAngle: Number(event.target.value),
                    },
                  },
                }))
              }
            />
          </FormField>
        ) : null}
      </div>
      <div className="studio-check-grid">
        <Checkbox
          label={ar ? "عرض ملصق التقدم" : "Show progress label"}
          checked={draft.visualTheme.progressLabelVisible}
          onChange={(event) =>
            update((current) => ({
              ...current,
              visualTheme: {
                ...current.visualTheme,
                progressLabelVisible: event.target.checked,
              },
            }))
          }
        />
        <Checkbox
          label={ar ? "عرض ملصق المكافأة" : "Show reward label"}
          checked={draft.visualTheme.rewardLabelVisible}
          onChange={(event) =>
            update((current) => ({
              ...current,
              visualTheme: {
                ...current.visualTheme,
                rewardLabelVisible: event.target.checked,
              },
            }))
          }
        />
      </div>
    </div>
  );
}

function PreviewSettings({
  section,
  draft,
  update,
  ar,
}: {
  section: StudioSection;
  draft: ProgramDraftInput;
  update: (transform: (current: ProgramDraftInput) => ProgramDraftInput) => void;
  ar: boolean;
}) {
  if (section === "apple-preview")
    return (
      <div className="studio-section-content">
        <Alert tone="info" title="Preview only">
          {ar
            ? "لا يؤدي تعديل هذه المعاينة إلى إصدار بطاقة Apple Wallet."
            : "Editing this preview does not issue an Apple Wallet pass."}
        </Alert>
        <CapabilitySummary platform="APPLE_WALLET" />
        {(
          [
            ["headerLabel", "Header label"],
            ["headerValue", "Header value"],
            ["secondaryLabel", "Secondary label"],
            ["barcodeLabel", "Barcode label"],
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
        <Checkbox
          label="Show back-content indication"
          checked={draft.visualTheme.applePreviewConfig.showBackContent}
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
      </div>
    );
  if (section === "google-preview")
    return (
      <div className="studio-section-content">
        <Alert tone="info" title="Preview only">
          {ar
            ? "لا يؤدي تعديل هذه المعاينة إلى إنشاء كائن Google Wallet."
            : "Editing this preview does not create a Google Wallet object."}
        </Alert>
        <CapabilitySummary platform="GOOGLE_WALLET" />
        {(
          [
            ["title", "Title"],
            ["subtitle", "Subtitle"],
            ["detailsLabel", "Details label"],
            ["barcodeLabel", "Barcode label"],
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
    );
  return (
    <div className="studio-section-content">
      <CapabilitySummary platform="CUSTOMER_WEB" />
      <h3>{ar ? "تكوين بطاقة العميل" : "Customer-facing card composition"}</h3>
      <p>
        {ar
          ? "تتضمن المعاينة الهوية والمحتوى المحلي والأختام والمكافأة والشروط."
          : "The preview includes identity, localized content, stamps, reward, and terms."}
      </p>
      <FormField label={ar ? "نمط البطاقة" : "Card style"}>
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
          <option value="CARD">Card</option>
          <option value="MINIMAL">Minimal</option>
          <option value="HERO">Hero</option>
        </Select>
      </FormField>
    </div>
  );
}

function CapabilitySummary({ platform }: { platform: ProgramPreviewPlatform }) {
  return (
    <details className="studio-capability-summary">
      <summary>Platform capability matrix</summary>
      <dl>
        {Object.entries(programPlatformCapabilities[platform]).map(([feature, capability]) => (
          <div key={feature}>
            <dt>{feature}</dt>
            <dd>
              <Badge tone={capability.support === "UNSUPPORTED" ? "warning" : "neutral"}>
                {capability.support}
              </Badge>{" "}
              {capability.explanation}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function ValidationPanel({
  result,
  onValidate,
  validating,
  onIssue,
  ar,
}: {
  result: ValidationResult | null;
  onValidate: () => void;
  validating: boolean;
  onIssue: (issue: ValidationIssue) => void;
  ar: boolean;
}) {
  return (
    <div className="studio-section-content">
      <div className="studio-section-heading">
        <div>
          <h3>{ar ? "الفحوصات الآلية" : "Automated checks"}</h3>
          <p>
            {ar
              ? "تأكد من اكتمال البطاقة والمواقع وتجارب العرض قبل الإطلاق."
              : "Check the card, locations, and preview surfaces before launch."}
          </p>
        </div>
        <Button onClick={onValidate} loading={validating}>
          <ShieldCheck size={16} />{" "}
          {result
            ? ar
              ? "تشغيل الفحوصات الآلية مجدداً"
              : "Run automated checks again"
            : ar
              ? "تشغيل الفحوصات الآلية"
              : "Run automated checks"}
        </Button>
      </div>
      {!result ? (
        <Alert tone="info" title={ar ? "لم تُشغّل الفحوصات بعد" : "Checks have not run yet"}>
          {ar
            ? "شغّل الفحوصات لرؤية أي خطوة تحتاج إلى إصلاح."
            : "Run the checks to see whether anything needs attention."}
        </Alert>
      ) : (
        <>
          <Alert
            tone={result.errors.length ? "danger" : result.warnings.length ? "warning" : "success"}
            title={
              result.errors.length
                ? ar
                  ? `${result.errors.length} عناصر تمنع الإطلاق`
                  : `${result.errors.length} launch blockers`
                : result.warnings.length
                  ? ar
                    ? `اجتازت الفحوصات مع ${result.warnings.length} ملاحظات`
                    : `Checks passed with ${result.warnings.length} notes`
                  : ar
                    ? "اجتازت الفحوصات الآلية"
                    : "Automated checks passed"
            }
          >
            {result.errors.length === 0
              ? ar
                ? "اجتازت الفحوصات الآلية. يمكنك المراجعة والنشر."
                : "Automated checks passed. You can review and publish."
              : ar
                ? "افتح كل عنصر لإصلاحه في مكانه الصحيح."
                : "Open each item to fix it in the right place."}
          </Alert>
          <div className="studio-validation-list">
            {[...result.errors, ...result.warnings].map((item) => (
              <button type="button" key={`${item.code}-${item.path}`} onClick={() => onIssue(item)}>
                {item.severity === "error" ? <CircleAlert size={18} /> : <Sparkles size={18} />}
                <span>
                  <strong>{item.message}</strong>
                  <small>{item.suggestedAction}</small>
                </span>
                <span>
                  {ar
                    ? `إصلاح في ${studioAreaCopy.ar[studioAreaForValidationPath(item.path)].label}`
                    : `Fix in ${studioAreaCopy.en[studioAreaForValidationPath(item.path)].label}`}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function auditEventLabel(event: ProgramAuditEvent, ar: boolean): string {
  if (event.action === "program.published") {
    const first = event.metadata?.publicationType === "FIRST_PUBLICATION";
    return first
      ? ar
        ? "تم إطلاق بطاقة الولاء"
        : "Loyalty card launched"
      : ar
        ? "تم نشر تغييرات البطاقة"
        : "Card changes published";
  }
  const labels: Record<string, [string, string]> = {
    "program.draft_updated": ["Draft change saved", "تم حفظ تغيير في المسودة"],
    "program.draft_abandoned": ["Draft abandoned", "تم التخلي عن المسودة"],
    "program.paused": ["Loyalty card paused", "تم إيقاف بطاقة الولاء"],
    "program.resumed": ["Loyalty card resumed", "تم استئناف بطاقة الولاء"],
    "program.archived": ["Loyalty card archived", "تمت أرشفة بطاقة الولاء"],
    "program.restored": ["Loyalty card restored", "تمت استعادة بطاقة الولاء"],
    "program.version_superseded": ["Previous publication replaced", "تم استبدال النشر السابق"],
    "program.wallet_sync_job_created": [
      "Wallet status sync queued",
      "تمت جدولة مزامنة حالة Wallet",
    ],
  };
  return (
    labels[event.action]?.[ar ? 1 : 0] ?? (ar ? "تم تحديث بطاقة الولاء" : "Loyalty card updated")
  );
}

function VersionHistory({
  versions,
  auditEvents,
  ar,
  onView,
  onLoadMore,
}: {
  versions: ProgramVersion[];
  auditEvents: ProgramAuditEvent[];
  ar: boolean;
  onView: (versionId: string) => void;
  onLoadMore?: (() => void) | undefined;
}) {
  return (
    <Card className="studio-version-history" id="studio-change-history" tabIndex={-1}>
      <div className="studio-section-heading">
        <div>
          <span className="dashboard-card__label">{ar ? "سجل التغييرات" : "CHANGE HISTORY"}</span>
          <h3>{ar ? "التغييرات المحفوظة" : "Saved changes"}</h3>
        </div>
        <History size={20} aria-hidden="true" />
      </div>
      {auditEvents.length ? (
        <div className="studio-audit-timeline">
          <h4>{ar ? "نشاط البطاقة" : "Card activity"}</h4>
          {auditEvents.slice(0, 12).map((event) => (
            <article key={event.id}>
              <span aria-hidden="true" />
              <div>
                <strong>{auditEventLabel(event, ar)}</strong>
                <small>{event.actor?.displayName ?? (ar ? "النظام" : "System")}</small>
              </div>
              <time dateTime={event.createdAt}>
                {new Intl.DateTimeFormat(ar ? "ar-IQ-u-nu-latn" : "en-IQ", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(event.createdAt))}
              </time>
            </article>
          ))}
        </div>
      ) : (
        <p className="studio-audit-timeline__empty">
          {ar
            ? "ستظهر إجراءات النشر ودورة الحياة هنا."
            : "Publication and lifecycle actions will appear here."}
        </p>
      )}
      <h4 className="studio-version-history__subheading">
        {ar ? "لقطات الإعداد المحفوظ" : "Saved setup snapshots"}
      </h4>
      {versions.map((version) => {
        const timestamp =
          version.publishedAt ??
          version.supersededAt ??
          version.testReadyAt ??
          version.validatedAt ??
          version.abandonedAt ??
          null;
        const publicationLabel =
          version.status === "PUBLISHED"
            ? ar
              ? "منشور"
              : "Published"
            : version.status === "SUPERSEDED"
              ? ar
                ? "إصدار منشور سابق"
                : "Previous publication"
              : ar
                ? "غير منشور"
                : "Unpublished";
        const saveLabel =
          version.status === "ABANDONED" ? (ar ? "متروك" : "Abandoned") : ar ? "محفوظ" : "Saved";
        return (
          <button type="button" key={version.id} onClick={() => onView(version.id)}>
            <span className="studio-version-history__title">
              <small>{ar ? "عنوان التغيير" : "Change title"}</small>
              <strong>
                {version.changeSummary || (ar ? "تحديث محفوظ للبطاقة" : "Saved card update")}
              </strong>
            </span>
            <dl className="studio-version-history__meta">
              <div>
                <dt>{ar ? "حالة النشر" : "Publication state"}</dt>
                <dd>
                  <Badge
                    tone={
                      version.status === "PUBLISHED"
                        ? "success"
                        : version.status === "SUPERSEDED"
                          ? "neutral"
                          : "brand"
                    }
                  >
                    {publicationLabel}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt>{ar ? "حالة الحفظ" : "Save status"}</dt>
                <dd>{saveLabel}</dd>
              </div>
              <div>
                <dt>{ar ? "الوقت" : "Timestamp"}</dt>
                <dd>
                  {timestamp ? (
                    <time dateTime={timestamp}>
                      {new Intl.DateTimeFormat(ar ? "ar-IQ-u-nu-latn" : "en-IQ", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(timestamp))}
                    </time>
                  ) : ar ? (
                    "غير متاح"
                  ) : (
                    "Not available"
                  )}
                </dd>
              </div>
            </dl>
            <ChevronRight className="studio-logical-next" size={17} aria-hidden="true" />
          </button>
        );
      })}
      {onLoadMore ? (
        <Button variant="secondary" onClick={onLoadMore}>
          {ar ? "تحميل المزيد من التغييرات" : "Load more changes"}
        </Button>
      ) : null}
    </Card>
  );
}

function HistoricalModal({
  version,
  onClose,
  ar,
}: {
  version: ProgramVersion | null;
  onClose: () => void;
  ar: boolean;
}) {
  return (
    <Modal
      open={Boolean(version)}
      title={ar ? "تفاصيل التغيير المحفوظ" : "Saved change details"}
      onClose={onClose}
    >
      {version ? (
        <div className="historical-version">
          <div className="studio-section-heading">
            <h3>{version.changeSummary || (ar ? "تحديث محفوظ للبطاقة" : "Saved card update")}</h3>
            <Badge tone={version.status === "PUBLISHED" ? "success" : "neutral"}>
              {version.status === "PUBLISHED"
                ? ar
                  ? "منشور"
                  : "Published"
                : ar
                  ? "محفوظ"
                  : "Saved"}
            </Badge>
          </div>
          <dl className="quick-review-list">
            <div>
              <dt>{ar ? "هدف الأختام" : "Stamp goal"}</dt>
              <dd>{version.stampRule?.requiredStampCount ?? "—"}</dd>
            </div>
            <div>
              <dt>{ar ? "المكافآت" : "Rewards"}</dt>
              <dd>{version.rewards.length}</dd>
            </div>
            <div>
              <dt>{ar ? "المواقع" : "Locations"}</dt>
              <dd>{version.locations.length}</dd>
            </div>
            <div>
              <dt>{ar ? "تاريخ النشر" : "Published"}</dt>
              <dd>{version.publishedAt ?? "—"}</dd>
            </div>
          </dl>
          <Alert tone="info" title={ar ? "للعرض فقط" : "Read only"}>
            {ar ? "لا يمكن تعديل هذا التغيير المحفوظ." : "Saved changes cannot be edited."}
          </Alert>
        </div>
      ) : null}
    </Modal>
  );
}

function ConflictModal({
  conflict,
  ar,
  onCopy,
  onExport,
  onReload,
  onReapply,
}: {
  conflict: ConflictState | null;
  ar: boolean;
  onCopy: () => void;
  onExport: () => void;
  onReload: () => void;
  onReapply: () => void;
}) {
  return (
    <Modal
      open={Boolean(conflict)}
      title={ar ? "تم التحرير في مكان آخر" : "Edited elsewhere"}
      onClose={() => undefined}
    >
      {conflict ? (
        <div className="studio-conflict">
          <Alert
            tone="warning"
            title={ar ? "تم الاحتفاظ بتعديلاتك المحلية" : "Your local edits are preserved"}
          >
            {ar
              ? "تم حفظ تغيير أحدث في مكان آخر. لن يستبدل Waflo أي تعديل تلقائيًا."
              : "A newer change was saved elsewhere. Waflo will not overwrite either set of edits automatically."}
          </Alert>
          <p>
            {ar
              ? "احتفظ بنسخة من تعديلاتك، ثم حمّل الأحدث أو أعد تطبيق تعديلاتك بوضوح."
              : "Keep a copy of your edits, then load the latest card or deliberately reapply yours."}
          </p>
          <details>
            <summary>{ar ? "عرض نسخة تعديلاتك" : "Show your edit backup"}</summary>
            <pre>{JSON.stringify(apiDraft(conflict.localDraft), null, 2)}</pre>
          </details>
          <div className="dashboard-actions">
            <Button variant="secondary" onClick={onCopy}>
              <Copy size={16} /> {ar ? "نسخ" : "Copy local"}
            </Button>
            <Button variant="secondary" onClick={onExport}>
              <Download size={16} /> {ar ? "تنزيل نسخة احتياطية" : "Download backup"}
            </Button>
            <Button variant="secondary" onClick={onReload}>
              <RefreshCcw size={16} /> {ar ? "تحميل أحدث بطاقة" : "Load latest card"}
            </Button>
            <Button onClick={onReapply}>
              <UploadCloud size={16} /> {ar ? "إعادة تطبيق تعديلاتي" : "Reapply my edits"}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
