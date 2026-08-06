"use client";

import {
  decideProgramPublicationState,
  type ProgramOperationalStatus,
  type ProgramPreviewPlatform,
  programPlatformCapabilities,
} from "@waflo/contracts";
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
  Archive,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  Eye,
  FlaskConical,
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
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError, apiFetch } from "../lib/api-client";
import {
  merchantProgramLifecycleLabel,
  type MerchantProgramLifecycleAction,
} from "./loyalty-card-presentation";
import { ProgramAssetPicker } from "./program-asset-uploader";
import { ProgramEnrollmentSettings, ProgramWalletReadiness } from "./program-enrollment-settings";
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
  type TestSession,
  type ValidationIssue,
  type ValidationResult,
  versionToDraft,
} from "./program-studio-types";
import {
  deriveStudioLifecyclePresentation,
  type StudioArea,
  studioAreaCopy,
  studioAreaForPublicationError,
  studioAreaForValidationPath,
  studioAreas,
  type StudioLifecyclePresentation,
  type StudioPresentationAction,
} from "./program-studio-presentation";

type SaveState = "saved" | "unsaved" | "saving" | "failed" | "conflict";
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
        ? "سيُنشر الإصدار الجديد، لكن البطاقة ستظل متوقفة مؤقتًا. استخدم الاستئناف بشكل منفصل عندما تكون مستعدًا لإعادتها للعمل."
        : "The new version will be published, but the card will remain paused. Use Resume separately when you are ready to make it live.";
    }
    return ar
      ? "يصبح الإصدار المختبَر مباشرًا للعملاء بعد إكمال التحقق ووضع الاختبار."
      : "The tested version becomes live for customers after validation and Test Mode are complete.";
  }
  if (action === "abandon") {
    return ar
      ? "ستُعلَّم المسودة القابلة للتحرير كمسودة متروكة، بينما تبقى البطاقة المنشورة مباشرة."
      : "The editable draft will be marked abandoned. The published card remains live.";
  }
  if (action === "archive" && !options.hasPublishedVersion) {
    return ar
      ? "تُؤرشف البطاقة غير المنشورة بأمان، مع الاحتفاظ بمسودتها الحالية وسجل إصداراتها لاستعادتها لاحقًا."
      : "Archive this unpublished card safely. Its current draft and version history will be preserved for restoration.";
  }
  if (action === "restore" && !options.hasPublishedVersion) {
    return ar
      ? "تعود البطاقة غير المنشورة إلى حالة المسودة المحفوظة."
      : "Restore this unpublished card to its preserved draft state.";
  }
  const descriptions: Record<Exclude<LifecycleAction, "publish" | "abandon">, [string, string]> = {
    pause: [
      "The card will stop being live for customers until you resume it.",
      "ستتوقف البطاقة عن الظهور مباشرة للعملاء حتى تستأنفها.",
    ],
    resume: ["The card will become live for customers again.", "ستعود البطاقة مباشرة للعملاء."],
    archive: [
      "The card will be archived while its setup and version history remain preserved.",
      "ستُؤرشف البطاقة مع الاحتفاظ بإعداداتها وسجل إصداراتها.",
    ],
    restore: ["The card will return to its preserved state.", "ستعود البطاقة إلى حالتها المحفوظة."],
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
  onClose,
  onEditDesign,
  onChanged,
}: {
  organizationId: string;
  programId: string;
  plan: "STARTER" | "GROWTH" | "SCALE";
  locations: LocationItem[];
  assets: AssetItem[];
  onAssetUploaded: (asset: AssetItem) => void;
  ar: boolean;
  builderHandoff?: boolean;
  onClose: () => void;
  onEditDesign: () => void;
  onChanged: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<ProgramDetail | null>(null);
  const [draft, setDraft] = useState<ProgramDraftInput | null>(null);
  const [revision, setRevision] = useState(1);
  const [activeArea, setActiveArea] = useState<StudioArea>("overview");
  const [selectedProfile, setSelectedProfile] = useState<PreviewProfile>("CUSTOMER_WEB");
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [previews, setPreviews] = useState<Partial<Record<PreviewProfile, PreviewResult>>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [testSession, setTestSession] = useState<TestSession | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [historicalVersion, setHistoricalVersion] = useState<ProgramVersion | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<LifecycleAction | null>(null);
  const [working, setWorking] = useState(false);
  const persistedRef = useRef("");
  const initializedRef = useRef(false);
  const mobileNavigationTriggerRef = useRef<HTMLButtonElement>(null);

  function selectArea(area: StudioArea) {
    const restoreMobileFocus = mobileNavigationOpen;
    setActiveArea(area);
    setMobileNavigationOpen(false);
    if (restoreMobileFocus) {
      window.requestAnimationFrame(() => mobileNavigationTriggerRef.current?.focus());
    }
  }

  const load = useCallback(async () => {
    const [program, history] = await Promise.all([
      apiFetch<ProgramDetail>(`/v1/organizations/${organizationId}/programs/${programId}`),
      apiFetch<CursorPage<ProgramVersion>>(
        `/v1/organizations/${organizationId}/programs/${programId}/versions?limit=20`,
      ),
    ]);
    program.versions = history.items;
    setHistoryCursor(history.nextCursor);
    setDetail(program);
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
    void load().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Unable to open Loyalty Studio."),
    );
  }, [load]);

  useEffect(() => {
    if (!draft || !initializedRef.current || conflict) return;
    const serialized = JSON.stringify(apiDraft(draft));
    if (serialized === persistedRef.current) return;
    setSaveState("unsaved");
    setPreviews({});
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
          setError(caught instanceof Error ? caught.message : "Autosave failed.");
        }
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [conflict, draft, organizationId, programId, revision]);

  const generatePreviews = useCallback(async () => {
    if (!draft && !detail?.currentPublishedVersion) return;
    if (
      draft &&
      (saveState !== "saved" || JSON.stringify(apiDraft(draft)) !== persistedRef.current)
    )
      return;
    setPreviewLoading(true);
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Preview generation failed.");
    } finally {
      setPreviewLoading(false);
    }
  }, [ar, detail?.currentPublishedVersion, draft, organizationId, programId, progress, saveState]);

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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Validation failed.");
    } finally {
      setWorking(false);
    }
  }

  async function startTest() {
    setWorking(true);
    try {
      const session = await apiFetch<TestSession>(
        `/v1/organizations/${organizationId}/programs/${programId}/test-sessions`,
        { method: "POST" },
      );
      setTestSession(session);
      setProgress(0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start Test Mode.");
    } finally {
      setWorking(false);
    }
  }

  async function testCommand(
    action:
      | {
          kind: "add";
          amount: number;
          purchaseAmountMinor?: number;
          purchaseCurrency?: string;
          managerApproved?: boolean;
          managerReason?: string;
          simulatedOccurredAt?: string;
        }
      | { kind: "reverse"; managerActor?: boolean; simulatedOccurredAt?: string }
      | { kind: "reset" }
      | { kind: "redeem"; rewardId: string; managerApproved?: boolean },
  ) {
    if (!testSession) return;
    setWorking(true);
    try {
      const key = crypto.randomUUID();
      const base = `/v1/organizations/${organizationId}/programs/test-sessions/${testSession.id}`;
      if (action.kind === "add")
        await apiFetch(`${base}/stamps`, {
          method: "POST",
          body: JSON.stringify({
            amount: action.amount,
            idempotencyKey: key,
            purchaseAmountMinor: action.purchaseAmountMinor,
            purchaseCurrency: action.purchaseCurrency,
            managerApproved: action.managerApproved,
            managerReason: action.managerReason,
            simulatedOccurredAt: action.simulatedOccurredAt,
          }),
        });
      if (action.kind === "reverse")
        await apiFetch(`${base}/reverse`, {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: key,
            managerActor: action.managerActor,
            simulatedOccurredAt: action.simulatedOccurredAt,
          }),
        });
      if (action.kind === "reset")
        await apiFetch(`${base}/reset`, {
          method: "POST",
          body: JSON.stringify({ idempotencyKey: key }),
        });
      if (action.kind === "redeem")
        await apiFetch(`${base}/redeem/${action.rewardId}`, {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: key,
            managerApproved: action.managerApproved,
          }),
        });
      const refreshed = await apiFetch<TestSession>(base);
      setTestSession(refreshed);
      setProgress(refreshed.currentStampCount);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Test Mode command failed.");
    } finally {
      setWorking(false);
    }
  }

  async function lifecycle(action: NonNullable<typeof confirmation>) {
    setWorking(true);
    setError("");
    try {
      if (action === "publish")
        await apiFetch(`/v1/organizations/${organizationId}/programs/${programId}/publish`, {
          method: "POST",
          body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
        });
      else if (action === "abandon")
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
    } catch (caught) {
      if (caught instanceof ApiClientError)
        setActiveArea(studioAreaForPublicationError(caught.code));
      if (
        ar &&
        caught instanceof ApiClientError &&
        caught.code === "PROGRAM_PUBLICATION_STATE_BLOCKED" &&
        typeof caught.details?.programStatus === "string"
      )
        setError(
          publicationStateGuidance(caught.details.programStatus as ProgramOperationalStatus, true)
            .message,
        );
      else setError(caught instanceof Error ? caught.message : "Lifecycle action failed.");
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create a draft.");
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
  const testReady = editingVersion?.status === "TEST_READY" || testSession?.status === "COMPLETED";
  const selectedPreview = previews[selectedProfile];

  if (!detail) {
    return (
      <Card className="studio-loading">
        <Clock3 /> {ar ? "جارٍ فتح الاستوديو…" : "Opening Studio…"}
      </Card>
    );
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
  const lifecycleState = deriveStudioLifecyclePresentation({
    programStatus: detail.status,
    draftVersionStatus: editingVersion?.status ?? displayVersion.status,
    locale,
    validationState: validated ? "passed" : validation ? "failed" : "not-run",
    testState: testReady ? "complete" : "incomplete",
    designComplete,
    locationsReady,
    hasPublishedVersion: detail.currentPublishedVersion !== null,
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
            <span>{statusLabel(saveState, ar)}</span>
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

      <div className="studio-mobile-navigation">
        <button
          ref={mobileNavigationTriggerRef}
          type="button"
          aria-expanded={mobileNavigationOpen}
          aria-controls="studio-mobile-navigation-menu"
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
          mobileOpen={mobileNavigationOpen}
          onArea={selectArea}
        />

        <main className="studio-editor-panel" id="studio-area-content" tabIndex={-1}>
          <div className="studio-panel-heading">
            <div>
              <span className="dashboard-card__label">
                {activeArea === "test"
                  ? ar
                    ? "عميل تجريبي فقط"
                    : "DEMO CUSTOMER ONLY"
                  : ar
                    ? "إدارة بطاقة الولاء"
                    : "MANAGE LOYALTY CARD"}
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
            organizationId={organizationId}
            programId={programId}
            locations={locations}
            assets={assets}
            onAssetUploaded={onAssetUploaded}
            plan={plan}
            ar={ar}
            lifecycleState={lifecycleState}
            validation={validation}
            validating={working}
            selectedProfile={selectedProfile}
            selectedPreview={selectedPreview}
            previewLoading={previewLoading}
            progress={progress}
            onProgress={setProgress}
            onProfile={setSelectedProfile}
            onEditDesign={onEditDesign}
            onArea={setActiveArea}
            onValidate={() => void validate()}
            onIssue={(issue) => setActiveArea(studioAreaForValidationPath(issue.path))}
            testSession={testSession}
            onStartTest={() => void startTest()}
            onTestCommand={(command) => void testCommand(command)}
            onCreateDraft={() => void createDraft()}
            onPublish={() => setConfirmation("publish")}
            onLifecycle={setConfirmation}
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
      <AlertDialog
        open={Boolean(confirmation)}
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
        confirmLabel={working ? (ar ? "جارٍ التنفيذ…" : "Working…") : ar ? "تأكيد" : "Confirm"}
        cancelLabel={ar ? "إلغاء" : "Cancel"}
        danger={confirmation === "archive" || confirmation === "abandon"}
        onClose={() => setConfirmation(null)}
        onConfirm={() => {
          if (confirmation) void lifecycle(confirmation);
        }}
      />
    </div>
  );
}

function StudioAreaIcon({ area }: { area: StudioArea }) {
  if (area === "overview") return <LayoutDashboard size={19} aria-hidden="true" />;
  if (area === "how-it-works") return <Workflow size={19} aria-hidden="true" />;
  if (area === "customers-locations") return <MapPinned size={19} aria-hidden="true" />;
  if (area === "test") return <FlaskConical size={19} aria-hidden="true" />;
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
  const currentIndex = presentation.journeyStages.findIndex(
    (stage) => stage.key === presentation.currentJourneyStage,
  );

  useEffect(() => {
    stageRefs.current[currentIndex]?.scrollIntoView({
      behavior: "smooth",
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
              activeArea === stage.area ? " studio-journey__active" : ""
            }`}
            aria-label={`${stage.label}: ${stage.stateLabel}. ${stage.hint}`}
            aria-current={stage.key === presentation.currentJourneyStage ? "step" : undefined}
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
  mobileOpen,
  onArea,
}: {
  activeArea: StudioArea;
  ar: boolean;
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
        return (
          <button
            type="button"
            key={area}
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
        );
      })}
    </nav>
  );
}

type StudioTestCommand =
  | {
      kind: "add";
      amount: number;
      purchaseAmountMinor?: number;
      purchaseCurrency?: string;
      managerApproved?: boolean;
      managerReason?: string;
      simulatedOccurredAt?: string;
    }
  | { kind: "reverse"; managerActor?: boolean; simulatedOccurredAt?: string }
  | { kind: "reset" }
  | { kind: "redeem"; rewardId: string; managerApproved?: boolean };

function StudioAreaContent({
  area,
  displayDraft,
  editableDraft,
  setDraft,
  displayVersion,
  detail,
  organizationId,
  programId,
  locations,
  assets,
  onAssetUploaded,
  plan,
  ar,
  lifecycleState,
  validation,
  validating,
  selectedProfile,
  selectedPreview,
  previewLoading,
  progress,
  onProgress,
  onProfile,
  onEditDesign,
  onArea,
  onValidate,
  onIssue,
  testSession,
  onStartTest,
  onTestCommand,
  onCreateDraft,
  onPublish,
  onLifecycle,
  onViewVersion,
  onLoadMoreVersions,
}: {
  area: StudioArea;
  displayDraft: ProgramDraftInput;
  editableDraft: ProgramDraftInput | null;
  setDraft: React.Dispatch<React.SetStateAction<ProgramDraftInput | null>>;
  displayVersion: ProgramVersion;
  detail: ProgramDetail;
  organizationId: string;
  programId: string;
  locations: LocationItem[];
  assets: AssetItem[];
  onAssetUploaded: (asset: AssetItem) => void;
  plan: "STARTER" | "GROWTH" | "SCALE";
  ar: boolean;
  lifecycleState: StudioLifecyclePresentation;
  validation: ValidationResult | null;
  validating: boolean;
  selectedProfile: PreviewProfile;
  selectedPreview: PreviewResult | undefined;
  previewLoading: boolean;
  progress: number;
  onProgress: (progress: number) => void;
  onProfile: (profile: PreviewProfile) => void;
  onEditDesign: () => void;
  onArea: (area: StudioArea) => void;
  onValidate: () => void;
  onIssue: (issue: ValidationIssue) => void;
  testSession: TestSession | null;
  onStartTest: () => void;
  onTestCommand: (command: StudioTestCommand) => void;
  onCreateDraft: () => void;
  onPublish: () => void;
  onLifecycle: (action: LifecycleAction) => void;
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
        testSession={testSession}
        onStartTest={onStartTest}
        onTestCommand={onTestCommand}
        detail={detail}
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
        previewLoading={previewLoading}
        progress={progress}
        onProgress={onProgress}
        onProfile={onProfile}
        onEditDesign={onEditDesign}
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

  if (area === "test")
    return editableDraft ? (
      <div className="studio-area-stack">
        <Alert
          tone="info"
          title={ar ? "اختبر بأمان مع عميل تجريبي" : "Test safely with a demo customer"}
        >
          {ar ? "لن يتم إنشاء أي نشاط لعميل حقيقي." : "No real customer activity will be created."}
        </Alert>
        {nestedSection("test-mode")}
        <Button variant="secondary" onClick={() => onArea("launch")}>
          {ar ? "الانتقال إلى جاهزية الإطلاق" : "Go to launch readiness"}
          <ChevronRight className="studio-logical-next" size={16} aria-hidden="true" />
        </Button>
      </div>
    ) : (
      <CreateUpdatePrompt ar={ar} onCreate={onCreateDraft} />
    );

  if (area === "launch")
    return (
      <LaunchPanel
        editable={Boolean(editableDraft)}
        organizationId={organizationId}
        ar={ar}
        lifecycleState={lifecycleState}
        validationPanel={nestedSection("validation")}
        onValidate={onValidate}
        onArea={onArea}
        onPublish={onPublish}
        onLifecycle={onLifecycle}
      />
    );

  return (
    <StudioSettingsPanel
      draft={displayDraft}
      editable={Boolean(editableDraft)}
      lifecycleState={lifecycleState}
      ar={ar}
      history={nestedSection("versions")}
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
  previewLoading,
  progress,
  onProgress,
  onProfile,
  onEditDesign,
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
  previewLoading: boolean;
  progress: number;
  onProgress: (progress: number) => void;
  onProfile: (profile: PreviewProfile) => void;
  onEditDesign: () => void;
  onArea: (area: StudioArea) => void;
  onLifecycle: (action: LifecycleAction) => void;
}) {
  const finalReward = [...displayDraft.rewards].sort(
    (left, right) => right.thresholdStampCount - left.thresholdStampCount,
  )[0];
  const rewardName =
    finalReward?.translations[ar ? "ar" : "en"].name ??
    displayDraft.translations[ar ? "ar" : "en"].rewardSummary;
  const activeLocations = locations.filter((location) =>
    displayDraft.locationIds.includes(location.id),
  );
  const changedAt = detail.updatedAt ?? displayVersion.publishedAt ?? null;
  const primaryAction = lifecycleState.primaryAction;

  function runPrimaryAction() {
    if (primaryAction.kind === "navigate") onArea(primaryAction.area);
    else if (primaryAction.kind === "lifecycle") onLifecycle(primaryAction.action);
    else onArea("launch");
  }

  return (
    <div className="studio-overview">
      <div className="studio-overview__hero">
        <StudioPreview
          draft={displayDraft}
          ar={ar}
          selectedProfile={selectedProfile}
          preview={selectedPreview}
          loading={previewLoading}
          progress={progress}
          onProgress={onProgress}
          onProfile={onProfile}
        />
        <section className="studio-next-action" aria-labelledby="studio-next-action-title">
          <span className="dashboard-card__label">{ar ? "الخطوة التالية" : "NEXT"}</span>
          <h3 id="studio-next-action-title">{primaryAction.label}</h3>
          <p>
            {lifecycleState.key === "draft" || lifecycleState.key === "ready"
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
            <p>{displayDraft.earningDescription}</p>
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
                  {new Intl.DateTimeFormat(ar ? "ar-IQ" : "en-IQ", { dateStyle: "medium" }).format(
                    new Date(changedAt),
                  )}
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
  loading,
  progress,
  onProgress,
  onProfile,
}: {
  draft: ProgramDraftInput;
  ar: boolean;
  selectedProfile: PreviewProfile;
  preview: PreviewResult | undefined;
  loading: boolean;
  progress: number;
  onProgress: (progress: number) => void;
  onProfile: (profile: PreviewProfile) => void;
}) {
  const profileLabel =
    selectedProfile === "CUSTOMER_WEB"
      ? ar
        ? "بطاقة العميل"
        : "Customer card"
      : selectedProfile === "APPLE_WALLET"
        ? "Apple Wallet"
        : "Google Wallet";
  return (
    <section
      className="studio-preview-panel studio-preview-panel--overview"
      aria-label={ar ? "معاينة البطاقة" : "Card preview"}
    >
      <div className="studio-preview-header">
        <div>
          <span className="dashboard-card__label">{ar ? "ما يراه العميل" : "CUSTOMER VIEW"}</span>
          <h3>{profileLabel}</h3>
        </div>
        <Eye size={20} aria-hidden="true" />
      </div>
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
      <div className={`studio-device-frame studio-device-frame--${selectedProfile.toLowerCase()}`}>
        {preview ? (
          <Image
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.svg)}`}
            alt={ar ? `معاينة ${profileLabel}` : `${profileLabel} preview`}
            width={preview.width}
            height={preview.height}
            unoptimized
          />
        ) : (
          <div className="studio-preview-loading" role="status">
            <RefreshCcw className={loading ? "studio-spin" : ""} aria-hidden="true" />
            <span>
              {loading
                ? ar
                  ? "جارٍ تجهيز المعاينة…"
                  : "Preparing preview…"
                : ar
                  ? "ستظهر المعاينة هنا"
                  : "Preview will appear here"}
            </span>
          </div>
        )}
      </div>
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
      {preview?.warnings.map((warning) => (
        <Alert key={warning.code} tone="warning" title={warning.message} />
      ))}
    </section>
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
  const rewardName =
    reward?.translations[ar ? "ar" : "en"].name ??
    draft.translations[ar ? "ar" : "en"].rewardSummary;
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
            <p>{draft.earningDescription}</p>
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
        const name = reward.translations[ar ? "ar" : "en"].name;
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
            : "The live card stays unchanged until you test and publish the update."}
        </p>
      </div>
      <Button onClick={onCreate}>{ar ? "إنشاء تحديث" : "Create update"}</Button>
    </Card>
  );
}

function LaunchPanel({
  editable,
  organizationId,
  ar,
  lifecycleState,
  validationPanel,
  onValidate,
  onArea,
  onPublish,
  onLifecycle,
}: {
  editable: boolean;
  organizationId: string;
  ar: boolean;
  lifecycleState: StudioLifecyclePresentation;
  validationPanel: React.ReactNode;
  onValidate: () => void;
  onArea: (area: StudioArea) => void;
  onPublish: () => void;
  onLifecycle: (action: LifecycleAction) => void;
}) {
  const automated = lifecycleState.launch.requirements.find(
    (requirement) => requirement.key === "automated",
  );

  function runAction(action: StudioPresentationAction) {
    if (action.kind === "navigate") onArea(action.area);
    else if (action.kind === "lifecycle") onLifecycle(action.action);
    else if (action.kind === "publish") onPublish();
    else onValidate();
  }

  return (
    <div className="studio-area-stack">
      <section
        className={`studio-launch-summary studio-launch-summary--${lifecycleState.launch.tone}`}
        aria-labelledby="studio-launch-title"
        role="status"
      >
        <div>
          <span className="dashboard-card__label">
            {ar ? "الحالة العامة" : "OVERALL LAUNCH STATUS"}
          </span>
          <h3 id="studio-launch-title">{lifecycleState.launch.label}</h3>
          <p>{lifecycleState.launch.description}</p>
        </div>
        {lifecycleState.launch.tone === "success" ? (
          <ShieldCheck size={34} aria-hidden="true" />
        ) : lifecycleState.launch.tone === "warning" ? (
          <Pause size={34} aria-hidden="true" />
        ) : lifecycleState.launch.tone === "neutral" ? (
          <Archive size={34} aria-hidden="true" />
        ) : lifecycleState.launch.tone === "danger" ? (
          <CircleAlert size={34} aria-hidden="true" />
        ) : (
          <Rocket size={34} aria-hidden="true" />
        )}
      </section>

      <ul
        className="studio-readiness-list"
        aria-label={ar ? "متطلبات الإطلاق" : "Launch requirements"}
      >
        {lifecycleState.launch.requirements.map((requirement) => (
          <ReadinessRow
            key={requirement.key}
            requirement={requirement}
            onAction={
              requirement.action &&
              !(
                requirement.action.kind === lifecycleState.launch.action.kind &&
                requirement.action.label === lifecycleState.launch.action.label
              )
                ? () => {
                    if (requirement.action) runAction(requirement.action);
                  }
                : undefined
            }
          />
        ))}
      </ul>

      <ProgramWalletReadiness organizationId={organizationId} ar={ar} />

      {editable ? (
        <details className="studio-launch-checks" open={!automated?.complete}>
          <summary>
            <span>
              <ShieldCheck size={19} aria-hidden="true" />{" "}
              <strong>{ar ? "تفاصيل الفحوصات الآلية" : "Automated check details"}</strong>
            </span>
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <div>{validationPanel}</div>
        </details>
      ) : null}

      <div className="studio-launch-action">
        <div>
          <strong>{lifecycleState.launch.action.label}</strong>
          <small id="studio-launch-action-description">{lifecycleState.launch.description}</small>
        </div>
        <Button
          onClick={() => runAction(lifecycleState.launch.action)}
          aria-describedby="studio-launch-action-description"
        >
          {lifecycleState.launch.action.kind === "publish" ? (
            <Rocket size={16} aria-hidden="true" />
          ) : lifecycleState.launch.action.kind === "lifecycle" &&
            lifecycleState.launch.action.action === "resume" ? (
            <Play size={16} aria-hidden="true" />
          ) : lifecycleState.launch.action.kind === "lifecycle" &&
            lifecycleState.launch.action.action === "restore" ? (
            <RotateCcw size={16} aria-hidden="true" />
          ) : (
            <ChevronRight className="studio-logical-next" size={16} aria-hidden="true" />
          )}
          {lifecycleState.launch.action.label}
        </Button>
      </div>
    </div>
  );
}

function ReadinessRow({
  requirement,
  onAction,
}: {
  requirement: StudioLifecyclePresentation["launch"]["requirements"][number];
  onAction?: (() => void) | undefined;
}) {
  return (
    <li className={requirement.blocking ? "studio-readiness-row--blocking" : ""}>
      <span className={requirement.complete ? "studio-readiness-row__complete" : ""}>
        {requirement.complete ? (
          <Check size={16} aria-hidden="true" />
        ) : (
          <CircleAlert size={16} aria-hidden="true" />
        )}
      </span>
      <span>
        <strong>{requirement.label}</strong>
        <small>{requirement.description}</small>
      </span>
      <span className="studio-readiness-row__status">
        <strong>{requirement.status}</strong>
        {onAction && requirement.action ? (
          <button
            type="button"
            onClick={onAction}
            aria-label={`${requirement.action.label}: ${requirement.label}`}
          >
            {requirement.action.label}
            <ChevronRight className="studio-logical-next" size={15} aria-hidden="true" />
          </button>
        ) : null}
      </span>
    </li>
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
            <dd>{draft.translations[ar ? "ar" : "en"].programName}</dd>
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
  testSession,
  onStartTest,
  onTestCommand,
  detail,
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
  testSession: TestSession | null;
  onStartTest: () => void;
  onTestCommand: (
    command:
      | {
          kind: "add";
          amount: number;
          purchaseAmountMinor?: number;
          purchaseCurrency?: string;
          managerApproved?: boolean;
          managerReason?: string;
          simulatedOccurredAt?: string;
        }
      | { kind: "reverse"; managerActor?: boolean; simulatedOccurredAt?: string }
      | { kind: "reset" }
      | { kind: "redeem"; rewardId: string; managerApproved?: boolean },
  ) => void;
  detail: ProgramDetail;
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
            placeholder="What changed in this version?"
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
        <Alert tone="info" title={ar ? "سياسة عمليات W4" : "W4 operations policy"}>
          {ar
            ? "تُطبّق حدود العملية واليوم وسياسة الشراء من إصدار البرنامج المثبت للعضوية."
            : "Operation limits, gross daily caps, purchase policy, and reset semantics come from the Membership's pinned Program Version."}
        </Alert>
        <Alert tone="info" title={ar ? "محاكاة آمنة" : "Safe simulation"}>
          {ar
            ? "يدعم وضع الاختبار حدود اليوم والشراء والعملة وموافقة المدير ووقت العكس الاصطناعي."
            : "Test Mode simulates daily caps, purchase/currency checks, manager approval, and reversal time without creating a Customer or production ledger entry."}
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
                <input
                  type="color"
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

  if (section === "test-mode")
    return (
      <TestModePanel
        session={testSession}
        onStart={onStartTest}
        onCommand={onTestCommand}
        working={validating}
        ar={ar}
      />
    );

  return (
    <div className="studio-section-content">
      <VersionHistory
        versions={detail.versions}
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
            : "Use the safe Archive action to hide this unpublished card while preserving its draft and version history."}
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
  return (
    <div className="studio-section-content">
      <Alert tone="info" title={ar ? "قواعد التحديث" : "How rule changes take effect"}>
        {ar
          ? "تطبّق التغييرات الجديدة على العملاء الذين ينضمون بعد نشر التحديث، بينما تبقى شروط العملاء الحاليين كما هي."
          : "New rules apply to customers who join after this update is published. Existing customers keep their current terms."}
      </Alert>
      <FormField label={ar ? "المنطقة الزمنية للنشاط" : "Business timezone"} required>
        <TextInput
          value={draft.operationalTimezone}
          onChange={(event) =>
            update((current) => ({ ...current, operationalTimezone: event.target.value }))
          }
          placeholder="Asia/Baghdad"
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
          {ar ? "لا يتم إصدار بطاقة Apple Wallet حقيقية." : "No Apple Wallet pass is issued in W2."}
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
            ? "لا يتم إنشاء كائن Google Wallet حقيقي."
            : "No Google Wallet object is created in W2."}
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
                ? "لا توجد مشكلة تمنع الانتقال إلى الاختبار."
                : "Nothing here blocks you from moving to testing."
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

function testEventLabel(eventType: string, ar: boolean): string {
  const labels: Record<string, [string, string]> = {
    TEST_SESSION_STARTED: ["Demo customer started", "بدأ العميل التجريبي"],
    TEST_STAMPS_ADDED: ["Stamps added", "تمت إضافة الأختام"],
    TEST_STAMP_ADDED: ["Stamp added", "تمت إضافة ختم"],
    TEST_STAMP_REVERSED: ["Latest stamp corrected", "تم تصحيح آخر ختم"],
    TEST_REWARD_UNLOCKED: ["Reward unlocked", "أصبحت المكافأة جاهزة"],
    TEST_REWARD_RELOCKED: ["Reward locked again", "أُغلقت المكافأة مجددًا"],
    TEST_REWARD_REDEEMED: ["Reward used", "تم استخدام المكافأة"],
    TEST_SESSION_RESET: ["Demo customer reset", "أُعيد ضبط العميل التجريبي"],
    TEST_SESSION_COMPLETED: ["Test completed", "اكتمل الاختبار"],
  };
  return labels[eventType]?.[ar ? 1 : 0] ?? (ar ? "نشاط تجريبي" : "Test activity");
}

function TestModePanel({
  session,
  onStart,
  onCommand,
  working,
  ar,
}: {
  session: TestSession | null;
  onStart: () => void;
  onCommand: (command: StudioTestCommand) => void;
  working: boolean;
  ar: boolean;
}) {
  const [testPurchaseAmount, setTestPurchaseAmount] = useState("");
  const [testPurchaseCurrency, setTestPurchaseCurrency] = useState("IQD");
  const [testManagerApproved, setTestManagerApproved] = useState(false);
  const [testManagerActor, setTestManagerActor] = useState(false);
  const [testOccurredAt, setTestOccurredAt] = useState("");
  if (!session)
    return (
      <div className="studio-section-content">
        <FlaskConical size={34} />
        <h3>{ar ? "ابدأ بعميل تجريبي" : "Start with a demo customer"}</h3>
        <p>
          {ar
            ? "لن يتم إنشاء أي نشاط لعميل حقيقي. يمكنك إعادة التجربة متى شئت."
            : "No real customer activity will be created. You can reset and try again at any time."}
        </p>
        <Button onClick={onStart} loading={working}>
          {ar ? "بدء عميل تجريبي" : "Start demo customer"}
        </Button>
      </div>
    );
  const goal = session.version.stampRule?.requiredStampCount ?? 8;
  const rewardReady = session.currentStampCount >= goal;
  const unlocks = session.events.filter((event) => event.eventType === "TEST_REWARD_UNLOCKED");
  const relocks = session.events.filter((event) => event.eventType === "TEST_REWARD_RELOCKED");
  const redemptions = session.events.filter((event) => event.eventType === "TEST_REWARD_REDEEMED");
  const syntheticOperation = {
    ...(testPurchaseAmount ? { purchaseAmountMinor: Number.parseInt(testPurchaseAmount, 10) } : {}),
    ...(testPurchaseCurrency ? { purchaseCurrency: testPurchaseCurrency } : {}),
    managerApproved: testManagerApproved,
    ...(testManagerApproved ? { managerReason: "Synthetic Test Mode manager approval." } : {}),
    ...(testOccurredAt ? { simulatedOccurredAt: new Date(testOccurredAt).toISOString() } : {}),
  };
  const testSteps = [
    { label: ar ? "بدء عميل تجريبي" : "Start demo customer", complete: true },
    {
      label: ar ? "إضافة أختام" : "Add stamps",
      complete: session.currentStampCount > 0 || unlocks.length > 0 || redemptions.length > 0,
    },
    {
      label: ar ? "الوصول إلى المكافأة" : "Reach the reward",
      complete: rewardReady || unlocks.length > 0 || redemptions.length > 0,
    },
    { label: ar ? "استخدام المكافأة" : "Use the reward", complete: redemptions.length > 0 },
    {
      label: ar ? "التأكد من بدء دورة جديدة" : "Verify the reset",
      complete: session.cycleCount > 0,
    },
    { label: ar ? "إنهاء الاختبار" : "Finish test", complete: session.status === "COMPLETED" },
  ];
  return (
    <div className="studio-section-content">
      <ol className="studio-test-steps" aria-label={ar ? "خطوات الاختبار" : "Test steps"}>
        {testSteps.map((step) => (
          <li className={step.complete ? "studio-test-steps__complete" : ""} key={step.label}>
            <span>{step.complete ? <Check size={15} aria-hidden="true" /> : null}</span>
            <strong>{step.label}</strong>
          </li>
        ))}
      </ol>
      <div className="test-mode-meter">
        <div>
          <small>{ar ? "التقدم الحالي" : "Current progress"}</small>
          <strong dir="ltr">
            <span>
              {session.currentStampCount} / {goal}
            </span>
            <small>{ar ? "أختام" : "stamps"}</small>
          </strong>
        </div>
        <div>
          <small>{ar ? "الدورات المكتملة" : "Completed cycles"}</small>
          <strong>
            <span>{session.cycleCount}</span>
          </strong>
        </div>
        <Badge tone={session.status === "COMPLETED" ? "success" : "brand"}>
          {session.status === "COMPLETED"
            ? ar
              ? "اكتمل"
              : "Complete"
            : ar
              ? "قيد الاختبار"
              : "In progress"}
        </Badge>
      </div>
      <div className="dashboard-actions studio-test-actions">
        <Button
          onClick={() => onCommand({ kind: "add", amount: 1, ...syntheticOperation })}
          disabled={working || rewardReady}
        >
          {ar ? "إضافة ختم" : "Add a stamp"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => onCommand({ kind: "add", amount: 5, ...syntheticOperation })}
          disabled={working || rewardReady}
        >
          {ar ? "+٥ أختام" : "+5 stamps"}
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            onCommand({
              kind: "reverse",
              managerActor: testManagerActor,
              ...(testOccurredAt
                ? { simulatedOccurredAt: new Date(testOccurredAt).toISOString() }
                : {}),
            })
          }
          disabled={working}
        >
          <RotateCcw size={16} /> {ar ? "تصحيح آخر ختم" : "Correct latest stamp"}
        </Button>
        <Button variant="secondary" onClick={() => onCommand({ kind: "reset" })} disabled={working}>
          {ar ? "إعادة ضبط العميل التجريبي" : "Reset demo customer"}
        </Button>
      </div>
      <details className="studio-test-advanced">
        <summary>
          <span>
            <Settings2 size={18} aria-hidden="true" />{" "}
            {ar ? "تفاصيل عملية الشراء التجريبية" : "Demo purchase details"}
          </span>
          <ChevronDown size={18} aria-hidden="true" />
        </summary>
        <div className="studio-field-grid">
          <FormField
            label={ar ? "قيمة الشراء" : "Purchase amount"}
            hint={ar ? "أدخلها بأصغر وحدة للعملة" : "Enter the smallest unit of the currency"}
          >
            <TextInput
              inputMode="numeric"
              value={testPurchaseAmount}
              onChange={(event) => setTestPurchaseAmount(event.target.value.replace(/\D/g, ""))}
            />
          </FormField>
          <FormField label={ar ? "عملة الشراء" : "Purchase currency"}>
            <TextInput
              maxLength={3}
              value={testPurchaseCurrency}
              onChange={(event) => setTestPurchaseCurrency(event.target.value.toUpperCase())}
            />
          </FormField>
          <FormField label={ar ? "وقت العملية التجريبية" : "Demo purchase time"}>
            <TextInput
              type="datetime-local"
              value={testOccurredAt}
              onChange={(event) => setTestOccurredAt(event.target.value)}
            />
          </FormField>
        </div>
        <label className="studio-checkbox-row">
          <input
            type="checkbox"
            checked={testManagerApproved}
            onChange={(event) => setTestManagerApproved(event.target.checked)}
          />
          <span>
            {ar ? "اعتبار العملية معتمدة من المدير" : "Treat this purchase as manager approved"}
          </span>
        </label>
        <label className="studio-checkbox-row">
          <input
            type="checkbox"
            checked={testManagerActor}
            onChange={(event) => setTestManagerActor(event.target.checked)}
          />
          <span>{ar ? "استخدام مهلة تصحيح المدير" : "Use the manager correction window"}</span>
        </label>
        <Alert tone="info" title={ar ? "القواعد الجاري اختبارها" : "Rules used in this test"}>
          {session.version.operationalTimezone} ·{" "}
          {ar ? "أقصى أختام للعملية" : "stamps per purchase"}{" "}
          {session.version.stampRule?.maximumStampsPerOperation ?? 5} ·{" "}
          {ar ? "الحد اليومي" : "daily limit"}{" "}
          {session.version.stampRule?.maximumStampsPerCustomerPerDay ?? "—"} ·{" "}
          {ar ? "الحد الأدنى للشراء" : "minimum purchase"}{" "}
          {session.version.stampRule?.minimumPurchaseAmountMinor ?? "—"}{" "}
          {session.version.stampRule?.minimumPurchaseCurrency ?? ""}
        </Alert>
      </details>
      {rewardReady ? (
        <Alert tone="success" title={ar ? "المكافأة جاهزة" : "Reward ready"}>
          {ar
            ? "اكتملت كل الخانات. استرد المكافأة النهائية لبدء دورة جديدة من الصفر."
            : "Every slot is filled. Redeem the final reward to reset the grid and begin a new cycle."}
        </Alert>
      ) : null}
      <div className="studio-test-rewards">
        {session.version.rewards.map((reward) => {
          const earned =
            unlocks.filter((event) => event.rewardDefinitionId === reward.id).length -
            relocks.filter((event) => event.rewardDefinitionId === reward.id).length;
          const redeemed = redemptions.filter(
            (event) => event.rewardDefinitionId === reward.id,
          ).length;
          const name =
            reward.translations.find((translation) => translation.locale === (ar ? "AR" : "EN"))
              ?.name ?? reward.internalName;
          return (
            <Card key={reward.id}>
              <Badge tone={earned > redeemed ? "success" : "neutral"}>
                {ar
                  ? `عند ${reward.thresholdStampCount} أختام`
                  : `At ${reward.thresholdStampCount} stamps`}
              </Badge>
              <h4>{name}</h4>
              <p>
                {ar
                  ? `${earned} مكتسبة · ${redeemed} مستخدمة`
                  : `${earned} earned · ${redeemed} used`}
              </p>
              <Button
                disabled={earned <= redeemed || working}
                onClick={() =>
                  onCommand({
                    kind: "redeem",
                    rewardId: reward.id,
                    managerApproved: testManagerApproved,
                  })
                }
              >
                {ar ? "استخدام المكافأة التجريبية" : "Use demo reward"}
              </Button>
            </Card>
          );
        })}
      </div>
      <details className="studio-event-log">
        <summary>{ar ? "عرض نشاط الاختبار" : "Show test activity"}</summary>
        <div>
          {session.events.slice(0, 20).map((event) => (
            <div key={event.id}>
              <strong>{testEventLabel(event.eventType, ar)}</strong>
              <small>
                {event.safeMetadata?.cycle
                  ? ar
                    ? `الدورة ${event.safeMetadata.cycle}`
                    : `Cycle ${event.safeMetadata.cycle}`
                  : ""}
              </small>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function VersionHistory({
  versions,
  ar,
  onView,
  onLoadMore,
}: {
  versions: ProgramVersion[];
  ar: boolean;
  onView: (versionId: string) => void;
  onLoadMore?: (() => void) | undefined;
}) {
  return (
    <Card className="studio-version-history">
      <div className="studio-section-heading">
        <div>
          <span className="dashboard-card__label">{ar ? "سجل التغييرات" : "CHANGE HISTORY"}</span>
          <h3>{ar ? "التغييرات المحفوظة" : "Saved changes"}</h3>
        </div>
        <History size={20} aria-hidden="true" />
      </div>
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
                      {new Intl.DateTimeFormat(ar ? "ar-IQ" : "en-IQ", {
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
