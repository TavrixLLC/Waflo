"use client";

import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  Checkbox,
  FormField,
  Modal,
  RadioGroup,
  TextArea,
  TextInput,
} from "@waflo/ui";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api-client";
import { ProgramAssetPicker } from "./program-asset-uploader";
import {
  type AssetItem,
  apiDraft,
  applyTemplateToDraft,
  createQuickDraft,
  type LocationItem,
  type ProgramDraftInput,
  type ProgramItem,
  type TemplateItem,
  templateReplacementFields,
} from "./program-studio-types";
import {
  templateCategory,
  templateCategoryLabel,
  templateStyleLabel,
} from "./template-gallery-presentation";

const stepLabels = [
  "Template",
  "Card",
  "English",
  "Arabic",
  "Locations",
  "Visuals",
  "Review",
] as const;

export function ProgramQuickWizard({
  open,
  onClose,
  organizationId,
  plan,
  templates,
  locations,
  assets,
  onAssetUploaded,
  onCreated,
  ar,
  initialTemplate = null,
  onBackToGallery,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  plan: "STARTER" | "GROWTH" | "SCALE";
  templates: TemplateItem[];
  locations: LocationItem[];
  assets: AssetItem[];
  onAssetUploaded: (asset: AssetItem) => void;
  onCreated: (programId: string) => void;
  ar: boolean;
  initialTemplate?: TemplateItem | null;
  onBackToGallery?: () => void;
}) {
  const locale = ar ? "ar" : "en";
  const [step, setStep] = useState(initialTemplate ? 1 : 0);
  const [draft, setDraft] = useState<ProgramDraftInput>(() =>
    createQuickDraft(initialTemplate ?? "COOKIES"),
  );
  const [hasUserEdits, setHasUserEdits] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<TemplateItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const template =
    templates.find(
      (item) =>
        item.code === draft.templateCode &&
        (draft.templateVersion === undefined || item.version === draft.templateVersion),
    ) ?? templates[0];
  const activeLocations = locations.filter(
    (location) => location.status.toUpperCase() === "ACTIVE",
  );
  const canContinue = useMemo(() => {
    if (step === 0) return Boolean(template);
    if (step === 1)
      return (
        draft.internalName.trim().length >= 2 &&
        draft.requiredStampCount >= 2 &&
        draft.earningDescription.trim().length > 0
      );
    if (step === 2)
      return Object.values(draft.translations.en).every(
        (value) => value === undefined || value.trim().length > 0,
      );
    if (step === 3)
      return Object.values(draft.translations.ar).every(
        (value) => value === undefined || value.trim().length > 0,
      );
    if (step === 4) return draft.locationIds.length > 0;
    return true;
  }, [draft, step, template]);

  useEffect(() => {
    if (!open) return;
    setStep(initialTemplate ? 1 : 0);
    setError("");
    setHasUserEdits(false);
    setPendingTemplate(null);
    setDraft(createQuickDraft(initialTemplate ?? templates[0] ?? "COOKIES"));
  }, [initialTemplate, open, templates]);

  function editDraft(transform: (current: ProgramDraftInput) => ProgramDraftInput) {
    setHasUserEdits(true);
    setDraft(transform);
  }

  function selectTemplate(nextTemplate: TemplateItem) {
    if (draft.templateCode === nextTemplate.code && draft.templateVersion === nextTemplate.version)
      return;
    if (hasUserEdits) {
      setPendingTemplate(nextTemplate);
      return;
    }
    setDraft((current) => applyTemplateToDraft(nextTemplate, current));
  }

  function confirmTemplateSwitch() {
    if (!pendingTemplate) return;
    setDraft((current) => applyTemplateToDraft(pendingTemplate, current));
    setHasUserEdits(false);
    setPendingTemplate(null);
  }

  function updateTranslation(
    locale: "en" | "ar",
    key: keyof ProgramDraftInput["translations"]["en"],
    value: string,
  ) {
    editDraft((current) => ({
      ...current,
      translations: {
        ...current.translations,
        [locale]: { ...current.translations[locale], [key]: value },
      },
    }));
  }

  function setFinalReward(locale: "en" | "ar", value: string) {
    editDraft((current) => ({
      ...current,
      translations: {
        ...current.translations,
        [locale]: { ...current.translations[locale], rewardSummary: value },
      },
      rewards: current.rewards.map((reward, index) =>
        index === 0
          ? {
              ...reward,
              translations: {
                ...reward.translations,
                [locale]: { name: value, description: value },
              },
            }
          : reward,
      ),
    }));
  }

  async function create() {
    setSaving(true);
    setError("");
    try {
      const created = await apiFetch<ProgramItem>(`/v1/organizations/${organizationId}/programs`, {
        method: "POST",
        body: JSON.stringify(apiDraft(draft)),
      });
      onCreated(created.id);
      onClose();
    } catch {
      setError(
        ar
          ? "تعذر إنشاء بطاقة الولاء. لم يتم حفظ بطاقة غير مكتملة. راجع الإعدادات وحاول مرة أخرى."
          : "The loyalty card could not be created. No incomplete card was saved. Review the setup and try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title={ar ? "إنشاء بطاقة ولاء" : "Create a loyalty card"} onClose={onClose}>
      <nav className="quick-progress" aria-label={ar ? "تقدم الإعداد" : "Setup progress"}>
        {stepLabels.map((label, index) => (
          <span
            key={label}
            className={
              index === step ? "quick-progress__active" : index < step ? "quick-progress__done" : ""
            }
          >
            {index < step ? <Check size={14} /> : index + 1}
            <small>{ar ? `${index + 1}` : label}</small>
          </span>
        ))}
      </nav>
      {error ? <Alert tone="danger" title={error} /> : null}

      {step === 0 ? (
        <div className="quick-step">
          <RadioGroup
            legend={ar ? "وضع التحرير" : "Editing mode"}
            name="editing-mode"
            value={draft.editingMode}
            options={[
              {
                value: "quick",
                label: ar ? "الوضع السريع" : "Quick Mode",
                description: ar
                  ? "مسار مبسط لمكافأة نهائية."
                  : "Guided setup for one final reward.",
              },
              {
                value: "pro",
                label: ar ? "الوضع الاحترافي" : "Pro Mode",
                description:
                  plan === "STARTER"
                    ? ar
                      ? "يتطلب Growth أو Scale."
                      : "Requires Growth or Scale."
                    : ar
                      ? "مكافآت ومعالم وتحكم كامل."
                      : "Milestones, multiple rewards, and full controls.",
              },
            ]}
            onChange={(value) => {
              if (value === "pro" && plan === "STARTER") return;
              editDraft((current) => ({
                ...current,
                editingMode: value as "quick" | "pro",
              }));
            }}
          />
          {plan === "STARTER" ? (
            <Alert
              tone="info"
              title={ar ? "الوضع الاحترافي ضمن Growth" : "Pro Mode is available on Growth"}
            >
              {ar
                ? "يمكنك إكمال الوضع السريع الآن أو ترقية الخطة."
                : "Continue with Quick Mode or upgrade to unlock milestones and advanced layouts."}
            </Alert>
          ) : null}
          <h3>{ar ? "اختر الفئة والقالب" : "Choose a category and template"}</h3>
          <div className="template-grid">
            {templates.map((item) => (
              <button
                type="button"
                key={item.code}
                className={`template-card ${draft.templateCode === item.code ? "template-card--selected" : ""}`}
                onClick={() => selectTemplate(item)}
              >
                <div className="template-artwork-pair">
                  <Image
                    src={item.artwork.filled.previewUrl}
                    alt={ar ? `${item.nameAr} filled stamp` : `${item.name} filled stamp`}
                    width={54}
                    height={54}
                    unoptimized
                  />
                  <Image
                    src={item.artwork.empty.previewUrl}
                    alt={ar ? `${item.nameAr} empty stamp` : `${item.name} empty stamp`}
                    width={54}
                    height={54}
                    unoptimized
                  />
                </div>
                <strong>{ar ? item.nameAr : item.name}</strong>
                <small>{ar ? item.descriptionAr : item.description}</small>
                <Badge tone="neutral">
                  {templateCategoryLabel(templateCategory(item), locale)} ·{" "}
                  {templateStyleLabel(item, locale)}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="quick-step">
          <FormField label={ar ? "اسم البطاقة الداخلي" : "Internal card name"} required>
            <TextInput
              name="internalName"
              value={draft.internalName}
              onChange={(event) =>
                editDraft((current) => ({ ...current, internalName: event.target.value }))
              }
              placeholder="Weekend rewards"
            />
          </FormField>
          <FormField label={ar ? "هدف الأختام" : "Stamp goal"} required>
            <input
              aria-label={ar ? "هدف الأختام" : "Stamp goal"}
              type="range"
              min={2}
              max={30}
              value={draft.requiredStampCount}
              onChange={(event) => {
                const goal = Number(event.target.value);
                editDraft((current) => ({
                  ...current,
                  requiredStampCount: goal,
                  rewards: current.rewards.map((reward, index) =>
                    index === current.rewards.length - 1
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
          <FormField label={ar ? "قاعدة الكسب" : "Earning rule"} required>
            <TextInput
              value={draft.earningDescription}
              onChange={(event) =>
                editDraft((current) => ({
                  ...current,
                  earningDescription: event.target.value,
                }))
              }
            />
          </FormField>
        </div>
      ) : null}

      {step === 2 ? (
        <ContentStep
          locale="en"
          values={draft.translations.en}
          onChange={(key, value) => updateTranslation("en", key, value)}
          onReward={(value) => setFinalReward("en", value)}
          ar={ar}
        />
      ) : null}

      {step === 3 ? (
        <div dir="rtl">
          <ContentStep
            locale="ar"
            values={draft.translations.ar}
            onChange={(key, value) => updateTranslation("ar", key, value)}
            onReward={(value) => setFinalReward("ar", value)}
            ar={ar}
          />
        </div>
      ) : null}

      {step === 4 ? (
        <div className="quick-step">
          <h3>{ar ? "اختر المواقع صراحةً" : "Explicitly select active locations"}</h3>
          <p className="field-help">
            {ar
              ? "لن يختار Waflo موقعاً تلقائياً."
              : "Waflo will not silently choose a location for you."}
          </p>
          <div className="studio-check-grid">
            {activeLocations.map((location) => (
              <Checkbox
                key={location.id}
                label={location.name}
                checked={draft.locationIds.includes(location.id)}
                onChange={(event) =>
                  editDraft((current) => ({
                    ...current,
                    locationIds: event.target.checked
                      ? [...current.locationIds, location.id]
                      : current.locationIds.filter((id) => id !== location.id),
                  }))
                }
              />
            ))}
          </div>
          {!activeLocations.length ? (
            <Alert tone="warning" title={ar ? "لا توجد مواقع نشطة" : "No active locations"} />
          ) : null}
        </div>
      ) : null}

      {step === 5 ? (
        <div className="quick-step">
          <div className="studio-color-grid">
            {(
              [
                ["backgroundColor", ar ? "الخلفية" : "Background"],
                ["foregroundColor", ar ? "النص" : "Foreground"],
                ["accentColor", ar ? "التمييز" : "Accent"],
                ["secondaryColor", ar ? "الثانوي" : "Secondary"],
              ] as const
            ).map(([key, label]) => (
              <FormField key={key} label={label}>
                <input
                  type="color"
                  value={draft.visualTheme[key]}
                  onChange={(event) =>
                    editDraft((current) => ({
                      ...current,
                      visualTheme: { ...current.visualTheme, [key]: event.target.value },
                    }))
                  }
                />
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
              editDraft((current) => ({
                ...current,
                visualTheme: { ...current.visualTheme, logoAssetId: assetId },
              }))
            }
            onUploaded={onAssetUploaded}
            ar={ar}
          />
          <ProgramAssetPicker
            organizationId={organizationId}
            category="STAMP_FILLED"
            label={ar ? "الختم الممتلئ" : "Filled stamp"}
            assets={assets}
            selectedId={draft.visualTheme.filledStampAssetId}
            onSelected={(assetId) =>
              editDraft((current) => ({
                ...current,
                visualTheme: {
                  ...current.visualTheme,
                  filledStampAssetId: assetId ?? undefined,
                },
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
              editDraft((current) => ({
                ...current,
                visualTheme: {
                  ...current.visualTheme,
                  emptyStampAssetId: assetId ?? undefined,
                },
              }))
            }
            onUploaded={onAssetUploaded}
            ar={ar}
          />
        </div>
      ) : null}

      {step === 6 ? (
        <div className="quick-step">
          <div className="quick-review-hero">
            <Sparkles size={28} />
            <div>
              <h3>{ar ? "جاهز للحفظ والمراجعة" : "Ready to save and review"}</h3>
              <p>
                {ar
                  ? "سيحفظ Waflo المسودة ثم يفتح الاستوديو بالمعاينات المحفوظة وقائمة دورة الحياة."
                  : "Waflo will persist the draft, then open Studio with server-backed previews and the lifecycle checklist."}
              </p>
            </div>
          </div>
          <dl className="quick-review-list">
            <div>
              <dt>{ar ? "الوضع" : "Mode"}</dt>
              <dd>{draft.editingMode === "pro" ? "Pro" : "Quick"}</dd>
            </div>
            <div>
              <dt>{ar ? "القالب" : "Template"}</dt>
              <dd>{ar ? template?.nameAr : template?.name}</dd>
            </div>
            <div>
              <dt>{ar ? "الهدف" : "Goal"}</dt>
              <dd>{draft.requiredStampCount}</dd>
            </div>
            <div>
              <dt>{ar ? "المواقع" : "Locations"}</dt>
              <dd>{draft.locationIds.length}</dd>
            </div>
            <div>
              <dt>English</dt>
              <dd>{draft.translations.en.programName}</dd>
            </div>
            <div>
              <dt>العربية</dt>
              <dd>{draft.translations.ar.programName}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      <div className="wf-dialog__actions quick-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={
            step === 0
              ? onClose
              : step === 1 && initialTemplate && onBackToGallery
                ? onBackToGallery
                : () => setStep((current) => current - 1)
          }
        >
          <ArrowLeft size={16} />
          {step === 0 ? (ar ? "إلغاء" : "Cancel") : ar ? "السابق" : "Back"}
        </Button>
        {step < stepLabels.length - 1 ? (
          <Button
            type="button"
            disabled={!canContinue}
            onClick={() => setStep((current) => current + 1)}
          >
            {ar ? "متابعة" : "Continue"}
            <ArrowRight size={16} />
          </Button>
        ) : (
          <Button type="button" onClick={() => void create()} loading={saving}>
            {ar ? "حفظ وفتح الاستوديو" : "Save and open Studio"}
          </Button>
        )}
      </div>
      <AlertDialog
        open={Boolean(pendingTemplate)}
        title={ar ? "استبدال إعدادات القالب؟" : "Replace template settings?"}
        description={
          ar
            ? "سيستبدل القالب الجديد هدف الأختام والمحتوى والمكافآت والألوان والرسومات والتخطيط وإعدادات المعاينة. سيبقى الاسم الداخلي والمواقع المحددة."
            : `Switching templates replaces ${templateReplacementFields.join(", ")}. The internal name and selected locations are preserved.`
        }
        confirmLabel={ar ? "استبدال الإعدادات" : "Replace settings"}
        cancelLabel={ar ? "الاحتفاظ بتعديلاتي" : "Keep my edits"}
        onClose={() => setPendingTemplate(null)}
        onConfirm={confirmTemplateSwitch}
      />
    </Modal>
  );
}

function ContentStep({
  locale,
  values,
  onChange,
  onReward,
}: {
  locale: "en" | "ar";
  values: ProgramDraftInput["translations"]["en"];
  onChange: (key: keyof ProgramDraftInput["translations"]["en"], value: string) => void;
  onReward: (value: string) => void;
  ar: boolean;
}) {
  return (
    <div className="quick-step">
      <h3>{locale === "ar" ? "المحتوى العربي" : "English customer content"}</h3>
      <div className="studio-form-grid">
        <FormField label={locale === "ar" ? "اسم البطاقة" : "Card name"} required>
          <TextInput
            name={`${locale}-program-name`}
            value={values.programName}
            onChange={(event) => onChange("programName", event.target.value)}
          />
        </FormField>
        <FormField label={locale === "ar" ? "وصف قصير" : "Short description"} required>
          <TextInput
            value={values.shortDescription}
            onChange={(event) => onChange("shortDescription", event.target.value)}
          />
        </FormField>
      </div>
      <FormField label={locale === "ar" ? "المكافأة النهائية" : "Final reward"} required>
        <TextInput
          name={`${locale}-reward-summary`}
          value={values.rewardSummary}
          onChange={(event) => onReward(event.target.value)}
        />
      </FormField>
      <FormField label={locale === "ar" ? "الشروط" : "Terms"} required>
        <TextArea
          value={values.termsAndConditions}
          onChange={(event) => onChange("termsAndConditions", event.target.value)}
        />
      </FormField>
      <div className="studio-form-grid">
        <FormField label={locale === "ar" ? "رسالة الإكمال" : "Completion message"} required>
          <TextInput
            value={values.completionMessage}
            onChange={(event) => onChange("completionMessage", event.target.value)}
          />
        </FormField>
        <FormField label={locale === "ar" ? "رسالة فتح المكافأة" : "Unlocked message"} required>
          <TextInput
            value={values.rewardUnlockedMessage}
            onChange={(event) => onChange("rewardUnlockedMessage", event.target.value)}
          />
        </FormField>
      </div>
    </div>
  );
}
