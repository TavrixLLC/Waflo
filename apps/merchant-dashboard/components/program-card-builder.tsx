"use client";

import { planCatalog } from "@waflo/billing";
import type { Locale } from "@waflo/contracts";
import {
  directionFor,
  directionForInterface,
  localeRegistry,
  type InterfaceLocale,
} from "@waflo/i18n";
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
  Globe2,
  MapPin,
  Palette,
  RefreshCcw,
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
const previewContentLocales = { EN: "en", AR: "ar" } as const;

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

function previewSource(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function builderText(locale: InterfaceLocale | Locale) {
  return localeRegistry[locale].messages.merchant.loyalty.builder;
}

function previewLabel(profile: PreviewProfile, locale: InterfaceLocale | Locale): string {
  if (profile === "APPLE_WALLET") return "Apple Wallet";
  if (profile === "GOOGLE_WALLET") return "Google Wallet";
  return builderText(locale).customer;
}

function merchantError(error: unknown, locale: InterfaceLocale | Locale): string {
  const text = builderText(locale);
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
  interfaceLocale,
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
  interfaceLocale: InterfaceLocale;
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
  const interfaceDirection = directionForInterface(interfaceLocale);
  const ar = locale === "ar";
  const text = builderText(interfaceLocale);
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
        builderText(interfaceLocale).ui.thisCardHasNoEditableDraftOpenStudioToCreateTheNextVersion,
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
    void load().catch(() => setError(text.openingError));
  }, [load, locale, organizationId, programId, text.openingError]);

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
            setError(merchantError(caught, interfaceLocale));
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
    [conflict, interfaceLocale, organizationId, programId],
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
        setError(merchantError(caught, interfaceLocale));
        return null;
      } finally {
        setPreviewLoading(false);
      }
    },
    [interfaceLocale, organizationId, previewKey, previewLocale, programId, progress],
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
      setError(merchantError(caught, interfaceLocale));
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
    if (error) {
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
          </div>
        </Card>
      );
    }
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
    ? builderText(interfaceLocale).ui.startFromScratch
    : selectedTemplate
      ? templateDisplayName(selectedTemplate, locale)
      : builderText(interfaceLocale).ui.selectedDesign;
  const selectedMeta = selectedTemplate
    ? `${templateCategoryLabel(templateCategory(selectedTemplate), locale)} · ${blank ? (builderText(interfaceLocale).ui.neutral) : templateStyleLabel(selectedTemplate, locale)}`
    : text.selectedDesign;
  const accentStyle = {
    "--builder-live-accent": draft.visualTheme.accentColor,
  } as CSSProperties;

  return (
    <div className="builder-shell" dir={interfaceDirection} style={accentStyle}>
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
            aria-label={builderText(interfaceLocale).ui.cardBuilderSections}
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
              <BasicsSection
                draft={draft}
                update={update}
                interfaceLocale={interfaceLocale}
              />
            ) : null}
            {activeSection === "reward" ? (
              <RewardSection
                draft={draft}
                update={update}
                interfaceLocale={interfaceLocale}
              />
            ) : null}
            {activeSection === "languages" ? (
              <LanguagesSection
                draft={draft}
                update={update}
                interfaceLocale={interfaceLocale}
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
                interfaceLocale={interfaceLocale}
              />
            ) : null}
            {activeSection === "appearance" ? (
              <AppearanceSection
                draft={draft}
                update={update}
                organizationId={organizationId}
                assets={assets}
                onAssetUploaded={onAssetUploaded}
                interfaceLocale={interfaceLocale}
              />
            ) : null}
            {activeSection === "advanced" ? (
              <AdvancedSection
                draft={draft}
                update={update}
                plan={plan}
                locale={locale}
                interfaceLocale={interfaceLocale}
              />
            ) : null}
            {activeSection === "review" ? (
              <ReviewSection
                readiness={readiness}
                validation={validation}
                canRunChecks={localReadiness.ready}
                working={working}
                interfaceLocale={interfaceLocale}
                onSection={setActiveSection}
                onRunChecks={() => void runChecks()}
              />
            ) : null}
          </section>
        </div>

        <aside className="builder-preview-desktop" aria-label={text.preview}>
          <PreviewPanel
            idPrefix="builder-desktop"
            draft={draft}
            interfaceLocale={interfaceLocale}
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
            interfaceLocale={interfaceLocale}
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
  interfaceLocale,
}: {
  draft: ProgramDraftInput;
  update: DraftUpdate;
  interfaceLocale: InterfaceLocale;
}) {
  return (
    <div className="builder-form-stack">
      <FormField
        label={builderText(interfaceLocale).ui.cardNameInYourDashboard}
        hint={builderText(interfaceLocale).ui.customersDoNotSeeThisInternalName}
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
        label={builderText(interfaceLocale).ui.howDoesACustomerEarnAStamp}
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
            {builderText(interfaceLocale).ui.stampGoal} <span aria-hidden="true">*</span>
          </label>
          <small>
            {builderText(interfaceLocale).ui.thisCardSupportsAnExactGoalFrom2To30Stamps}
          </small>
        </div>
        <input
          id="builder-stamp-goal"
          type="range"
          min={2}
          max={30}
          value={draft.requiredStampCount}
          aria-valuetext={`${draft.requiredStampCount} ${builderText(interfaceLocale).ui.stamps}`}
          onChange={(event) =>
            update((current) => updateBuilderStampGoal(current, Number(event.target.value)))
          }
        />
        <TextInput
          aria-label={builderText(interfaceLocale).ui.exactStampGoal}
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
  interfaceLocale,
}: {
  draft: ProgramDraftInput;
  update: DraftUpdate;
  interfaceLocale: InterfaceLocale;
}) {
  const index = finalRewardIndex(draft);
  const reward = draft.rewards[index];
  if (!reward) return null;
  return (
    <div className="builder-form-stack">
      <div className="builder-reward-callout">
        <span>{builderText(interfaceLocale).ui.unlockedAt}</span>
        <strong>
          {draft.requiredStampCount} {builderText(interfaceLocale).ui.stamps}
        </strong>
        <small>
          {builderText(interfaceLocale).ui.rewardReadinessAppearsOutsideTheStampGrid}
        </small>
      </div>
      <div className="builder-form-grid">
        <FormField
          label={builderText(interfaceLocale).ui.whatDoesTheCustomerGet}
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
        <FormField label={builderText(interfaceLocale).ui.arabicReward} required>
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
        <summary>{builderText(interfaceLocale).ui.rewardOptions}</summary>
        <div className="builder-form-grid">
          <FormField label={builderText(interfaceLocale).ui.rewardType}>
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
              <option value="FREE_ITEM">{builderText(interfaceLocale).ui.freeItem}</option>
              <option value="DISCOUNT_DESCRIPTION">{builderText(interfaceLocale).ui.discount}</option>
              <option value="TEXT_REWARD">{builderText(interfaceLocale).ui.descriptiveReward}</option>
              <option value="CUSTOM">{builderText(interfaceLocale).ui.custom}</option>
            </Select>
          </FormField>
        </div>
        <p className="builder-studio-ownership-note">
          {builderText(interfaceLocale).ui.rewardValidityAndRedemptionApprovalsAreSetInStudioAfterTheCardDesignIsComplete}
        </p>
      </details>
    </div>
  );
}

