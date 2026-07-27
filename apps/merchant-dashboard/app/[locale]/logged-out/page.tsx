import { notFound } from "next/navigation";
import { isLocale } from "@waflo/i18n";
import { AuthLayout } from "../../../components/auth-layout";
import { LoggedOutState } from "../../../components/auth-forms";

export default async function LoggedOutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <AuthLayout locale={locale}>
      <LoggedOutState locale={locale} />
    </AuthLayout>
  );
}
