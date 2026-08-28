import { AdminRepricingCampaignDetail } from "../../../../../components/admin-repricing-campaign";

export default async function RepricingCampaignPage({
  params,
}: {
  params: Promise<{ locale: "en" | "ar"; campaignId: string }>;
}) {
  const { locale, campaignId } = await params;
  return <AdminRepricingCampaignDetail locale={locale} campaignId={campaignId} />;
}
