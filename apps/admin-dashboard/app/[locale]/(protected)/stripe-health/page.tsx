import type { Locale } from "@waflo/contracts";
import { AdminStripeHealthDashboard } from "../../../../components/admin-stripe-health-dashboard";

export default async function StripeHealthPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <AdminStripeHealthDashboard locale={locale === "ar" ? "ar" : ("en" as Locale)} />;
}
