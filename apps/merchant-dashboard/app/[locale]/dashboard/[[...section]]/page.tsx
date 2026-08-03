import type { Locale } from "@waflo/contracts";
import { notFound } from "next/navigation";
import { DashboardApplication, type DashboardSection } from "../../../../components/dashboard";

const dashboardSections = new Set<DashboardSection>([
  "overview",
  "programs",
  "customers",
  "devices",
  "approvals",
  "risk",
  "locations",
  "team",
  "analytics",
  "exports",
  "billing",
  "audit",
  "settings",
  "security",
]);

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale; section?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, section } = await params;
  const query = await searchParams;
  const programsGallery = section?.[0] === "programs" && section?.[1] === "new";
  if ((section?.length ?? 0) > 1 && !programsGallery) notFound();

  const selected = (section?.[0] ?? "overview") as DashboardSection;
  if (!dashboardSections.has(selected)) notFound();

  return (
    <DashboardApplication
      locale={locale}
      section={selected}
      programsView={programsGallery ? "gallery" : "library"}
      legacyProgramCreate={query.create === "quick"}
    />
  );
}
