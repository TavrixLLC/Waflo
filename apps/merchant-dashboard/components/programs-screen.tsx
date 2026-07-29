"use client";

import type { Locale } from "@waflo/contracts";
import { Alert, Badge, Button, Card, EmptyState, PageHeader } from "@waflo/ui";
import { ArrowRight, Layers3, Plus, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiClientError } from "../lib/api-client";
import type { MembershipView } from "./dashboard";
import { ProgramQuickWizard } from "./program-quick-wizard";
import { ProgramStudioEditor } from "./program-studio-editor";
import type { AssetItem, LocationItem, ProgramItem, TemplateItem } from "./program-studio-types";

interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

function errorMessage(error: unknown, fallback: string) {
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
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [programCursor, setProgramCursor] = useState<string | null>(null);
  const [assetCursor, setAssetCursor] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [studioProgramId, setStudioProgramId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [programData, templateData, locationData, assetData] = await Promise.all([
        apiFetch<CursorPage<ProgramItem>>(`/v1/organizations/${organizationId}/programs?limit=20`),
        apiFetch<TemplateItem[]>(`/v1/organizations/${organizationId}/programs/templates`),
        apiFetch<{ items: LocationItem[] } | LocationItem[]>(
          `/v1/organizations/${organizationId}/locations`,
        ),
        apiFetch<CursorPage<AssetItem>>(`/v1/organizations/${organizationId}/assets?limit=30`),
      ]);
      setPrograms(programData.items);
      setProgramCursor(programData.nextCursor);
      setTemplates(templateData);
      setLocations(Array.isArray(locationData) ? locationData : locationData.items);
      setAssets(assetData.items);
      setAssetCursor(assetData.nextCursor);
    } catch (caught) {
      setError(
        errorMessage(caught, ar ? "تعذر تحميل استوديو الولاء." : "Unable to load Loyalty Studio."),
      );
    } finally {
      setLoading(false);
    }
  }, [ar, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

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
        onClose={() => setStudioProgramId(null)}
        onChanged={load}
      />
    );
  }

  return (
    <div className="programs-home" dir={ar ? "rtl" : "ltr"}>
      <PageHeader
        eyebrow={ar ? "استوديو الولاء" : "LOYALTY STUDIO"}
        title={ar ? "برامج الولاء" : "Loyalty programs"}
        description={
          ar
            ? "صمّم برنامج الأختام، راجعه على ثلاث منصات، اختبر دورة المكافآت، ثم انشره بثقة."
            : "Design the stamp experience, review all three surfaces, test reward cycles, then publish with confidence."
        }
        actions={
          <Button onClick={() => setWizardOpen(true)}>
            <Plus size={17} />
            {ar ? "إنشاء برنامج" : "Create program"}
          </Button>
        }
      />

      {error ? <Alert tone="danger" title={error} /> : null}

      <section
        className="programs-home__summary"
        aria-label={ar ? "ملخص البرامج" : "Program summary"}
      >
        <Card>
          <span className="dashboard-card__label">{ar ? "الخطة" : "PLAN"}</span>
          <strong>{membership.organization.selectedPlan}</strong>
          <small>
            {membership.organization.selectedPlan === "STARTER"
              ? ar
                ? "الوضع السريع، مكافأة نهائية واحدة"
                : "Quick Mode, one final reward"
              : ar
                ? "الوضع السريع وPro مع المعالم"
                : "Quick and Pro Mode with milestones"}
          </small>
        </Card>
        <Card>
          <span className="dashboard-card__label">{ar ? "البرامج" : "PROGRAMS"}</span>
          <strong>{programs.length}</strong>
          <small>
            {ar ? "مسودات وإصدارات منشورة معزولة" : "Isolated drafts and published versions"}
          </small>
        </Card>
        <Card>
          <span className="dashboard-card__label">{ar ? "الأصول" : "ASSETS"}</span>
          <strong>{assets.length}</strong>
          <small>
            {ar ? "مكتبة Waflo وملفات مرفوعة خاصة" : "Waflo library and private uploads"}
          </small>
        </Card>
      </section>

      {loading ? (
        <Card className="programs-home__loading">
          <Layers3 size={24} />
          {ar ? "جارٍ تحميل البرامج…" : "Loading programs…"}
        </Card>
      ) : programs.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Sparkles size={28} />}
            title={ar ? "ابدأ أول برنامج أختام" : "Create your first stamp program"}
            description={
              ar
                ? "يقودك الوضع السريع عبر المحتوى العربي والإنجليزي والمواقع والهوية البصرية دون افتراضات مخفية."
                : "Quick Mode guides you through English, Arabic, locations, and visual identity without hidden assumptions."
            }
            action={
              <Button onClick={() => setWizardOpen(true)}>
                <Plus size={17} />
                {ar ? "ابدأ الآن" : "Start now"}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="program-list">
          {programs.map((program) => {
            const draft = program.currentDraftVersion;
            const published = program.currentPublishedVersion;
            return (
              <Card className="program-list__card" key={program.id}>
                <div className="program-list__heading">
                  <div>
                    <span className="dashboard-card__label">
                      {draft
                        ? `${draft.editingMode} MODE · v${draft.versionNumber}`
                        : `LIVE · v${published?.versionNumber ?? 1}`}
                    </span>
                    <h2>{program.internalName}</h2>
                  </div>
                  <Badge tone={program.status === "PUBLISHED" ? "success" : "neutral"}>
                    {program.status}
                  </Badge>
                </div>
                <p>
                  {draft
                    ? ar
                      ? `المسودة في حالة ${draft.status}، المراجعة ${draft.revision}.`
                      : `Draft is ${draft.status.toLowerCase().replaceAll("_", " ")}, revision ${draft.revision}.`
                    : ar
                      ? "الإصدار المنشور مباشر. أنشئ مسودة معزولة لتعديله."
                      : "The published version is live. Create an isolated draft to edit it."}
                </p>
                {published && draft ? (
                  <Alert
                    tone="info"
                    title={
                      ar
                        ? "تغييرات غير منشورة معزولة عن الإصدار المباشر"
                        : "Unpublished changes are isolated from the live version"
                    }
                  />
                ) : null}
                <div className="program-list__footer">
                  <span>
                    {program._count?.versions ?? (published && draft ? 2 : 1)}{" "}
                    {ar ? "إصدار" : "version(s)"}
                  </span>
                  <Button onClick={() => setStudioProgramId(program.id)}>
                    {ar ? "فتح الاستوديو" : "Open Studio"}
                    <ArrowRight size={16} />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {programCursor || assetCursor ? (
        <div className="program-pagination-actions">
          {programCursor ? (
            <Button variant="secondary" onClick={() => void loadMorePrograms()}>
              {ar ? "تحميل المزيد من البرامج" : "Load more programs"}
            </Button>
          ) : null}
          {assetCursor ? (
            <Button variant="secondary" onClick={() => void loadMoreAssets()}>
              {ar ? "تحميل المزيد من الأصول" : "Load more assets"}
            </Button>
          ) : null}
        </div>
      ) : null}

      <ProgramQuickWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        organizationId={organizationId}
        plan={membership.organization.selectedPlan}
        templates={templates}
        locations={locations}
        assets={assets}
        onAssetUploaded={(asset) =>
          setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)])
        }
        onCreated={(programId) => {
          setWizardOpen(false);
          setStudioProgramId(programId);
          void load();
        }}
        ar={ar}
      />
    </div>
  );
}
