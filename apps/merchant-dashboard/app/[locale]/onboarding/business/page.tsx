import { notFound } from "next/navigation";
import { isLocale } from "@waflo/i18n";
import { BusinessOnboarding } from "../../../../components/onboarding";

export default async function BusinessPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <BusinessOnboarding locale={locale} />;
}
