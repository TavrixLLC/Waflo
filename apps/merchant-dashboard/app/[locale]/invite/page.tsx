import { notFound } from "next/navigation";
import { isInterfaceLocale } from "@waflo/i18n";
import { AuthLayout } from "../../../components/auth-layout";
import { authPageMetadata } from "../../../components/auth-page-metadata";
import { InviteClient } from "../../../components/invite-client";

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return authPageMetadata(params, "invitation");
}

export default async function InvitationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isInterfaceLocale(locale)) notFound();
  return (
    <AuthLayout locale={locale} routePath="/invite">
      <InviteClient locale={locale} />
    </AuthLayout>
  );
}
