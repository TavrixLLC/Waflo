import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardShell } from "../../../components/dashboard";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (locale !== "en" && locale !== "ar") notFound();
  return <DashboardShell locale={locale}>{children}</DashboardShell>;
}
