import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { contentLocaleForInterface, isInterfaceLocale } from "@waflo/i18n";
import { AuthLayout } from "../../../components/auth-layout";
import { VerificationForm } from "../../../components/auth-forms";

export const metadata: Metadata = { title: "Verify email" };

export default async function VerifyEmailPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isInterfaceLocale(locale)) notFound();
  const contentLocale = contentLocaleForInterface(locale);
  return (
    <AuthLayout locale={contentLocale} interfaceLocale={locale} routePath="/verify-email">
      <VerificationForm locale={contentLocale} />
    </AuthLayout>
  );
}
