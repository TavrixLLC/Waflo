"use client";

import type { Locale } from "@waflo/contracts";
import { directionForInterface, localeRegistry, type InterfaceLocale } from "@waflo/i18n";
import { Alert, Button, Modal, PageHeader, TextInput } from "@waflo/ui";
import { ArrowLeft, ArrowRight, Search, Sparkles, X } from "lucide-react";
import Image from "next/image";
import { useId, useMemo, useRef, useState } from "react";
import type { PreviewProfile, TemplateGalleryPreview, TemplateItem } from "./program-studio-types";
import {
  businessRecommendationCategory,
  filterTemplates,
  recommendedTemplates,
  type TemplateGalleryCategory,
  templateCategory,
  templateCategoryLabel,
  templateDisplayName,
  templateGalleryCategories,
  templateStyleLabel,
} from "./template-gallery-presentation";

const previewProfiles = ["CUSTOMER_WEB", "APPLE_WALLET", "GOOGLE_WALLET"] as const;

type TemplatePreviewSet = Record<PreviewProfile, TemplateGalleryPreview>;
type TemplatePresentation = "TEMPLATE" | "BLANK";

interface PreviewSelection {
  template: TemplateItem;
  blank: boolean;
}

interface PreviewRequestState {
  key: string;
  status: "loading" | "error";
}

