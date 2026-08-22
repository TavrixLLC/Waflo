import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { contentLocaleForInterface, isInterfaceLocale } from "@waflo/i18n";
import { DashboardShell } from "../../../components/dashboard";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isInterfaceLocale(locale)) notFound();
  return (
    <DashboardShell locale={contentLocaleForInterface(locale)} interfaceLocale={locale}>
      {children}
    </DashboardShell>
  );
}
