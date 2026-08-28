import type { Locale } from "@waflo/contracts";
import type { ReactNode } from "react";
import { AdminShell } from "../../../components/admin-session";

export default async function ProtectedLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <AdminShell locale={locale === "ar" ? "ar" : ("en" as Locale)}>{children}</AdminShell>;
}
