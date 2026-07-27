import type { Locale } from "@waflo/contracts";
import { notFound } from "next/navigation";
import { DashboardApplication, type DashboardSection } from "../../../../components/dashboard";

const dashboardSections = new Set<DashboardSection>([
  "overview",
  "programs",
  "customers",
  "locations",
  "team",
  "analytics",
  "billing",
  "audit",
  "settings",
  "security",
]);

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: Locale; section?: string[] }>;
}) {
  const { locale, section } = await params;
  if ((section?.length ?? 0) > 1) notFound();

  const selected = (section?.[0] ?? "overview") as DashboardSection;
  if (!dashboardSections.has(selected)) notFound();

  return <DashboardApplication locale={locale} section={selected} />;
}
