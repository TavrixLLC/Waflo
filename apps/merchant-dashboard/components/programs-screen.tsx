"use client";

import { planCatalog } from "@waflo/billing";
import type { Locale, ProgramOperationalStatus } from "@waflo/contracts";
import {
  directionForInterface,
  formatDate,
  localeRegistry,
  type InterfaceLocale,
} from "@waflo/i18n";
import { Alert, AlertDialog, Badge, Button, DropdownMenu, PageHeader } from "@waflo/ui";
import { Archive, ArrowRight, Ellipsis, Layers3, Pause, Play, Plus, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError, apiFetch } from "../lib/api-client";
import type { MembershipView } from "./dashboard";
import {
  type MerchantProgramLifecycleAction,
  merchantProgramLifecycleLabel,
  merchantProgramStatus,
} from "./loyalty-card-presentation";
import { LoyaltyCardRealPreview } from "./loyalty-card-real-preview";
import { ProgramCardBuilder } from "./program-card-builder";
import { applyBuilderTemplate, createBuilderDraft } from "./program-card-builder-state";
import { ProgramQuickWizard } from "./program-quick-wizard";
import { ProgramStudioEditor } from "./program-studio-editor";
import type { StudioArea } from "./program-studio-presentation";
import type {
  AssetItem,
  LocationItem,
  PreviewProfile,
  ProgramDetail,
  ProgramItem,
  ProgramVersion,
  TemplateGalleryPreview,
  TemplateItem,
} from "./program-studio-types";
import { apiDraft, versionToDraft } from "./program-studio-types";
import { TemplateGallery } from "./template-gallery";

interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

interface OrganizationPresentationView {
  businessCategory: string | null;
}

const planCodes = {
  STARTER: "starter",
  GROWTH: "growth",
  SCALE: "scale",
} as const;

type CardLifecycleAction = Exclude<MerchantProgramLifecycleAction, "publish" | "abandon">;

function programsText(locale: InterfaceLocale) {
  return localeRegistry[locale].messages.merchant.loyalty.programs;
}

function builderFlowError(error: unknown, interfaceLocale: InterfaceLocale): string {
  const copy = programsText(interfaceLocale);
  if (!(error instanceof ApiClientError)) return copy.couldNotStart;
  if (error.code === "PROGRAM_LIMIT_REACHED") return copy.limitReached;
  if (error.code === "PROGRAM_LOCATION_INVALID") return copy.locationRequired;
  if (error.code === "PROGRAM_PRO_MODE_UNAVAILABLE" || error.code.includes("LAYOUT_UNAVAILABLE")) {
    return copy.planRequired;
  }
  if (error.code.includes("TEMPLATE")) return copy.templateUnavailable;
  return copy.couldNotStart;
}
function cardStateDescription(program: ProgramItem, interfaceLocale: InterfaceLocale): string {
  const copy = programsText(interfaceLocale);

  if (program.status === "SUSPENDED") return copy.suspended;
  if (program.status === "ARCHIVED") return copy.archived;
  if (program.status === "PAUSED") return copy.paused;
  if (program.status === "SCHEDULED") return copy.scheduled;
  if (program.currentPublishedVersion && program.currentDraftVersion)
    return copy.unpublishedChanges;
  if (program.status === "PUBLISHED") return copy.live;
  if (program.status === "VALIDATED") return copy.readyToTest;
  if (program.status === "TEST") return copy.testing;
  return copy.draftOnly;
}

function cardLifecycleActions(status: ProgramOperationalStatus): CardLifecycleAction[] {
  if (status === "ARCHIVED") return ["restore"];

  const actions: CardLifecycleAction[] = [];
  if (status === "PUBLISHED") actions.push("pause");
  if (status === "PAUSED") actions.push("resume");
  actions.push("archive");
  return actions;
}