function previewSource(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function templatesText(locale: InterfaceLocale) {
  return localeRegistry[locale].messages.merchant.loyalty.templates;
}

function previewLabel(profile: PreviewProfile, interfaceLocale: InterfaceLocale): string {
  if (profile === "APPLE_WALLET") return "Apple Wallet";
  if (profile === "GOOGLE_WALLET") return "Google Wallet";
  return templatesText(interfaceLocale).customer;
}

function selectionKey(selection: PreviewSelection, locale: Locale): string {
  return `${selection.template.code}@${selection.template.version}:${selection.blank ? "blank" : "template"}:${locale}`;
}

function TemplateTile({
  template,
  locale,
  interfaceLocale,
  context,
  blank = false,
  onPreview,
}: {
  template: TemplateItem;
  locale: Locale;
  interfaceLocale: InterfaceLocale;
  context: string;
  blank?: boolean;
  onPreview: (selection: PreviewSelection, trigger: HTMLButtonElement) => void;
}) {
  const copy = templatesText(interfaceLocale);
  const title = blank ? copy.blankName : templateDisplayName(template, locale);
  const style = blank ? copy.blankStyle : templateStyleLabel(template, locale);
  const category = blank
    ? copy.blankCategory
    : templateCategoryLabel(templateCategory(template), locale);
  const reward = blank ? copy.blankReward : template.copy[locale].rewardSummary;
  const titleId = useId();
  const customerPreview = blank ? template.blankGalleryThumbnail : template.galleryThumbnail;
  const accessibleContext = `${title}, ${context}`;

  if (!customerPreview) return null;

  return (
    <article
      className={`template-gallery-card${blank ? " template-gallery-card--blank" : ""}`}
      aria-labelledby={titleId}
      data-template-code={blank ? "BLANK" : template.code}
      data-template-role={blank ? "MINIMAL" : template.presentation?.visualRole}
    >
      <button
        type="button"
        className="template-gallery-card__preview"
        aria-label={`${copy.preview}: ${accessibleContext}`}
        onClick={(event) => onPreview({ template, blank }, event.currentTarget)}
      >
        <Image
          src={previewSource(customerPreview.svg)}
          alt=""
          width={customerPreview.width}
          height={customerPreview.height}
          sizes="(max-width: 374px) 100vw, (max-width: 560px) 50vw, (max-width: 900px) 50vw, 33vw"
          unoptimized
        />
        <span className="template-gallery-card__preview-label" aria-hidden="true">
          <Sparkles size={14} aria-hidden="true" />
          <span className="template-gallery-card__preview-label-text">{copy.preview}</span>
        </span>
      </button>
      <div className="template-gallery-card__content">
        <div className="template-gallery-card__taxonomy">
          <span>{category}</span>
          <span aria-hidden="true">·</span>
          <span>{style}</span>
        </div>
        <h3 id={titleId}>{title}</h3>
        <p className="template-gallery-card__summary">
          <span>
            {template.recommendedStampGoal} {copy.stamps}
          </span>
          <span aria-hidden="true">·</span>
          <span>{reward}</span>
        </p>
        <Button
          type="button"
          variant="secondary"
          className="template-gallery-card__action"
          aria-label={`${blank ? copy.blankName : copy.useTemplate}: ${accessibleContext}`}
          onClick={(event) => onPreview({ template, blank }, event.currentTarget)}
        >
          {blank ? copy.blankName : copy.useTemplate}
          <ArrowRight className="template-gallery__logical-arrow" size={16} aria-hidden="true" />
        </Button>
      </div>
    </article>
  );
}

function TemplatePreviewDialog({
  selection,
  previews,
  loading,
  error,
  locale,
  interfaceLocale,
  selectionPending,
  onClose,
  onRetry,
  onUseTemplate,
}: {
  selection: PreviewSelection | null;
  previews: TemplatePreviewSet | undefined;
  loading: boolean;
  error: boolean;
  locale: Locale;
  interfaceLocale: InterfaceLocale;
  selectionPending: boolean;
  onClose: () => void;
  onRetry: () => void;
  onUseTemplate: (template: TemplateItem, options: { blank: boolean }) => void;
}) {
  const copy = templatesText(interfaceLocale);
  const [profile, setProfile] = useState<PreviewProfile>("CUSTOMER_WEB");
  const tabsId = useId();
  if (!selection) return null;

  const { template, blank } = selection;
  const title = blank ? copy.blankName : templateDisplayName(template, locale);
  const description = blank
    ? copy.blankDescription
    : locale === "ar"
      ? template.descriptionAr
      : template.description;
  const category = blank
    ? copy.blankCategory
    : templateCategoryLabel(templateCategory(template), locale);
  const style = blank ? copy.blankStyle : templateStyleLabel(template, locale);
  const selectedPreview = previews?.[profile];
  const activeIndex = previewProfiles.indexOf(profile);

  function selectAdjacentProfile(key: string): void {
    let nextIndex = activeIndex;
    if (key === "Home") nextIndex = 0;
    else if (key === "End") nextIndex = previewProfiles.length - 1;
    else if (key === "ArrowRight")
      nextIndex = activeIndex + (directionForInterface(interfaceLocale) === "rtl" ? -1 : 1);
    else if (key === "ArrowLeft")
      nextIndex = activeIndex + (directionForInterface(interfaceLocale) === "rtl" ? 1 : -1);
    else return;

    const normalized = (nextIndex + previewProfiles.length) % previewProfiles.length;
    const nextProfile = previewProfiles[normalized];
    if (!nextProfile) return;
    setProfile(nextProfile);
    requestAnimationFrame(() => document.getElementById(`${tabsId}-${nextProfile}`)?.focus());
  }

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      closeLabel={copy.closePreview}
      className="template-preview-dialog"
    >
      <div className="template-preview-dialog__intro">
        <span>
          {category} · {style}
        </span>
        <p>{description}</p>
        <p className="template-preview-dialog__facts">
          {template.recommendedStampGoal} {copy.stamps} ·{" "}
          {blank ? copy.blankReward : template.copy[locale].rewardSummary}
        </p>
      </div>
      <div className="template-preview-tabs" role="tablist" aria-label={copy.previewDescription}>
        {previewProfiles.map((item) => (
          <button
            type="button"
            role="tab"
            id={`${tabsId}-${item}`}
            aria-controls={`${tabsId}-panel`}
            aria-selected={profile === item}
            tabIndex={profile === item ? 0 : -1}
            key={item}
            onClick={() => setProfile(item)}
            onKeyDown={(event) => {
              if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                selectAdjacentProfile(event.key);
              }
            }}
          >
            {previewLabel(item, interfaceLocale)}
          </button>
        ))}
      </div>
      <div
        className={`template-preview-dialog__canvas template-preview-dialog__canvas--${profile.toLocaleLowerCase("en-US")}`}
        role="tabpanel"
        id={`${tabsId}-panel`}
        aria-labelledby={`${tabsId}-${profile}`}
        aria-busy={loading}
      >
        {loading ? (
          <div className="template-preview-dialog__loading" role="status">
            <Sparkles size={22} aria-hidden="true" />
            <span>{copy.previewLoading}</span>
          </div>
        ) : selectedPreview ? (
          <Image
            src={previewSource(selectedPreview.svg)}
            alt={`${title} — ${previewLabel(profile, interfaceLocale)} ${copy.previewOnly}`}
            width={selectedPreview.width}
            height={selectedPreview.height}
            unoptimized
            priority
          />
        ) : null}
      </div>
      {error ? (
        <div className="template-preview-dialog__error">
          <Alert tone="danger" title={copy.previewLoadError} />
          <Button type="button" variant="secondary" onClick={onRetry}>
            {copy.retryPreview}
          </Button>
        </div>
      ) : null}
      {selectedPreview?.warnings.map((warning) => (
        <Alert key={warning.code} tone="warning" title={warning.message} />
      ))}
      <div className="wf-dialog__actions template-preview-dialog__actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          {copy.backToTemplates}
        </Button>
        <Button
          type="button"
          disabled={selectionPending}
          onClick={() => onUseTemplate(template, { blank })}
        >
          {selectionPending
            ? locale === "ar"
              ? "جارٍ تجهيز المسودة…"
              : "Preparing draft…"
            : blank
              ? copy.blankName
              : copy.useThisTemplate}
          <ArrowRight className="template-gallery__logical-arrow" size={16} aria-hidden="true" />
        </Button>
      </div>
    </Modal>
  );
}

