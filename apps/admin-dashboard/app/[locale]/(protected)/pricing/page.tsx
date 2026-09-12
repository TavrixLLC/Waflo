import type { Locale } from "@waflo/contracts";
import { AdminPricingDashboard } from "../../../../components/admin-pricing-dashboard";

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <AdminPricingDashboard locale={locale === "ar" ? "ar" : ("en" as Locale)} />;
}
