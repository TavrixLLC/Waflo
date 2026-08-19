import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { interfaceTextLocaleFor, isInterfaceLocale } from "@waflo/i18n";
import { AuthLayout } from "../../../components/auth-layout";
import { InviteClient } from "../../../components/invite-client";

export const metadata: Metadata = { title: "Team invitation" };

export default async function InvitationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isInterfaceLocale(locale)) notFound();
  const interfaceTextLocale = interfaceTextLocaleFor(locale);
  return (
    <AuthLayout locale={interfaceTextLocale} interfaceLocale={locale} routePath="/invite">
      <InviteClient locale={interfaceTextLocale} />
    </AuthLayout>
  );
}
