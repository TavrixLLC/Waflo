import type { MetadataRoute } from "next";
import { alternateMarketingUrls, localizedMarketingUrl, publicMarketingPaths } from "../lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return publicMarketingPaths.flatMap((path) => {
    const locales = path
      ? (["en", "ar"] as const)
      : (["en", "ar", "ku-badini", "ku-sorani"] as const);
    return locales.map((locale) => ({
      url: localizedMarketingUrl(locale, path),
      alternates: { languages: alternateMarketingUrls(path) },
    }));
  });
}
