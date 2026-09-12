import { normalizeCloudflareCountry } from "@waflo/billing";
import type { MarketingPricingReadModel } from "../components/pricing-explorer";

export function trustedCloudflareCountry(headers: Headers): string | null {
  return normalizeCloudflareCountry(headers.get("cf-ipcountry"));
}

export async function fetchMarketingPricing(
  country: string | null,
): Promise<MarketingPricingReadModel> {
  const apiUrl =
    process.env.API_INTERNAL_URL ?? process.env.API_PUBLIC_URL ?? "http://localhost:4000";
  const response = await fetch(new URL("/v1/public/pricing", apiUrl), {
    headers: country ? { "cf-ipcountry": country } : {},
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Published pricing is temporarily unavailable.");
  const payload = (await response.json()) as { data?: MarketingPricingReadModel };
  if (!payload.data || !Array.isArray(payload.data.terms)) {
    throw new Error("Published pricing is temporarily unavailable.");
  }
  return payload.data;
}
