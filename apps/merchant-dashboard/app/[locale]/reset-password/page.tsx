import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { contentLocaleForInterface, isInterfaceLocale } from "@waflo/i18n";
import { AuthLayout } from "../../../components/auth-layout";
import { ResetPasswordForm } from "../../../components/auth-forms";

export const metadata: Metadata = { title: "Reset password" };

export default async function ResetPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isInterfaceLocale(locale)) notFound();
  const contentLocale = contentLocaleForInterface(locale);
  return (
    <AuthLayout locale={contentLocale} interfaceLocale={locale} routePath="/reset-password">
      <ResetPasswordForm locale={contentLocale} />
    </AuthLayout>
  );
}