function LanguagesSection({
  draft,
  update,
  interfaceLocale,
  language,
  setLanguage,
  enCompleteness,
  arCompleteness,
}: {
  draft: ProgramDraftInput;
  update: DraftUpdate;
  interfaceLocale: InterfaceLocale;
  language: "en" | "ar";
  setLanguage: (language: "en" | "ar") => void;
  enCompleteness: ReturnType<typeof languageCompleteness>;
  arCompleteness: ReturnType<typeof languageCompleteness>;
}) {
  const text = builderText(interfaceLocale);
  const value = draft.translations[language];
  const completeness = language === "en" ? enCompleteness : arCompleteness;
  const contentDirection = directionFor(language);
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
        aria-label={builderText(interfaceLocale).ui.cardLanguages}
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
                {status.complete ? text.complete : `${status.missing} ${text.fieldsRemaining}`}
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
        dir={contentDirection}
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
  interfaceLocale,
}: {
  draft: ProgramDraftInput;
  update: DraftUpdate;
  locations: LocationItem[];
  interfaceLocale: InterfaceLocale;
}) {
  const text = builderText(interfaceLocale);
  const active = locations.filter((location) => location.status.toUpperCase() === "ACTIVE");
  return (
    <div className="builder-form-stack">
      {active.length === 1 ? (
        <Alert tone="info" title={builderText(interfaceLocale).ui.yourActiveLocationIsIncluded}>
          {builderText(interfaceLocale).ui.youCanRemoveItButAtLeastOneLocationIsRequiredForReadiness}
        </Alert>
      ) : null}
      {!active.length ? (
        <Alert tone="warning" title={text.locationError} />
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
                  <small>{isActive ? (builderText(interfaceLocale).ui.active) : builderText(interfaceLocale).ui.inactive}</small>
                </span>
                <span className="builder-location__capabilities">
                  <Badge tone={selected ? "success" : "neutral"}>{builderText(interfaceLocale).ui.earning}</Badge>
                  <Badge tone={selected ? "success" : "neutral"}>
                    {builderText(interfaceLocale).ui.redemption}
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
  interfaceLocale,
}: {
  draft: ProgramDraftInput;
  update: DraftUpdate;
  organizationId: string;
  assets: AssetItem[];
  onAssetUploaded: (asset: AssetItem) => void;
  interfaceLocale: InterfaceLocale;
}) {
  const colors = [
    ["backgroundColor", builderText(interfaceLocale).ui.background],
    ["foregroundColor", builderText(interfaceLocale).ui.text],
    ["accentColor", builderText(interfaceLocale).ui.accent],
    ["secondaryColor", builderText(interfaceLocale).ui.secondary],
  ] as const;
  return (
    <div className="builder-form-stack">
      <div className="builder-color-grid">
        {colors.map(([key, label]) => (
          <FormField key={key} label={label}>
            <div className="builder-color-control">
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
      <div className="builder-artwork-grid">
        <ProgramAssetPicker
          organizationId={organizationId}
          category="STAMP_FILLED"
          label={builderText(interfaceLocale).ui.stampedIcon}
          assets={assets}
          selectedId={draft.visualTheme.filledStampAssetId}
          onSelected={(assetId) =>
            update((current) => ({
              ...current,
              visualTheme: { ...current.visualTheme, filledStampAssetId: assetId ?? undefined },
            }))
          }
          onUploaded={onAssetUploaded}
          ar={interfaceLocale === "ar"}
        />
        <ProgramAssetPicker
          organizationId={organizationId}
          category="STAMP_EMPTY"
          label={builderText(interfaceLocale).ui.emptyStamp}
          assets={assets}
          selectedId={draft.visualTheme.emptyStampAssetId}
          onSelected={(assetId) =>
            update((current) => ({
              ...current,
              visualTheme: { ...current.visualTheme, emptyStampAssetId: assetId ?? undefined },
            }))
          }
          onUploaded={onAssetUploaded}
          ar={interfaceLocale === "ar"}
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
  interfaceLocale,
}: {
  draft: ProgramDraftInput;
  update: DraftUpdate;
  plan: "STARTER" | "GROWTH" | "SCALE";
  locale: Locale;
  interfaceLocale: InterfaceLocale;
}) {
  const ar = locale === "ar";
  const text = builderText(interfaceLocale);
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
      {!proAvailable ? <Alert tone="info" title={text.starterAdvanced} /> : null}
      <FormField label={text.mode}>
        <Select
          value={draft.editingMode}
          onChange={(event) => {
            const mode = event.target.value as "quick" | "pro";
            if (mode === "pro" && !proAvailable) return;
            if (mode === "quick" && milestones.length > 0) return;
            update((current) => ({ ...current, editingMode: mode }));
          }}
        >
          <option value="quick">{text.quick}</option>
          <option value="pro" disabled={!proAvailable}>
            {text.pro}
          </option>
        </Select>
      </FormField>
      {milestones.length > 0 ? (
        <Alert
          tone="warning"
          title={
            builderText(interfaceLocale).ui.removeMilestonesBeforeReturningToQuickMode
          }
        />
      ) : null}
      {draft.editingMode === "pro" ? (
        <div className="builder-pro-rewards">
          <div className="builder-subheading">
            <div>
              <h3>{builderText(interfaceLocale).ui.milestoneRewards}</h3>
              <p>
                {builderText(interfaceLocale).ui.milestonesRemainOutsideTheStampGridAndNeverReplaceASlot}
              </p>
            </div>
            <Button type="button" variant="secondary" onClick={addMilestone}>
              {builderText(interfaceLocale).ui.addMilestone}
            </Button>
          </div>
          {milestones.map((reward) => (
            <Card key={reward.clientId} className="builder-milestone">
              <div className="builder-form-grid">
                <FormField label={builderText(interfaceLocale).ui.stampThreshold}>
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
                <FormField label={builderText(interfaceLocale).ui.rewardName}>
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
                {builderText(interfaceLocale).ui.removeMilestone}
              </Button>
            </Card>
          ))}
        </div>
      ) : null}
      <div className="builder-studio-ownership-note" role="note">
        <strong>{builderText(interfaceLocale).ui.operationalRulesLiveInStudio}</strong>
        <p>
          {builderText(interfaceLocale).ui.afterDesignSetStampLimitsPurchaseRequirementsReversalWindowsAndManagerPermissionsInHowItWorks}
        </p>
      </div>
      <details className="builder-disclosure">
        <summary>{builderText(interfaceLocale).ui.stampArrangement}</summary>
        <div className="builder-layout-options">
          {(["ROW", "GRID", "PATH", "RING"] as const).map((layout) => {
            const locked = !proAvailable && (layout === "PATH" || layout === "RING");
            const labels = {
              ROW: builderText(interfaceLocale).ui.horizontal,
              GRID: builderText(interfaceLocale).ui.classic,
              PATH: builderText(interfaceLocale).ui.flowing,
              RING: builderText(interfaceLocale).ui.circular,
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
                    ? builderText(interfaceLocale).ui.growthRequired
                    : builderText(interfaceLocale).ui.responsiveArrangement}
                </small>
              </button>
            );
          })}
        </div>
      </details>
      <details className="builder-disclosure">
        <summary>{builderText(interfaceLocale).ui.previewSurfaceDetails}</summary>
        <div className="builder-form-stack">
          <div className="builder-subheading">
            <div>
              <h3>{builderText(interfaceLocale).ui.customerCard}</h3>
              <p>
                {builderText(interfaceLocale).ui.chooseTheRicherWebCardCompositionCustomersSee}
              </p>
            </div>
          </div>
          <FormField label={builderText(interfaceLocale).ui.customerCardLayout}>
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
              <option value="CARD">{builderText(interfaceLocale).ui.card}</option>
              <option value="MINIMAL">{builderText(interfaceLocale).ui.minimal}</option>
              <option value="HERO">{builderText(interfaceLocale).ui.hero}</option>
            </Select>
          </FormField>
          <div className="builder-subheading">
            <div>
              <h3>Apple Wallet</h3>
              <p>
                {builderText(interfaceLocale).ui.theseLabelsApplyToTheFieldsSupportedByAppleWallet}
              </p>
            </div>
          </div>
          <div className="builder-form-grid">
            {(
              [
                ["headerLabel", builderText(interfaceLocale).ui.headerLabel],
                ["headerValue", builderText(interfaceLocale).ui.headerValue],
                ["secondaryLabel", builderText(interfaceLocale).ui.secondaryLabel],
                ["barcodeLabel", builderText(interfaceLocale).ui.barcodeLabel],
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
            label={builderText(interfaceLocale).ui.showAppleCardBackContent}
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
                {builderText(interfaceLocale).ui.theseLabelsApplyToTheFieldsSupportedByGoogleWallet}
              </p>
            </div>
          </div>
          <div className="builder-form-grid">
            {(
              [
                ["title", builderText(interfaceLocale).ui.title],
                ["subtitle", builderText(interfaceLocale).ui.subtitle],
                ["detailsLabel", builderText(interfaceLocale).ui.detailsLabel],
                ["barcodeLabel", builderText(interfaceLocale).ui.barcodeLabel],
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
      <FormField label={builderText(interfaceLocale).ui.changeSummary}>
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
        title={builderText(interfaceLocale).ui.finalRewardBehaviorIsFixed}
      >
        {builderText(interfaceLocale).ui.atTheGoalEverySlotRemainsFilledTheGridResetsToEmptyOnlyAfterFinalRewardRedemptionSucceeds}
      </Alert>
    </div>
  );
}

function ReviewSection({
  readiness,
  validation,
  canRunChecks,
  working,
  interfaceLocale,
  onSection,
  onRunChecks,
}: {
  readiness: ReturnType<typeof builderReadiness>;
  validation: ValidationResult | null;
  canRunChecks: boolean;
  working: boolean;
  interfaceLocale: InterfaceLocale;
  onSection: (section: BuilderSection) => void;
  onRunChecks: () => void;
}) {
  const text = builderText(interfaceLocale);
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
            <h3>{builderText(interfaceLocale).ui.readinessChecks}</h3>
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
    </div>
  );
}

function PreviewPanel({
  idPrefix,
  draft,
  interfaceLocale,
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
  interfaceLocale: InterfaceLocale;
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
  const text = builderText(interfaceLocale);
  return (
    <div className="builder-preview-panel">
      <div className="builder-preview-header">
        <div>
          <span className="dashboard-card__label">{text.previewOnly}</span>
          <h2>{text.preview}</h2>
        </div>
        <fieldset className="builder-preview-language">
          <legend className="wf-sr-only">{text.ui.previewLanguage}</legend>
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
              const logicalForward = directionForInterface(interfaceLocale) === "rtl" ? -1 : 1;
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
            {previewLabel(item, interfaceLocale)}
          </button>
        ))}
      </div>
      <p className="builder-preview-provider-note">{text.walletPreviewNote}</p>
      <div
        id={`${idPrefix}-panel`}
        dir={directionFor(previewContentLocales[previewLocale])}
        lang={previewContentLocales[previewLocale]}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-${profile}`}
        aria-busy={previewLoading}
        className={`builder-preview-canvas builder-preview-canvas--${profile.toLocaleLowerCase("en-US")} ${preview ? "builder-preview-canvas--ready" : "builder-preview-canvas--empty"}`}
      >
        {preview ? (
          <Image
            src={previewSource(preview.svg)}
            alt={`${previewLabel(profile, interfaceLocale)} ${text.previewOnly}`}
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
            <strong>{previewLabel(profile, interfaceLocale)}</strong>
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
