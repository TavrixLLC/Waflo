import { AdminRepricingDashboard } from "../../../../components/admin-repricing-dashboard";

export default async function RepricingPage({
  params,
}: {
  params: Promise<{ locale: "en" | "ar" }>;
}) {
  const { locale } = await params;
  return <AdminRepricingDashboard locale={locale} />;
}
