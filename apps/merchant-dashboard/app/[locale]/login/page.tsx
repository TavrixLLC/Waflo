import { notFound } from "next/navigation";
import { isInterfaceLocale } from "@waflo/i18n";
import { AuthLayout } from "../../../components/auth-layout";
import { authPageMetadata } from "../../../components/auth-page-metadata";
import { LoginForm } from "../../../components/auth-forms";

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return authPageMetadata(params, "login");
}

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isInterfaceLocale(locale)) notFound();
  return (
    <AuthLayout locale={locale} routePath="/login">
      <LoginForm locale={locale} />
    </AuthLayout>
  );
}
