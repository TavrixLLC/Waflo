import { notFound, redirect } from "next/navigation";
import { isLocale } from "@waflo/i18n";

export default async function LocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ organization?: string | string[] }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const organization = Array.isArray(query.organization)
    ? query.organization[0]
    : query.organization;
  redirect(
    organization
      ? `/${locale}/onboarding/business?organization=${encodeURIComponent(organization)}`
      : `/${locale}/onboarding/business`,
  );
}
