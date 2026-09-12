import { isInterfaceLocale, messages, type InterfaceLocale } from "@waflo/i18n";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DashboardRoute, type DashboardSection } from "../../../../components/dashboard";
import type { StudioArea } from "../../../../components/program-studio-presentation";

const dashboardSections = new Set<DashboardSection>([
  "overview",
  "programs",
  "customers",
  "locations",
  "team",
  "analytics",
  "exports",
  "billing",
  "settings",
  "security",
]);

const studioAreaSegments = new Map<string, StudioArea>([
  ["overview", "overview"],
  ["how-it-works", "how-it-works"],
  ["customers-locations", "customers-locations"],
  ["engagement", "engagement"],
  ["launch", "launch"],
  ["settings", "settings"],
]);

function titleForDashboardRoute(locale: InterfaceLocale, section?: string[]): string {
  const copy = messages[locale];
  const selected = (section?.[0] ?? "overview") as DashboardSection;
  if (selected !== "programs") {
    const sectionTitles: Record<DashboardSection, string> = {
      overview: copy.merchant.shell.overview,
      programs: copy.merchant.shell.programs,
      customers: copy.merchant.shell.customers,
      locations: copy.merchant.shell.locations,
      team: copy.merchant.shell.team,
      analytics: copy.merchant.shell.analytics,
      exports: copy.merchant.shell.exports,
      billing: copy.merchant.shell.billing,
      settings: copy.merchant.shell.settings,
      security: copy.merchant.shell.security,
    };
    return sectionTitles[selected] ?? copy.auth.metadata.merchantDashboard;
  }
  if (!section?.[1]) return copy.merchant.shell.programs;
  if (section[1] === "new") return copy.merchant.loyalty.templates.title;
  if (section[2] === "edit") return copy.merchant.loyalty.builder.title;
  const area = studioAreaSegments.get(section[2] ?? "overview") ?? "overview";
  const areas = copy.merchant.loyalty.studio.areas;
  if (area === "how-it-works") return areas.howItWorks.label;
  if (area === "customers-locations") return areas.customersLocations.label;
  return areas[area].label;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; section?: string[] }>;
}): Promise<Metadata> {
  const { locale, section } = await params;
  const interfaceLocale = isInterfaceLocale(locale) ? locale : "en";
  return { title: titleForDashboardRoute(interfaceLocale, section) };
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; section?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, section } = await params;
  if (section?.[0] === "devices") redirect(`/${locale}/dashboard/team`);
  const query = await searchParams;
  const programsGallery = section?.[0] === "programs" && section?.[1] === "new";
  const programsBuilder =
    section?.[0] === "programs" &&
    Boolean(section?.[1]) &&
    section?.[1] !== "new" &&
    section?.[2] === "edit" &&
    section.length === 3;
  const studioAreaSegment = section?.[2] ?? "overview";
  const programsStudio =
    section?.[0] === "programs" &&
    Boolean(section?.[1]) &&
    section?.[1] !== "new" &&
    !programsBuilder &&
    (section.length === 2 || (section.length === 3 && studioAreaSegments.has(studioAreaSegment)));
  if ((section?.length ?? 0) > 1 && !programsGallery && !programsBuilder && !programsStudio)
    notFound();

  const selected = (section?.[0] ?? "overview") as DashboardSection;
  if (!dashboardSections.has(selected)) notFound();

  return (
    <DashboardRoute
      section={selected}
      programsView={
        programsBuilder
          ? "builder"
          : programsGallery
            ? "gallery"
            : programsStudio
              ? "studio"
              : "library"
      }
      legacyProgramCreate={query.create === "quick"}
      {...(programsBuilder && section?.[1] ? { builderProgramId: section[1] } : {})}
      {...(programsStudio && section?.[1]
        ? {
            studioProgramId: section[1],
            studioArea: studioAreaSegments.get(studioAreaSegment) ?? "overview",
          }
        : {})}
      {...(programsGallery && typeof query.changeFor === "string"
        ? { changeProgramId: query.changeFor }
        : {})}
    />
  );
}
