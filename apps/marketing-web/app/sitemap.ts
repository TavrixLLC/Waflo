import type { MetadataRoute } from "next";
import { alternateMarketingUrls, localizedMarketingUrl, publicMarketingPaths } from "../lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return publicMarketingPaths.flatMap((path) =>
    (["en", "ar"] as const).map((locale) => ({
      url: localizedMarketingUrl(locale, path),
      alternates: { languages: alternateMarketingUrls(path) },
    })),
  );
}
