import type { Locale } from "@waflo/contracts";
import { AdminCustomersDirectory } from "../../../../components/admin-customers-directory";

export default async function CustomersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <AdminCustomersDirectory locale={locale === "ar" ? "ar" : ("en" as Locale)} />;
}
