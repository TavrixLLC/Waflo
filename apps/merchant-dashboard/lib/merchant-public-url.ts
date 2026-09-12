const explicitCustomerUrl = process.env.NEXT_PUBLIC_CUSTOMER_URL?.trim();
const configuredCustomerUrl =
  explicitCustomerUrl ||
  (process.env.NEXT_PUBLIC_API_URL?.includes("api-staging.waflo.app")
    ? "https://card-staging.waflo.app"
    : process.env.NODE_ENV === "production"
      ? "https://card.waflo.app"
      : "http://localhost:3002");

function normalizedSlug(slug: string): string {
  return slug
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9-]/g, "");
}

function usesSharedTenantRoute(hostname: string): boolean {
  return (
    hostname === "card-staging.waflo.app" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

/**
 * Builds the customer-facing merchant URL for the current deployment.
 * Staging and local development use the shared customer host, while production
 * uses the canonical merchant subdomain.
 */
export function merchantPublicUrlForBase(slug: string, customerUrl: string): string {
  const merchantSlug = normalizedSlug(slug);
  const url = new URL(customerUrl);

  url.pathname = "/";
  url.search = "";
  url.hash = "";

  if (usesSharedTenantRoute(url.hostname)) {
    if (merchantSlug) url.searchParams.set("tenant", merchantSlug);
    return url.toString();
  }

  if (merchantSlug) {
    if (url.hostname === "card.waflo.app") {
      url.hostname = `${merchantSlug}.waflo.app`;
    } else if (url.hostname.startsWith("card.")) {
      url.hostname = `${merchantSlug}.${url.hostname.slice("card.".length)}`;
    } else {
      url.searchParams.set("tenant", merchantSlug);
    }
  }

  return url.toString();
}

export function merchantPublicUrl(slug: string): string {
  return merchantPublicUrlForBase(slug, configuredCustomerUrl);
}
