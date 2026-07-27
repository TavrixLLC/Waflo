import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@waflo/i18n";
import { AuthLayout } from "../../../components/auth-layout";
import { LoginForm } from "../../../components/auth-forms";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <AuthLayout locale={locale}>
      <LoginForm locale={locale} />
    </AuthLayout>
  );
}
