import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@waflo/i18n";
import { AuthLayout } from "../../../components/auth-layout";
import { VerificationForm } from "../../../components/auth-forms";

export const metadata: Metadata = { title: "Verify email" };

export default async function VerifyEmailPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <AuthLayout locale={locale}>
      <VerificationForm locale={locale} />
    </AuthLayout>
  );
}
