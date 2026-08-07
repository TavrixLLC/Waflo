"use client";

import { planCatalog } from "@waflo/billing";
import type { Locale, ProgramOperationalStatus } from "@waflo/contracts";
import { formatDate } from "@waflo/i18n";
import { Alert, AlertDialog, Badge, Button, Card, DropdownMenu, PageHeader } from "@waflo/ui";
import {
  Archive,
  ArrowRight,
  CreditCard,
  Ellipsis,
  Layers3,
  Pause,
  Play,
  Plus,
  RotateCcw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError, apiFetch } from "../lib/api-client";
import type { MembershipView } from "./dashboard";
import {
  type MerchantProgramLifecycleAction,
  merchantProgramLifecycleLabel,
  merchantProgramStatus,
} from "./loyalty-card-presentation";
import { ProgramCardBuilder } from "./program-card-builder";
import { applyBuilderTemplate, createBuilderDraft } from "./program-card-builder-state";
import { ProgramQuickWizard } from "./program-quick-wizard";
import { ProgramStudioEditor } from "./program-studio-editor";
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

const emptyStateStampSlots = [true, true, true, false, false] as const;

type CardLifecycleAction = Exclude<MerchantProgramLifecycleAction, "publish" | "abandon">;

const loyaltyCardCopy = {
  en: {
    eyebrow: "LOYALTY CARDS",
    title: "Loyalty cards",
    description:
      "Create and manage customer-ready loyalty cards for the web, with Wallet availability when supported.",
    create: "Create loyalty card",
    summaryLabel: "Loyalty card summary",
    yourCards: "Your cards",
    plan: "Plan",
    cardSingular: "loyalty card",
    cardPlural: "loyalty cards",
    activeCardSingular: "active card included",
    activeCardPlural: "active cards included",
    noFixedLimit: "No fixed active-card limit",
    currentPlan: "Current workspace plan",
    emptyTitle: "Create your first loyalty card",
    emptyDescription:
      "Choose a design, customize your reward, test the customer experience, and publish when you’re ready.",
    loading: "Loading loyalty cards…",
    loadError:
      "Loyalty cards could not be loaded. Your cards were not changed. Reload and try again.",
    libraryTitle: "Your loyalty cards",
    libraryDescription: "Open a card to review its setup, test it, or prepare the next update.",
    visualSummary: "Design available in Studio",
    updated: "Updated",
    published: "Published",
    open: "Open card",
    loadMore: "Load more loyalty cards",
    loadMoreAssets: "Load more design assets",
    draftOnly: "Finish setup, test the customer experience, then publish this card.",
    unpublishedChanges: "Unpublished changes are safely separate from the live card.",
    live: "Live for customers. Create a draft when you’re ready to make changes.",
    paused: "This card is paused and is not currently live for customers.",
    archived: "This card is archived. Its setup and history remain preserved.",
    suspended: "This card is suspended. Contact support before publishing changes.",
    scheduled: "This card is scheduled, but scheduled publishing is not available yet.",
    readyToTest: "The setup is ready for customer-experience testing.",
    testing: "Customer-experience testing is in progress.",
    moreActions: "More actions",
    confirm: "Confirm",
    cancel: "Cancel",
    working: "Working…",
    lifecycleError:
      "The loyalty card status could not be updated. Its current status is unchanged. Try again.",
    lifecycleDescriptions: {
      pause: "The card will stop being live for customers until you resume it.",
      resume: "The card will become live for customers again.",
      archive: "The card will be archived while its setup and version history remain preserved.",
      restore: "The card will return to its preserved state.",
    },
  },
  ar: {
    eyebrow: "بطاقات الولاء",
    title: "بطاقات الولاء",
    description:
      "أنشئ وأدر بطاقات ولاء جاهزة للعملاء على الويب، مع توفر المحافظ الرقمية عند دعمها.",
    create: "إنشاء بطاقة ولاء",
    summaryLabel: "ملخص بطاقات الولاء",
    yourCards: "بطاقاتك",
    plan: "الخطة",
    cardSingular: "بطاقة ولاء",
    cardPlural: "بطاقات ولاء",
    activeCardSingular: "بطاقة نشطة مشمولة",
    activeCardPlural: "بطاقات نشطة مشمولة",
    noFixedLimit: "بلا حد ثابت للبطاقات النشطة",
    currentPlan: "خطة مساحة العمل الحالية",
    emptyTitle: "أنشئ أول بطاقة ولاء",
    emptyDescription:
      "اختر تصميمًا، وخصّص المكافأة، واختبر تجربة العميل، ثم انشر البطاقة عندما تصبح جاهزة.",
    loading: "جارٍ تحميل بطاقات الولاء…",
    loadError: "تعذر تحميل بطاقات الولاء. لم تتغير بطاقاتك. أعد تحميل الصفحة وحاول مرة أخرى.",
    libraryTitle: "بطاقات الولاء الخاصة بك",
    libraryDescription: "افتح أي بطاقة لمراجعة إعداداتها أو اختبارها أو تحضير التحديث التالي.",
    visualSummary: "التصميم متاح في الاستوديو",
    updated: "آخر تحديث",
    published: "نُشرت في",
    open: "فتح البطاقة",
    loadMore: "تحميل المزيد من بطاقات الولاء",
    loadMoreAssets: "تحميل المزيد من أصول التصميم",
    draftOnly: "أكمل الإعداد، واختبر تجربة العميل، ثم انشر هذه البطاقة.",
    unpublishedChanges: "التغييرات غير المنشورة منفصلة بأمان عن البطاقة المباشرة.",
    live: "البطاقة مباشرة للعملاء. أنشئ مسودة عندما تصبح مستعدًا لإجراء تغييرات.",
    paused: "هذه البطاقة متوقفة مؤقتًا وليست مباشرة للعملاء حاليًا.",
    archived: "هذه البطاقة مؤرشفة، مع الاحتفاظ بإعداداتها وسجلها.",
    suspended: "هذه البطاقة موقوفة. تواصل مع الدعم قبل نشر أي تغييرات.",
    scheduled: "هذه البطاقة مجدولة، لكن النشر المجدول غير متاح بعد.",
    readyToTest: "أصبحت الإعدادات جاهزة لاختبار تجربة العميل.",
    testing: "يجري الآن اختبار تجربة العميل.",
    moreActions: "المزيد من الإجراءات",
    confirm: "تأكيد",
    cancel: "إلغاء",
    working: "جارٍ التنفيذ…",
    lifecycleError: "تعذر تحديث حالة بطاقة الولاء. حالتها الحالية لم تتغير. حاول مرة أخرى.",
    lifecycleDescriptions: {
      pause: "ستتوقف البطاقة عن الظهور مباشرة للعملاء حتى تستأنفها.",
      resume: "ستعود البطاقة مباشرة للعملاء.",
      archive: "ستُؤرشف البطاقة مع الاحتفاظ بإعداداتها وسجل إصداراتها.",
      restore: "ستعود البطاقة إلى حالتها المحفوظة.",
    },
  },
} as const;