export function TemplateGallery({
  interfaceLocale,
  locale,
  templates,
  businessCategory,
  loading = false,
  error = "",
  selectionPending = false,
  onBack,
  onLoadPreviews,
  onUseTemplate,
}: {
  interfaceLocale: InterfaceLocale;
  locale: Locale;
  templates: TemplateItem[];
  businessCategory: string | null;
  loading?: boolean;
  error?: string;
  selectionPending?: boolean;
  onBack: () => void;
  onLoadPreviews: (
    template: TemplateItem,
    presentation: TemplatePresentation,
  ) => Promise<TemplatePreviewSet>;
  onUseTemplate: (template: TemplateItem, options: { blank: boolean }) => void;
}) {
  const interfaceDirection = directionForInterface(interfaceLocale);
  const copy = templatesText(interfaceLocale);
  const [selectedCategory, setSelectedCategory] = useState<TemplateGalleryCategory>("all");
  const [query, setQuery] = useState("");
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const [previewCache, setPreviewCache] = useState<Record<string, TemplatePreviewSet>>({});
  const [previewRequest, setPreviewRequest] = useState<PreviewRequestState | null>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const generalTemplate = templates.find((template) => template.code === "GENERAL_VISITS");
  const recommendation = businessRecommendationCategory(businessCategory);
  const recommendations = useMemo(
    () => recommendedTemplates(templates, businessCategory),
    [businessCategory, templates],
  );
  const filteredTemplates = useMemo(
    () => filterTemplates(templates, selectedCategory, query),
    [query, selectedCategory, templates],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase(locale === "ar" ? "ar" : "en-US");
  const blankSearchTerms = Object.values(localeRegistry)
    .map((item) => {
      const text = item.messages.merchant.loyalty.templates;
      return `${text.blankName} ${text.blankSearchAliases} ${text.blankDescription}`;
    })
    .join(" ")
    .toLocaleLowerCase("en-US");
  const showBlank =
    Boolean(generalTemplate?.blankGalleryThumbnail) &&
    (selectedCategory === "all" || selectedCategory === "general") &&
    (!normalizedQuery || blankSearchTerms.includes(normalizedQuery));
  const showRecommendations = selectedCategory === "all" && query.trim() === "";
  const noResults = !loading && !error && filteredTemplates.length === 0 && !showBlank;
  const activePreviewKey = previewSelection ? selectionKey(previewSelection, locale) : "";

  function resetFilters(): void {
    setSelectedCategory("all");
    setQuery("");
  }

  async function loadPreview(
    selection: PreviewSelection,
    force = false,
    trigger?: HTMLButtonElement,
  ): Promise<void> {
    const key = selectionKey(selection, locale);
    if (trigger) previewTriggerRef.current = trigger;
    setPreviewSelection(selection);
    if (!force && previewCache[key]) {
      setPreviewRequest(null);
      return;
    }
    setPreviewRequest({ key, status: "loading" });
    try {
      const previews = await onLoadPreviews(
        selection.template,
        selection.blank ? "BLANK" : "TEMPLATE",
      );
      setPreviewCache((current) => ({ ...current, [key]: previews }));
      setPreviewRequest((current) => (current?.key === key ? null : current));
    } catch {
      setPreviewRequest((current) => (current?.key === key ? { key, status: "error" } : current));
    }
  }

  function closePreview(): void {
    setPreviewSelection(null);
    requestAnimationFrame(() => previewTriggerRef.current?.focus());
  }

  return (
    <div
      className={`template-gallery${loading ? " template-gallery--loading" : ""}${error ? " template-gallery--error" : ""}`}
      dir={interfaceDirection}
    >
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
        actions={
          <Button type="button" variant="secondary" onClick={onBack}>
            <ArrowLeft className="template-gallery__logical-arrow" size={16} aria-hidden="true" />
            {copy.back}
          </Button>
        }
      />

      {loading ? (
        <div className="template-gallery__loading" role="status">
          <Sparkles size={22} aria-hidden="true" />
          <span>{copy.loading}</span>
        </div>
      ) : null}
      {error ? <Alert tone="danger" title={error} /> : null}

      <section className="template-gallery__discovery" aria-label={copy.discoveryLabel}>
        <div className="template-gallery__search">
          <Search size={18} aria-hidden="true" />
          <label className="wf-sr-only" htmlFor="template-gallery-search">
            {copy.searchLabel}
          </label>
          <TextInput
            id="template-gallery-search"
            type="search"
            value={query}
            placeholder={copy.searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button type="button" aria-label={copy.clearSearch} onClick={() => setQuery("")}>
              <X size={17} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <fieldset className="template-gallery__filters">
          <legend className="wf-sr-only">{copy.filtersLabel}</legend>
          {templateGalleryCategories.map((category) => (
            <button
              type="button"
              key={category}
              aria-pressed={selectedCategory === category}
              onClick={() => setSelectedCategory(category)}
            >
              {templateCategoryLabel(category, locale)}
            </button>
          ))}
        </fieldset>
      </section>

      {showRecommendations && recommendations.length > 0 ? (
        <section
          className="template-gallery__section template-gallery__section--recommended"
          aria-labelledby="template-gallery-recommended-title"
        >
          <div className="template-gallery__section-heading">
            <div>
              <span className="template-gallery__section-mark" aria-hidden="true">
                <Sparkles size={15} />
              </span>
              <h2 id="template-gallery-recommended-title">
                {recommendation.matchedBusiness ? copy.recommendedForBusiness : copy.recommended}
              </h2>
            </div>
            <p>{copy.recommendedDescription}</p>
          </div>
          <div className="template-gallery__grid">
            {recommendations.map((template) => (
              <TemplateTile
                key={`recommended-${template.code}`}
                template={template}
                locale={locale}
                interfaceLocale={interfaceLocale}
                context={copy.contextRecommended}
                onPreview={(selection, trigger) => void loadPreview(selection, false, trigger)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="template-gallery__section" aria-labelledby="template-gallery-all-title">
        <div className="template-gallery__section-heading">
          <div>
            <h2 id="template-gallery-all-title">{copy.allTemplates}</h2>
          </div>
          <p>{copy.allTemplatesDescription}</p>
        </div>
        {noResults ? (
          <div className="template-gallery__no-results" role="status">
            <Search size={24} aria-hidden="true" />
            <h3>{copy.noResults}</h3>
            <p>{copy.noResultsDescription}</p>
            <Button type="button" variant="secondary" onClick={resetFilters}>
              {copy.resetFilters}
            </Button>
          </div>
        ) : (
          <div className="template-gallery__grid">
            {showBlank && generalTemplate ? (
              <TemplateTile
                template={generalTemplate}
                locale={locale}
                interfaceLocale={interfaceLocale}
                context={copy.contextAll}
                blank
                onPreview={(selection, trigger) => void loadPreview(selection, false, trigger)}
              />
            ) : null}
            {filteredTemplates.map((template) => (
              <TemplateTile
                key={template.code}
                template={template}
                locale={locale}
                interfaceLocale={interfaceLocale}
                context={copy.contextAll}
                onPreview={(selection, trigger) => void loadPreview(selection, false, trigger)}
              />
            ))}
          </div>
        )}
      </section>

      <TemplatePreviewDialog
        key={activePreviewKey || "closed"}
        selection={previewSelection}
        previews={previewCache[activePreviewKey]}
        loading={previewRequest?.key === activePreviewKey && previewRequest.status === "loading"}
        error={previewRequest?.key === activePreviewKey && previewRequest.status === "error"}
        locale={locale}
        interfaceLocale={interfaceLocale}
        selectionPending={selectionPending}
        onClose={closePreview}
        onRetry={() => {
          if (previewSelection) void loadPreview(previewSelection, true);
        }}
        onUseTemplate={(template, options) => {
          setPreviewSelection(null);
          onUseTemplate(template, options);
        }}
      />
    </div>
  );
}
