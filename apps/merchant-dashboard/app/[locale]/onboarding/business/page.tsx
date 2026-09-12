import { notFound } from "next/navigation";
import { isInterfaceLocale } from "@waflo/i18n";
import { BusinessOnboarding } from "../../../../components/onboarding";

export default async function BusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    organization?: string | string[];
    resume?: string | string[];
  }>;
}) {
  const { locale } = await params;
  if (!isInterfaceLocale(locale)) notFound();
  const query = await searchParams;
  const organization = Array.isArray(query.organization)
    ? query.organization[0]
    : query.organization;
  const resume = Array.isArray(query.resume) ? query.resume[0] : query.resume;
  return (
    <BusinessOnboarding
      locale={locale}
      {...(organization ? { organizationId: organization } : {})}
      {...(resume ? { resumeState: resume } : {})}
    />
  );
}