function builderFlowError(error: unknown, locale: Locale): string {
  const ar = locale === "ar";
  if (!(error instanceof ApiClientError))
    return ar
      ? "تعذر بدء إعداد بطاقة الولاء. حاول مرة أخرى."
      : "Waflo could not start this loyalty card. Try again.";
  if (error.code === "PROGRAM_LIMIT_REACHED")
    return ar
      ? "وصلت إلى حد بطاقات الولاء النشطة في خطتك. أرشف بطاقة حالية أو غيّر الخطة للمتابعة."
      : "You have reached your plan's active loyalty-card limit. Archive a card or change plan to continue.";
  if (error.code === "PROGRAM_LOCATION_INVALID")
    return ar
      ? "أضف موقعًا نشطًا قبل إنشاء بطاقة ولاء."
      : "Add an active location before creating a loyalty card.";
  if (error.code === "PROGRAM_PRO_MODE_UNAVAILABLE" || error.code.includes("LAYOUT_UNAVAILABLE"))
    return ar
      ? "يتطلب هذا التصميم خطة Growth أو Scale. اختر تصميمًا آخر أو غيّر الخطة."
      : "This design requires Growth or Scale. Choose another design or change plan.";
  if (error.code.includes("TEMPLATE"))
    return ar
      ? "لم يعد هذا التصميم متاحًا. اختر تصميمًا آخر."
      : "That design is no longer available. Choose another design.";
  return ar
    ? "تعذر بدء إعداد بطاقة الولاء. حاول مرة أخرى."
    : "Waflo could not start this loyalty card. Try again.";
}

