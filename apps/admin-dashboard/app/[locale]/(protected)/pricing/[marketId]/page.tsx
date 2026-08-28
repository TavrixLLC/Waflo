import type { Locale } from "@waflo/contracts";
import { AdminPricingMarketDetail } from "../../../../../components/admin-pricing-market";

export default async function PricingMarketPage({
  params,
}: {
  params: Promise<{ locale: string; marketId: string }>;
}) {
  const { locale, marketId } = await params;
  return (
    <AdminPricingMarketDetail
      marketId={marketId}
      locale={locale === "ar" ? "ar" : ("en" as Locale)}
    />
  );
}
