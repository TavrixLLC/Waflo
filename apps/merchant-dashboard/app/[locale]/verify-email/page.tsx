import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@waflo/i18n";
import { AuthLayout } from "../../../components/auth-layout";
import { VerificationForm } from "../../../components/auth-forms";

export const metadata: Metadata = { title: "Verify email" };

export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const token = Array.isArray(query.token) ? query.token[0] : query.token;
  return (
    <AuthLayout locale={locale}>
      <VerificationForm locale={locale} {...(token ? { token } : {})} />
    </AuthLayout>
  );
}
