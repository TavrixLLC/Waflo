import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@waflo/i18n";
import { AuthLayout } from "../../../components/auth-layout";
import { InviteClient } from "../../../components/invite-client";

export const metadata: Metadata = { title: "Team invitation" };

export default async function InvitationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <AuthLayout locale={locale}>
      <InviteClient locale={locale} />
    </AuthLayout>
  );
}
