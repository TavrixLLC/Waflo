import type { MetadataRoute } from "next";
import { isStagingDeployment, marketingOrigin } from "../lib/seo";

export function marketingRobots(deploymentEnvironment?: string): MetadataRoute.Robots {
  if (isStagingDeployment(deploymentEnvironment)) {
    return {
      rules: { userAgent: "*", disallow: "/" },
    };
  }

  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${marketingOrigin}/sitemap.xml`,
    host: marketingOrigin,
  };
}

export default function robots(): MetadataRoute.Robots {
  return marketingRobots(process.env.DEPLOYMENT_ENVIRONMENT);
}
