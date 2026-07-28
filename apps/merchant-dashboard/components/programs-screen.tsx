"use client";

import type { Locale } from "@waflo/contracts";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  PageHeader,
  TextInput,
} from "@waflo/ui";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  FlaskConical,
  Gift,
  LayoutGrid,
  Plus,
  Save,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { apiFetch, ApiClientError } from "../lib/api-client";
import type { MembershipView } from "./dashboard";

interface ProgramItem {
  id: string;
  internalName: string;
  status: string;
  currentDraftVersion: { versionNumber: number; revision: number; status: string } | null;
  currentPublishedVersion: { versionNumber: number } | null;
}
interface TemplateItem {
  code: string;
  name: string;
  nameAr?: string;
  description: string;
  descriptionAr?: string;
  filled: string;
  empty: string;
  artwork?: { filled: string; empty: string };
}
interface LocationItem {
  id: string;
  name: string;
  status: string;
}

const colors: Record<string, [string, string]> = {
  COOKIES: ["#6B3F2A", "#E7B56B"],
  COFFEE: ["#3B2A21", "#D6A56D"],
  BAKERY: ["#B5475E", "#F3C0A5"],
  PIZZA: ["#D85032", "#F4C95D"],
  SMOOTHIE: ["#2A9D8F", "#B8E0D2"],
  SALON: ["#7C3AED", "#E9D5FF"],
  FITNESS: ["#0F766E", "#99F6E4"],
  RETAIL: ["#1D4ED8", "#BFDBFE"],
};
const defaultColors: [string, string] = ["#6B3F2A", "#E7B56B"];

function message(error: unknown, fallback: string) {
  return error instanceof ApiClientError ? error.message : fallback;
}