export function ProgramsScreen({
  interfaceLocale,
  locale,
  membership,
  view = "library",
  legacyCreate = false,
  builderProgramId,
  studioProgramId: routedStudioProgramId,
  studioArea = "overview",
  changeProgramId,
}: {
  interfaceLocale: InterfaceLocale;
  locale: Locale;
  membership: MembershipView;
  view?: "library" | "gallery" | "builder" | "studio";
  legacyCreate?: boolean;
  builderProgramId?: string;
  studioProgramId?: string;
  studioArea?: StudioArea;
  changeProgramId?: string;
}) {
  const router = useRouter();
  const interfaceDirection = directionForInterface(interfaceLocale);
  const ar = locale === "ar";
  const copy = programsText(interfaceLocale);
  const organizationId = membership.organization.id;
  const [programs, setPrograms] = useState<ProgramItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [programCursor, setProgramCursor] = useState<string | null>(null);
  const [assetCursor, setAssetCursor] = useState<string | null>(null);
  const [businessCategory, setBusinessCategory] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(legacyCreate);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null);
  const [studioProgramId, setStudioProgramId] = useState<string | null>(
    routedStudioProgramId ?? null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [builderError, setBuilderError] = useState("");
  const [creatingBuilder, setCreatingBuilder] = useState(false);
  const builderRequestRef = useRef(false);
  const initialLoadKeyRef = useRef("");
  const [lifecycleConfirmation, setLifecycleConfirmation] = useState<{
    action: CardLifecycleAction;
    programId: string;
  } | null>(null);
  const [lifecycleWorking, setLifecycleWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (view === "builder") {
        const [templateData, locationData, assetData] = await Promise.all([
          apiFetch<TemplateItem[]>(
            `/v1/organizations/${organizationId}/programs/templates?locale=${ar ? "AR" : "EN"}`,
          ),
          apiFetch<{ items: LocationItem[] } | LocationItem[]>(
            `/v1/organizations/${organizationId}/locations`,
          ),
          apiFetch<CursorPage<AssetItem>>(`/v1/organizations/${organizationId}/assets?limit=30`),
        ]);
        setTemplates(templateData);
        setLocations(Array.isArray(locationData) ? locationData : locationData.items);
        setAssets(assetData.items);
        setAssetCursor(assetData.nextCursor);
        return;
      }

      const [programData, templateData, locationData, assetData, organizationData] =
        await Promise.all([
          apiFetch<CursorPage<ProgramItem>>(
            `/v1/organizations/${organizationId}/programs?limit=20`,
          ),
          apiFetch<TemplateItem[]>(
            `/v1/organizations/${organizationId}/programs/templates?locale=${ar ? "AR" : "EN"}`,
          ),
          apiFetch<{ items: LocationItem[] } | LocationItem[]>(
            `/v1/organizations/${organizationId}/locations`,
          ),
          apiFetch<CursorPage<AssetItem>>(`/v1/organizations/${organizationId}/assets?limit=30`),
          apiFetch<OrganizationPresentationView>(`/v1/organizations/${organizationId}`),
        ]);
      setPrograms(programData.items);
      setProgramCursor(programData.nextCursor);
      setTemplates(templateData);
      setLocations(Array.isArray(locationData) ? locationData : locationData.items);
      setAssets(assetData.items);
      setAssetCursor(assetData.nextCursor);
      setBusinessCategory(organizationData.businessCategory);
    } catch {
      setError(copy.loadError);
    } finally {
      setLoading(false);
    }
  }, [ar, copy.loadError, organizationId, view]);

  useEffect(() => {
    const key = `${view}:${organizationId}:${ar ? "AR" : "EN"}`;
    if (initialLoadKeyRef.current === key) return;
    initialLoadKeyRef.current = key;
    void load();
  }, [ar, load, organizationId, view]);

  useEffect(() => {
    if (legacyCreate) setWizardOpen(true);
  }, [legacyCreate]);

  useEffect(() => {
    setStudioProgramId(routedStudioProgramId ?? null);
  }, [routedStudioProgramId]);

  async function loadMorePrograms() {
    if (!programCursor) return;
    const page = await apiFetch<CursorPage<ProgramItem>>(
      `/v1/organizations/${organizationId}/programs?limit=20&cursor=${encodeURIComponent(programCursor)}`,
    );
    setPrograms((current) => [
      ...current,
      ...page.items.filter((item) => !current.some((existing) => existing.id === item.id)),
    ]);
    setProgramCursor(page.nextCursor);
  }

  async function loadMoreAssets() {
    if (!assetCursor) return;
    const page = await apiFetch<CursorPage<AssetItem>>(
      `/v1/organizations/${organizationId}/assets?limit=30&cursor=${encodeURIComponent(assetCursor)}`,
    );
    setAssets((current) => [
      ...current,
      ...page.items.filter((item) => !current.some((existing) => existing.id === item.id)),
    ]);
    setAssetCursor(page.nextCursor);
  }

  async function runCardLifecycle() {
    if (!lifecycleConfirmation || lifecycleWorking) return;

    setLifecycleWorking(true);
    setError("");
    try {
      await apiFetch(
        `/v1/organizations/${organizationId}/programs/${lifecycleConfirmation.programId}/${lifecycleConfirmation.action}`,
        { method: "POST" },
      );
      setLifecycleConfirmation(null);
      await load();
    } catch {
      setLifecycleConfirmation(null);
      setError(copy.lifecycleError);
    } finally {
      setLifecycleWorking(false);
    }
  }

  const plan = planCatalog[planCodes[membership.organization.selectedPlan]];
  const activeCardCount = programs.filter((program) => program.status !== "ARCHIVED").length;
  const countIsExact = programCursor === null;
  const activeLimit = plan.limits.programs;

  async function handleUseTemplate(
    template: TemplateItem,
    options: { blank: boolean },
  ): Promise<void> {
    if (builderRequestRef.current) return;
    builderRequestRef.current = true;
    setCreatingBuilder(true);
    setBuilderError("");
    try {
      if (changeProgramId) {
        const program = await apiFetch<ProgramDetail>(
          `/v1/organizations/${organizationId}/programs/${changeProgramId}`,
        );
        if (!program.currentDraftVersion)
          throw new Error("The selected loyalty card has no editable draft.");
        const current = versionToDraft(program, program.currentDraftVersion);
        const next = applyBuilderTemplate(template, current, options);
        await apiFetch<{ currentDraftVersion: ProgramVersion }>(
          `/v1/organizations/${organizationId}/programs/${changeProgramId}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              ...apiDraft(next),
              revision: program.currentDraftVersion.revision,
            }),
          },
        );
        await load();
        router.push(`/${interfaceLocale}/dashboard/programs/${changeProgramId}/edit`);
        return;
      }

      if (activeLimit !== null && countIsExact && activeCardCount >= activeLimit) {
        throw new ApiClientError(
          "PROGRAM_LIMIT_REACHED",
          "The active loyalty-card limit has been reached.",
        );
      }
      const activeLocations = locations.filter((location) => location.status === "ACTIVE");
      if (activeLocations.length === 0) {
        throw new ApiClientError("PROGRAM_LOCATION_INVALID", "An active location is required.");
      }
      const draft = createBuilderDraft(template, activeLocations, {
        locale,
        blank: options.blank,
      });
      const created = await apiFetch<ProgramItem>(`/v1/organizations/${organizationId}/programs`, {
        method: "POST",
        body: JSON.stringify(apiDraft(draft)),
      });
      await load();
      router.push(`/${interfaceLocale}/dashboard/programs/${created.id}/edit`);
    } catch (caught) {
      setBuilderError(builderFlowError(caught, interfaceLocale));
    } finally {
      builderRequestRef.current = false;
      setCreatingBuilder(false);
    }
  }

  if (studioProgramId) {
    return (
      <ProgramStudioEditor
        interfaceLocale={interfaceLocale}
        organizationId={organizationId}
        programId={studioProgramId}
        plan={membership.organization.selectedPlan}
        locations={locations}
        assets={assets}
        onAssetUploaded={(asset) =>
          setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)])
        }
        ar={ar}
        canManageEngagement={membership.role !== "STAFF"}
        initialArea={studioArea}
        onAreaChange={(area, options) => {
          const targetPath = `/${interfaceLocale}/dashboard/programs/${studioProgramId}${
            area === "overview" ? "" : `/${area}`
          }`;
          router.push(targetPath);
          if (options?.restoreFocus) {
            let remainingFrames = 60;
            const restoreFocus = () => {
              const trigger = document.querySelector<HTMLButtonElement>(
                `.studio-mobile-navigation > button[data-studio-area="${area}"]`,
              );
              if (window.location.pathname === targetPath && trigger) {
                trigger.focus();
                return;
              }
              remainingFrames -= 1;
              if (remainingFrames > 0) window.requestAnimationFrame(restoreFocus);
            };
            window.requestAnimationFrame(restoreFocus);
          }
        }}
        builderHandoff={view === "builder" && studioProgramId === builderProgramId}
        onClose={() => {
          setStudioProgramId(null);
          router.push(`/${interfaceLocale}/dashboard/programs`);
        }}
        onEditDesign={() => {
          const programId = studioProgramId;
          setStudioProgramId(null);
          router.push(`/${interfaceLocale}/dashboard/programs/${programId}/edit`);
        }}
        onOpenCustomers={() => router.push(`/${interfaceLocale}/dashboard/customers`)}
        onOpenBilling={() => router.push(`/${interfaceLocale}/dashboard/billing`)}
        onChanged={load}
      />
    );
  }

  if (view === "builder" && builderProgramId) {
    return (
      <ProgramCardBuilder
        interfaceLocale={interfaceLocale}
        organizationId={organizationId}
        programId={builderProgramId}
        plan={membership.organization.selectedPlan}
        templates={templates}
        locations={locations}
        assets={assets}
        onAssetUploaded={(asset) =>
          setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)])
        }
        locale={locale}
        onBack={() => router.push(`/${interfaceLocale}/dashboard/programs`)}
        onChangeDesign={() =>
          router.push(`/${interfaceLocale}/dashboard/programs/new?changeFor=${builderProgramId}`)
        }
        onOpenStudio={() =>
          router.push(`/${interfaceLocale}/dashboard/programs/${builderProgramId}`)
        }
        onChanged={load}
      />
    );
  }

  const displayedCardCount = countIsExact ? programs.length.toString() : `${programs.length}+`;
  const cardCountNoun = programs.length === 1 ? copy.cardSingular : copy.cardPlural;
  const planCapacity =
    activeLimit === null
      ? copy.noFixedLimit
      : countIsExact
        ? ar
          ? `${activeCardCount} من ${activeLimit} ضمن خطة ${plan.name}`
          : `${activeCardCount} of ${activeLimit} on ${plan.name}`
        : ar
          ? `حد الخطة: ${activeLimit} بطاقة نشطة ضمن ${plan.name}`
          : `${activeLimit}-card active limit on ${plan.name}`;
  const planInclusion =
    activeLimit === null
      ? copy.currentPlan
      : `${activeLimit} ${activeLimit === 1 ? copy.activeCardSingular : copy.activeCardPlural}`;
  const empty = !loading && programs.length === 0;
  const wizard = (
    <ProgramQuickWizard
      open={wizardOpen}
      onClose={() => {
        setWizardOpen(false);
        setSelectedTemplate(null);
      }}
      organizationId={organizationId}
      plan={membership.organization.selectedPlan}
      templates={templates}
      locations={locations}
      assets={assets}
      initialTemplate={selectedTemplate}
      {...(selectedTemplate
        ? {
            onBackToGallery: () => {
              setWizardOpen(false);
              setSelectedTemplate(null);
            },
          }
        : {})}
      onAssetUploaded={(asset) =>
        setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)])
      }
      onCreated={(programId) => {
        setWizardOpen(false);
        setSelectedTemplate(null);
        router.push(`/${interfaceLocale}/dashboard/programs/${programId}`);
        void load();
      }}
      ar={ar}
    />
  );

  if (view === "gallery") {
    return (
      <TemplateGallery
        interfaceLocale={interfaceLocale}
        locale={locale}
        templates={templates}
        businessCategory={businessCategory}
        loading={loading}
        error={builderError || error}
        selectionPending={creatingBuilder}
        onBack={() =>
          router.push(
            changeProgramId
              ? `/${interfaceLocale}/dashboard/programs/${changeProgramId}/edit`
              : `/${interfaceLocale}/dashboard/programs`,
          )
        }
        onLoadPreviews={(template, presentation) =>
          apiFetch<Record<PreviewProfile, TemplateGalleryPreview>>(
            `/v1/organizations/${organizationId}/programs/templates/${encodeURIComponent(template.code)}/previews?version=${template.version}&locale=${ar ? "AR" : "EN"}&presentation=${presentation}`,
          )
        }
        onUseTemplate={(template, options) => void handleUseTemplate(template, options)}
      />
    );
  }

  return (
    <div
      className={`programs-home ${empty ? "programs-home--empty" : ""}`}
      dir={interfaceDirection}
    >
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Button
            type="button"
            className="programs-home__header-action"
            onClick={() => router.push(`/${interfaceLocale}/dashboard/programs/new`)}
          >
            <Plus size={17} aria-hidden="true" />
            {copy.create}
          </Button>
        }
      />

      {error ? <Alert tone="danger" title={error} /> : null}

      <section className="programs-home__summary" aria-label={copy.summaryLabel}>
        <div className="loyalty-card-summary loyalty-card-summary--count">
          <span className="dashboard-card__label">{copy.yourCards}</span>
          <div className="loyalty-card-summary__value">
            <strong>{displayedCardCount}</strong>
            <span>{cardCountNoun}</span>
          </div>
          <small>{planCapacity}</small>
        </div>
        <div className="loyalty-card-summary loyalty-card-summary--plan">
          <span className="dashboard-card__label">{copy.plan}</span>
          <strong translate="no">{plan.name}</strong>
          <small>{planInclusion}</small>
        </div>
      </section>

      {loading ? (
        <div className="programs-home__loading" role="status">
          <Layers3 size={24} aria-hidden="true" />
          {copy.loading}
        </div>
      ) : programs.length === 0 ? (
        <section className="loyalty-card-empty" aria-labelledby="loyalty-card-empty-title">
          <div className="loyalty-card-empty__content">
            <h2 id="loyalty-card-empty-title">{copy.emptyTitle}</h2>
            <p>{copy.emptyDescription}</p>
            <Button
              type="button"
              className="loyalty-card-empty__mobile-action"
              onClick={() => router.push(`/${interfaceLocale}/dashboard/programs/new`)}
            >
              <Plus size={17} aria-hidden="true" />
              {copy.create}
            </Button>
          </div>
        </section>
      ) : (
        <section className="loyalty-card-library" aria-labelledby="loyalty-card-library-title">
          <div className="loyalty-card-library__heading">
            <div>
              <h2 id="loyalty-card-library-title">{copy.libraryTitle}</h2>
              <p>{copy.libraryDescription}</p>
            </div>
          </div>
          <div className="program-list">
            {programs.map((program) => {
              const status = merchantProgramStatus(program.status, interfaceLocale);
              const lifecycleActions = cardLifecycleActions(program.status);
              const relevantDate =
                program.currentDraftVersion || !program.currentPublishedVersion
                  ? program.updatedAt
                  : (program.currentPublishedVersion.publishedAt ?? program.updatedAt);
              const dateLabel =
                program.currentDraftVersion || !program.currentPublishedVersion
                  ? copy.updated
                  : copy.published;
              const version = program.currentDraftVersion ?? program.currentPublishedVersion;
              const theme = version?.visualTheme;
              const translation = version?.translations?.find(
                (item) => item.locale === (ar ? "AR" : "EN"),
              );

              return (
                <article className="wf-card program-list__card" key={program.id}>
                  <LoyaltyCardRealPreview
                    programName={translation?.programName ?? program.internalName}
                    internalName={program.internalName}
                    requiredStampCount={version?.stampRule?.requiredStampCount ?? 8}
                    rewardSummary={translation?.rewardSummary ?? copy.visualSummary}
                    visualTheme={theme}
                    locale={locale}
                  />
                  <div className="program-list__content">
                    <div className="program-list__heading">
                      <h3>{program.internalName}</h3>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <p>{cardStateDescription(program, interfaceLocale)}</p>
                    <div className="program-list__footer">
                      {relevantDate ? (
                        <span>
                          {dateLabel}{" "}
                          <time dateTime={relevantDate}>{formatDate(relevantDate, locale)}</time>
                        </span>
                      ) : (
                        <span />
                      )}
                      <div className="program-list__actions">
                        <DropdownMenu
                          label={
                            <span className="program-list__menu-trigger">
                              <Ellipsis size={20} aria-hidden="true" />
                              <span className="wf-sr-only">
                                {copy.moreActions}: {program.internalName}
                              </span>
                            </span>
                          }
                        >
                          {lifecycleActions.map((action) => (
                            <button
                              className={`program-list__menu-action${
                                action === "archive" ? " program-list__menu-action--danger" : ""
                              }`}
                              key={action}
                              type="button"
                              onClick={() =>
                                setLifecycleConfirmation({
                                  action,
                                  programId: program.id,
                                })
                              }
                            >
                              {action === "pause" ? <Pause size={17} aria-hidden="true" /> : null}
                              {action === "resume" ? <Play size={17} aria-hidden="true" /> : null}
                              {action === "archive" ? (
                                <Archive size={17} aria-hidden="true" />
                              ) : null}
                              {action === "restore" ? (
                                <RotateCcw size={17} aria-hidden="true" />
                              ) : null}
                              {merchantProgramLifecycleLabel(action, interfaceLocale)}
                            </button>
                          ))}
                        </DropdownMenu>
                        <Button
                          type="button"
                          aria-label={`${copy.open}: ${program.internalName}`}
                          onClick={() =>
                            router.push(`/${interfaceLocale}/dashboard/programs/${program.id}`)
                          }
                        >
                          {copy.open}
                          <ArrowRight
                            className="loyalty-card-open-icon"
                            size={16}
                            aria-hidden="true"
                          />
                        </Button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {programCursor || assetCursor ? (
        <div className="program-pagination-actions">
          {programCursor ? (
            <Button type="button" variant="secondary" onClick={() => void loadMorePrograms()}>
              {copy.loadMore}
            </Button>
          ) : null}
          {assetCursor ? (
            <Button type="button" variant="secondary" onClick={() => void loadMoreAssets()}>
              {copy.loadMoreAssets}
            </Button>
          ) : null}
        </div>
      ) : null}

      <AlertDialog
        open={Boolean(lifecycleConfirmation)}
        title={
          lifecycleConfirmation
            ? merchantProgramLifecycleLabel(lifecycleConfirmation.action, interfaceLocale)
            : ""
        }
        description={
          lifecycleConfirmation ? copy.lifecycleDescriptions[lifecycleConfirmation.action] : ""
        }
        confirmLabel={lifecycleWorking ? copy.working : copy.confirm}
        cancelLabel={copy.cancel}
        danger={lifecycleConfirmation?.action === "archive"}
        onClose={() => setLifecycleConfirmation(null)}
        onConfirm={() => void runCardLifecycle()}
      />

      {wizard}
    </div>
  );
}
