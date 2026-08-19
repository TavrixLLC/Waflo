import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { interfaceTextLocaleFor, isInterfaceLocale } from "@waflo/i18n";
import { AuthLayout } from "../../../components/auth-layout";
import { ForgotPasswordForm } from "../../../components/auth-forms";

export const metadata: Metadata = { title: "Forgot password" };

export default async function ForgotPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isInterfaceLocale(locale)) notFound();
  const interfaceTextLocale = interfaceTextLocaleFor(locale);
  return (
    <AuthLayout locale={interfaceTextLocale} interfaceLocale={locale} routePath="/forgot-password">
      <ForgotPasswordForm locale={interfaceTextLocale} />
    </AuthLayout>
  );
}