export function ProgramsScreen({
  locale,
  membership,
}: {
  locale: Locale;
  membership: MembershipView;
}) {
  const ar = locale === "ar";
  const organizationId = membership.organization.id;
  const [programs, setPrograms] = useState<ProgramItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [selected, setSelected] = useState<ProgramItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [template, setTemplate] = useState("COOKIES");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState(8);
  const [reward, setReward] = useState(ar ? "مكافأتك القادمة" : "Your next reward");
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const activeLocation = locations.find((item) => item.status.toUpperCase() === "ACTIVE");
  const stampStates = useMemo(
    () =>
      Array.from({ length: goal }, (_, index) => ({
        id: `stamp-${index + 1}`,
        filled: index < progress,
      })),
    [goal, progress],
  );

  const load = useCallback(async () => {
    try {
      const [programData, templateData, locationData] = await Promise.all([
        apiFetch<ProgramItem[]>(`/v1/organizations/${organizationId}/programs`),
        apiFetch<TemplateItem[]>(`/v1/organizations/${organizationId}/programs/templates`),
        apiFetch<{ items: LocationItem[] }>(`/v1/organizations/${organizationId}/locations`),
      ]);
      setPrograms(programData);
      setTemplates(templateData);
      setLocations(Array.isArray(locationData) ? locationData : locationData.items);
    } catch (caught) {
      setError(message(caught, ar ? "تعذر تحميل البرامج." : "Unable to load programs."));
    }
  }, [ar, organizationId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function createProgram() {
    if (!activeLocation) {
      setError(ar ? "أضف موقعاً نشطاً أولاً." : "Add an active location first.");
      return;
    }
    setSaving(true);
    setError("");
    const accent = colors[template]?.[0] ?? defaultColors[0];
    const secondary = colors[template]?.[1] ?? defaultColors[1];
    try {
      await apiFetch(`/v1/organizations/${organizationId}/programs`, {
        method: "POST",
        body: JSON.stringify({
          internalName:
            name.trim() ||
            `${templates.find((item) => item.code === template)?.name ?? "Waflo"} rewards`,
          editingMode: "quick",
          templateCode: template,
          requiredStampCount: goal,
          earningDescription: "One stamp per qualifying visit.",
          locationIds: [activeLocation.id],
          translations: {
            en: {
              programName: name.trim() || "Waflo Rewards",
              shortDescription: "Collect stamps, unlock something good.",
              rewardSummary: reward,
              termsAndConditions: "Terms apply. Rewards are descriptive in W2.",
              completionMessage: "You unlocked your reward.",
              rewardUnlockedMessage: "Your reward is ready.",
            },
            ar: {
              programName: name.trim() || "مكافآت Waflo",
              shortDescription: "اجمع الأختام وافتح مكافأتك.",
              rewardSummary: reward,
              termsAndConditions: "تطبق الشروط. المكافآت وصفية في المرحلة الثانية.",
              completionMessage: "لقد فتحت مكافأتك.",
              rewardUnlockedMessage: "مكافأتك جاهزة.",
            },
          },
          rewards: [
            {
              thresholdStampCount: goal,
              rewardType: "TEXT_REWARD",
              internalName: "Final reward",
              sortOrder: 0,
              requiresManagerApproval: false,
              maximumRedemptionsPerEarned: 1,
              translations: {
                en: { name: reward, description: reward },
                ar: { name: reward, description: reward },
              },
            },
          ],
          visualTheme: {
            backgroundColor: "#F7F4EE",
            foregroundColor: "#222222",
            accentColor: accent,
            secondaryColor: secondary,
            mutedColor: "#6B7280",
            layoutType: "GRID",
            layoutConfiguration: {},
            stampSize: 48,
            stampSpacing: 8,
            borderRadius: 18,
            progressLabelVisible: true,
            rewardLabelVisible: true,
            customerWebVariant: "CARD",
            applePreviewConfig: {},
            googlePreviewConfig: {},
          },
        }),
      });
      setShowCreate(false);
      setStep(0);
      setName("");
      await load();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر حفظ البرنامج." : "Unable to save program."));
    } finally {
      setSaving(false);
    }
  }

  async function action(path: string) {
    if (!selected) return;
    setSaving(true);
    try {
      await apiFetch(`/v1/organizations/${organizationId}/programs/${selected.id}/${path}`, {
        method: "POST",
        ...(path === "publish"
          ? { body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) }
          : {}),
      });
      await load();
      setSelected(null);
    } catch (caught) {
      setError(message(caught, ar ? "تعذر تنفيذ الإجراء." : "Unable to complete the action."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div dir={ar ? "rtl" : "ltr"}>
      <PageHeader
        eyebrow={ar ? "استوديو الولاء" : "LOYALTY STUDIO"}
        title={ar ? "برامجك" : "Programs"}
        description={
          ar
            ? "صمم برنامج أختام، اختبره، ثم انشره بثقة."
            : "Design a stamp program, test it, then publish with confidence."
        }
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus size={17} />
            {ar ? "إنشاء برنامج" : "Create program"}
          </Button>
        }
      />
      {error ? <Alert tone="danger" title={error} /> : null}
      {selected ? (
        <ProgramDetail
          organizationId={organizationId}
          program={selected}
          ar={ar}
          progress={progress}
          setProgress={setProgress}
          stampStates={stampStates}
          onAction={action}
          onClose={() => setSelected(null)}
          saving={saving}
        />
      ) : programs.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Sparkles size={28} />}
            title={ar ? "ابدأ ببرنامج أختام" : "Start with a stamp program"}
            description={
              ar
                ? "استخدم قالباً جاهزاً أو ابدأ من صفحة بيضاء."
                : "Use a ready-made template or start from a blank page."
            }
            action={
              <Button onClick={() => setShowCreate(true)}>
                <Plus size={17} />
                {ar ? "إنشاء أول برنامج" : "Create your first program"}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="dashboard-grid">
          {programs.map((program) => (
            <Card
              className="dashboard-card"
              key={program.id}
              onClick={() => setSelected(program)}
              style={{ cursor: "pointer" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div>
                  <span className="dashboard-card__label">
                    {program.currentPublishedVersion
                      ? `v${program.currentPublishedVersion.versionNumber}`
                      : "DRAFT"}
                  </span>
                  <h2>{program.internalName}</h2>
                </div>
                <Badge tone={program.status === "PUBLISHED" ? "success" : "neutral"}>
                  {program.status}
                </Badge>
              </div>
              <p style={{ color: "var(--waflo-muted)" }}>
                {program.currentPublishedVersion && program.currentDraftVersion
                  ? ar
                    ? "تعديلات غير منشورة"
                    : "Unpublished changes"
                  : ar
                    ? "نسخة قابلة للتحرير مع معاينة حية."
                    : "Editable version with a live preview."}
              </p>
              <div style={{ display: "flex", gap: ".4rem", color: "var(--waflo-muted)" }}>
                <LayoutGrid size={16} />
                {program.currentDraftVersion
                  ? `v${program.currentDraftVersion.versionNumber} · rev ${program.currentDraftVersion.revision} · ${program.currentDraftVersion.status}`
                  : "Published"}
                <ChevronRight size={16} />
              </div>
            </Card>
          ))}
        </div>
      )}
      {showCreate ? (
        <CreateModal
          ar={ar}
          step={step}
          setStep={setStep}
          templates={templates}
          template={template}
          setTemplate={setTemplate}
          name={name}
          setName={setName}
          goal={goal}
          setGoal={setGoal}
          reward={reward}
          setReward={setReward}
          stampStates={stampStates}
          selectedColors={colors[template] ?? defaultColors}
          onClose={() => setShowCreate(false)}
          onSave={createProgram}
          saving={saving}
          hasLocation={Boolean(activeLocation)}
          plan={membership.organization.selectedPlan}
        />
      ) : null}
    </div>
  );
}

function CreateModal({
  ar,
  step,
  setStep,
  templates,
  template,
  setTemplate,
  name,
  setName,
  goal,
  setGoal,
  reward,
  setReward,
  stampStates,
  selectedColors,
  onClose,
  onSave,
  saving,
  hasLocation,
  plan,
}: {
  ar: boolean;
  step: number;
  setStep: (value: number) => void;
  templates: TemplateItem[];
  template: string;
  setTemplate: (value: string) => void;
  name: string;
  setName: (value: string) => void;
  goal: number;
  setGoal: (value: number) => void;
  reward: string;
  setReward: (value: string) => void;
  stampStates: Array<{ id: string; filled: boolean }>;
  selectedColors: [string, string];
  onClose: () => void;
  onSave: () => Promise<void>;
  saving: boolean;
  hasLocation: boolean;
  plan: string;
}) {
  const list = templates.length
    ? templates
    : Object.keys(colors).map((code) => ({
        code,
        name: code,
        description: "",
        filled: "",
        empty: "",
      }));
  return (
    <div className="wf-modal-backdrop">
      <Card className="wf-modal">
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div>
            <span className="dashboard-card__label">
              {ar ? `الخطوة ${step + 1} من 5` : `STEP ${step + 1} OF 5`}
            </span>
            <h2>{ar ? "إنشاء برنامج أختام" : "Create a stamp program"}</h2>
          </div>
          <button type="button" className="wf-icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {step === 0 ? (
          <>
            <p className="field-help">
              {ar ? "اختر قالباً جاهزاً." : "Choose a ready-made template."}
            </p>
            <div className="template-grid">
              {list.map((item) => (
                <button
                  type="button"
                  key={item.code}
                  className={`template-card ${template === item.code ? "template-card--selected" : ""}`}
                  onClick={() => setTemplate(item.code)}
                >
                  <span
                    className="template-art"
                    style={{
                      background: colors[item.code]?.[1] ?? "#eee",
                      color: colors[item.code]?.[0] ?? "#333",
                    }}
                  >
                    ●
                  </span>
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </button>
              ))}
            </div>
          </>
        ) : step === 1 ? (
          <FormField label={ar ? "اسم البرنامج الداخلي" : "Internal program name"}>
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Weekend rewards"
            />
          </FormField>
        ) : step === 2 ? (
          <>
            <FormField label={ar ? "هدف الأختام" : "Stamp goal"}>
              <input
                aria-label="Stamp goal"
                type="range"
                min={2}
                max={30}
                value={goal}
                onChange={(event) => setGoal(Number(event.target.value))}
                style={{ width: "100%" }}
              />
              <strong style={{ fontSize: "2rem" }}>{goal}</strong> {ar ? "أختام" : "stamps"}
            </FormField>
            <div className="stamp-preview-mini">
              {stampStates.map((stamp) => (
                <span
                  key={stamp.id}
                  className={stamp.filled ? "stamp stamp--filled" : "stamp"}
                  style={{ borderColor: selectedColors[0], color: selectedColors[0] }}
                >
                  {stamp.filled ? <Check size={18} /> : stamp.id.replace("stamp-", "")}
                </span>
              ))}
            </div>
          </>
        ) : step === 3 ? (
          <FormField label={ar ? "وصف المكافأة" : "Reward description"}>
            <TextInput value={reward} onChange={(event) => setReward(event.target.value)} />
            <p className="field-help">
              {ar
                ? "وصف فقط؛ لا توجد تسوية مالية في W2."
                : "Descriptive only; there is no financial settlement in W2."}
            </p>
          </FormField>
        ) : (
          <div className="pro-mode-panel">
            <Sparkles size={24} />
            <h3>{ar ? "وضع Pro" : "Pro Mode"}</h3>
            <p>
              {ar
                ? "تحكم متقدم بالألوان والتخطيطات والمعاينات."
                : "Advanced control over colors, layouts, and previews."}
            </p>
            <Badge tone={plan === "STARTER" ? "warning" : "success"}>
              {plan === "STARTER" ? "Growth recommended" : "Available"}
            </Badge>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "2rem" }}>
          {step > 0 ? (
            <Button variant="secondary" onClick={() => setStep(step - 1)}>
              <ChevronLeft size={17} />
              {ar ? "السابق" : "Back"}
            </Button>
          ) : (
            <span />
          )}
          {step < 4 ? (
            <Button onClick={() => setStep(step + 1)}>
              {ar ? "التالي" : "Continue"}
              <ChevronRight size={17} />
            </Button>
          ) : (
            <Button onClick={() => void onSave()} disabled={saving || !hasLocation}>
              <Save size={17} />
              {saving ? "Saving" : ar ? "حفظ كمسودة" : "Save draft"}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function ProgramDetail({
  organizationId,
  program,
  ar,
  progress,
  setProgress,
  stampStates,
  onAction,
  onClose,
  saving,
}: {
  organizationId: string;
  program: ProgramItem;
  ar: boolean;
  progress: number;
  setProgress: (value: number) => void;
  stampStates: Array<{ id: string; filled: boolean }>;
  onAction: (path: string) => Promise<void>;
  onClose: () => void;
  saving: boolean;
}) {
  const [profile, setProfile] = useState<"CUSTOMER_WEB" | "APPLE_WALLET" | "GOOGLE_WALLET">(
    "CUSTOMER_WEB",
  );
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let active = true;
    void apiFetch<{ svg: string }>(
      `/v1/organizations/${organizationId}/programs/${program.id}/preview?progress=${progress}&layout=GRID&profile=${profile}`,
    )
      .then((preview) => {
        if (active) setSvg(preview.svg);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [organizationId, program.id, progress, profile]);
  const previewSrc = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : "";
  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "start",
          marginBottom: "1rem",
        }}
      >
        <div>
          <span className="dashboard-card__label">
            {ar ? "معاينة البرنامج" : "PROGRAM PREVIEW"}
          </span>
          <h2>{program.internalName}</h2>
        </div>
        <Button variant="secondary" onClick={onClose}>
          <ChevronLeft size={17} />
          {ar ? "كل البرامج" : "All programs"}
        </Button>
      </div>
      <div className="dashboard-grid">
        <Card className="dashboard-card dashboard-card--wide">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>
              <h3>{ar ? "معاينة التقدم" : "Live progress preview"}</h3>
              <p style={{ color: "var(--waflo-muted)" }}>
                {progress}/{stampStates.length} {ar ? "أختام" : "stamps"}
              </p>
            </div>
            <Eye size={20} />
          </div>
          <input
            aria-label="Preview progress"
            type="range"
            min={0}
            max={stampStates.length}
            value={progress}
            onChange={(event) => setProgress(Number(event.target.value))}
            style={{ width: "100%" }}
          />
          <div className="preview-profile-row">
            {(["CUSTOMER_WEB", "APPLE_WALLET", "GOOGLE_WALLET"] as const).map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => setProfile(item)}
                aria-pressed={profile === item}
              >
                <strong>
                  {item === "CUSTOMER_WEB"
                    ? "Customer Web"
                    : item === "APPLE_WALLET"
                      ? "Apple Wallet"
                      : "Google Wallet"}
                </strong>
                <small>{profile === item ? "Selected preview" : "Open preview"}</small>
              </button>
            ))}
          </div>
          {previewSrc ? (
            <Image
              src={previewSrc}
              alt={`${profile} preview`}
              unoptimized
              width={720}
              height={460}
              style={{
                display: "block",
                maxWidth: "100%",
                width: "100%",
                marginTop: "1rem",
                borderRadius: 18,
              }}
            />
          ) : null}
        </Card>
        <Card className="dashboard-card">
          <h3>{ar ? "حالة البرنامج" : "Program status"}</h3>
          <Badge tone={program.status === "PUBLISHED" ? "success" : "neutral"}>
            {program.status}
          </Badge>
          {program.currentPublishedVersion && program.currentDraftVersion ? (
            <p className="field-help">
              {ar
                ? "تعديلات غير منشورة"
                : "Unpublished changes are isolated from the live program."}
            </p>
          ) : null}
          <div className="studio-actions">
            {program.currentDraftVersion?.status === "TEST_READY" ? (
              <Button onClick={() => void onAction("publish")} disabled={saving}>
                <Gift size={16} />
                Publish
              </Button>
            ) : null}
            {program.status === "PUBLISHED" ? (
              <Button variant="secondary" onClick={() => void onAction("pause")} disabled={saving}>
                Pause
              </Button>
            ) : null}
            {program.status === "PAUSED" ? (
              <Button variant="secondary" onClick={() => void onAction("resume")} disabled={saving}>
                Resume
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => void onAction("validate")} disabled={saving}>
              <WandSparkles size={16} />
              Validate
            </Button>
            <Button
              variant="secondary"
              onClick={() => void onAction("test-sessions")}
              disabled={saving}
            >
              <FlaskConical size={16} />
              Test Mode
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
