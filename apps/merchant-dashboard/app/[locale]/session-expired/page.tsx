import { notFound } from "next/navigation";
import { isInterfaceLocale } from "@waflo/i18n";
import { AuthLayout } from "../../../components/auth-layout";
import { LoggedOutState } from "../../../components/auth-forms";

export default async function SessionExpiredPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isInterfaceLocale(locale)) notFound();
  return (
    <AuthLayout locale={locale} routePath="/session-expired">
      <LoggedOutState locale={locale} expired />
    </AuthLayout>
  );
}
