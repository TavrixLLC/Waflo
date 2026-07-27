import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@waflo/i18n";
import { AuthLayout } from "../../../components/auth-layout";
import { ForgotPasswordForm } from "../../../components/auth-forms";

export const metadata: Metadata = { title: "Forgot password" };

export default async function ForgotPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <AuthLayout locale={locale}>
      <ForgotPasswordForm locale={locale} />
    </AuthLayout>
  );
}
