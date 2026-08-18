import { notFound } from "next/navigation";
import { contentLocaleForInterface, isInterfaceLocale } from "@waflo/i18n";
import { CompletionOnboarding } from "../../../../components/onboarding";

export default async function CompletionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ organization?: string | string[] }>;
}) {
  const { locale } = await params;
  if (!isInterfaceLocale(locale)) notFound();
  const query = await searchParams;
  const organization = Array.isArray(query.organization)
    ? query.organization[0]
    : query.organization;
  return (
    <CompletionOnboarding
      locale={contentLocaleForInterface(locale)}
      interfaceLocale={locale}
      {...(organization ? { organizationId: organization } : {})}
    />
  );
}