function cardStateDescription(program: ProgramItem, locale: Locale): string {
  const copy = loyaltyCardCopy[locale];

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
  locale,
  membership,
  view = "library",
  legacyCreate = false,
  builderProgramId,
  changeProgramId,
}: {
  locale: Locale;
  membership: MembershipView;
  view?: "library" | "gallery" | "builder";
  legacyCreate?: boolean;
  builderProgramId?: string;
  changeProgramId?: string;
}) {
  const router = useRouter();
  const ar = locale === "ar";
  const copy = loyaltyCardCopy[locale];
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
  const [studioProgramId, setStudioProgramId] = useState<string | null>(null);
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
        router.push(`/${locale}/dashboard/programs/${changeProgramId}/edit`);
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
      router.push(`/${locale}/dashboard/programs/${created.id}/edit`);
    } catch (caught) {
      setBuilderError(builderFlowError(caught, locale));
    } finally {
      builderRequestRef.current = false;
      setCreatingBuilder(false);
    }
  }

  if (studioProgramId) {
    return (
      <ProgramStudioEditor
        organizationId={organizationId}
        programId={studioProgramId}
        plan={membership.organization.selectedPlan}
        locations={locations}
        assets={assets}
        onAssetUploaded={(asset) =>
          setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)])
        }
        ar={ar}
        builderHandoff={view === "builder" && studioProgramId === builderProgramId}
        onClose={() => {
          setStudioProgramId(null);
          if (view === "gallery") router.replace(`/${locale}/dashboard/programs`);
        }}
        onEditDesign={() => {
          const programId = studioProgramId;
          setStudioProgramId(null);
          router.push(`/${locale}/dashboard/programs/${programId}/edit`);
        }}
        onOpenCustomers={() => router.push(`/${locale}/dashboard/customers`)}
        onOpenBilling={() => router.push(`/${locale}/dashboard/billing`)}
        onChanged={load}
      />
    );
  }

  if (view === "builder" && builderProgramId) {
    return (
      <ProgramCardBuilder
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
        onBack={() => router.push(`/${locale}/dashboard/programs`)}
        onChangeDesign={() =>
          router.push(`/${locale}/dashboard/programs/new?changeFor=${builderProgramId}`)
        }
        onOpenStudio={() => setStudioProgramId(builderProgramId)}
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
        setStudioProgramId(programId);
        void load();
      }}
      ar={ar}
    />
  );

  if (view === "gallery") {
    return (
      <TemplateGallery
        locale={locale}
        templates={templates}
        businessCategory={businessCategory}
        loading={loading}
        error={builderError || error}
        selectionPending={creatingBuilder}
        onBack={() =>
          router.push(
            changeProgramId
              ? `/${locale}/dashboard/programs/${changeProgramId}/edit`
              : `/${locale}/dashboard/programs`,
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
      dir={ar ? "rtl" : "ltr"}
    >
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
        actions={
          <Button
            type="button"
            className="programs-home__header-action"
            onClick={() => router.push(`/${locale}/dashboard/programs/new`)}
          >
            <Plus size={17} aria-hidden="true" />
            {copy.create}
          </Button>
        }
      />

      {error ? <Alert tone="danger" title={error} /> : null}

      <section className="programs-home__summary" aria-label={copy.summaryLabel}>
        <Card className="loyalty-card-summary loyalty-card-summary--count">
          <span className="dashboard-card__label">{copy.yourCards}</span>
          <div className="loyalty-card-summary__value">
            <strong>{displayedCardCount}</strong>
            <span>{cardCountNoun}</span>
          </div>
          <small>{planCapacity}</small>
        </Card>
        <Card className="loyalty-card-summary loyalty-card-summary--plan">
          <span className="dashboard-card__label">{copy.plan}</span>
          <strong translate="no">{plan.name}</strong>
          <small>{planInclusion}</small>
        </Card>
      </section>

      {loading ? (
        <Card className="programs-home__loading" role="status">
          <Layers3 size={24} aria-hidden="true" />
          {copy.loading}
        </Card>
      ) : programs.length === 0 ? (
        <section className="wf-card loyalty-card-empty" aria-labelledby="loyalty-card-empty-title">
          <div className="loyalty-card-empty__preview" aria-hidden="true">
            <div className="loyalty-card-visual__brand">
              <span>W</span>
              <CreditCard size={22} />
            </div>
            <div className="loyalty-card-visual__stamps">
              {emptyStateStampSlots.map((filled, index) => (
                <span
                  className={filled ? "loyalty-card-visual__stamp--filled" : ""}
                  key={`empty-card-stamp-${index.toString()}`}
                />
              ))}
            </div>
          </div>
          <div className="loyalty-card-empty__content">
            <h2 id="loyalty-card-empty-title">{copy.emptyTitle}</h2>
            <p>{copy.emptyDescription}</p>
            <Button
              type="button"
              className="loyalty-card-empty__mobile-action"
              onClick={() => router.push(`/${locale}/dashboard/programs/new`)}
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
              const status = merchantProgramStatus(program.status, locale);
              const lifecycleActions = cardLifecycleActions(program.status);
              const relevantDate =
                program.currentDraftVersion || !program.currentPublishedVersion
                  ? program.updatedAt
                  : (program.currentPublishedVersion.publishedAt ?? program.updatedAt);
              const dateLabel =
                program.currentDraftVersion || !program.currentPublishedVersion
                  ? copy.updated
                  : copy.published;

              return (
                <article className="wf-card program-list__card" key={program.id}>
                  <div
                    className="loyalty-card-visual loyalty-card-visual--summary"
                    role="img"
                    aria-label={`${copy.visualSummary}: ${program.internalName}`}
                  >
                    <div className="loyalty-card-visual__brand">
                      <span>{program.internalName.charAt(0).toLocaleUpperCase(locale)}</span>
                      <Layers3 size={22} aria-hidden="true" />
                    </div>
                    <div className="loyalty-card-visual__summary-copy">
                      <small>{copy.visualSummary}</small>
                      <strong>{program.internalName}</strong>
                    </div>
                  </div>
                  <div className="program-list__content">
                    <div className="program-list__heading">
                      <h3>{program.internalName}</h3>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <p>{cardStateDescription(program, locale)}</p>
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
                              {merchantProgramLifecycleLabel(action, locale)}
                            </button>
                          ))}
                        </DropdownMenu>
                        <Button
                          type="button"
                          aria-label={`${copy.open}: ${program.internalName}`}
                          onClick={() => setStudioProgramId(program.id)}
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
            ? merchantProgramLifecycleLabel(lifecycleConfirmation.action, locale)
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
