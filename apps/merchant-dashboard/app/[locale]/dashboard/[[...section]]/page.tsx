import type { Locale } from "@waflo/contracts";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DashboardApplication, type DashboardSection } from "../../../../components/dashboard";
import type { StudioArea } from "../../../../components/program-studio-presentation";

const dashboardSections = new Set<DashboardSection>([
  "overview",
  "programs",
  "customers",
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

const studioAreaSegments = new Map<string, StudioArea>([
  ["overview", "overview"],
  ["how-it-works", "how-it-works"],
  ["customers-locations", "customers-locations"],
  ["engagement", "engagement"],
  ["test", "test"],
  ["launch", "launch"],
  ["settings", "settings"],
]);

const dashboardSectionTitles = new Map<DashboardSection, string>([
  ["overview", "Overview"],
  ["programs", "Loyalty Cards"],
  ["customers", "Customers"],
  ["approvals", "Manager approvals"],
  ["risk", "Risk"],
  ["locations", "Locations"],
  ["team", "Team"],
  ["analytics", "Analytics"],
  ["exports", "Exports"],
  ["billing", "Billing"],
  ["audit", "Audit"],
  ["settings", "Settings"],
  ["security", "Security"],
]);

const studioAreaTitles = new Map<string, string>([
  ["overview", "Loyalty Studio"],
  ["how-it-works", "How it works"],
  ["customers-locations", "Customers & locations"],
  ["engagement", "Wallet Engagement"],
  ["test", "Test loyalty card"],
  ["launch", "Launch loyalty card"],
  ["settings", "Loyalty card settings"],
]);

function titleForDashboardRoute(section?: string[]): string {
  const selected = (section?.[0] ?? "overview") as DashboardSection;
  if (selected !== "programs") return dashboardSectionTitles.get(selected) ?? "Merchant dashboard";
  if (!section?.[1]) return dashboardSectionTitles.get("programs") ?? "Loyalty Cards";
  if (section[1] === "new") return "Choose a loyalty card design";
  if (section[2] === "edit") return "Customize loyalty card";
  return studioAreaTitles.get(section[2] ?? "overview") ?? "Loyalty Studio";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale; section?: string[] }>;
}): Promise<Metadata> {
  const { section } = await params;
  return { title: titleForDashboardRoute(section) };
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale; section?: string[] }>;
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
    <DashboardApplication
      locale={locale}
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
