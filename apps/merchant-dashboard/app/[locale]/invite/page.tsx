import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { contentLocaleForInterface, isInterfaceLocale } from "@waflo/i18n";
import { AuthLayout } from "../../../components/auth-layout";
import { InviteClient } from "../../../components/invite-client";

export const metadata: Metadata = { title: "Team invitation" };

export default async function InvitationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isInterfaceLocale(locale)) notFound();
  const contentLocale = contentLocaleForInterface(locale);
  return (
    <AuthLayout locale={contentLocale} interfaceLocale={locale} routePath="/invite">
      <InviteClient locale={contentLocale} />
    </AuthLayout>
  );
}
