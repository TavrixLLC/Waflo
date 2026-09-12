const slugPattern = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/;

export const reservedSlugs = new Set([
  "www",
  "app",
  "api",
  "card",
  "app-staging",
  "api-staging",
  "card-staging",
  "admin",
  "dashboard",
  "billing",
  "support",
  "help",
  "docs",
  "status",
  "mail",
  "smtp",
  "imap",
  "pop",
  "assets",
  "static",
  "media",
  "cdn",
  "auth",
  "login",
  "logout",
  "signup",
  "register",
  "account",
  "accounts",
  "developer",
  "developers",
  "test",
  "testing",
  "stage",
  "staging",
  "production",
  "prod",
  "local",
  "localhost",
  "tavrix",
  "waflo",
  "wallet",
  "apple",
  "google",
  "stripe",
  "customer",
  "customers",
  "merchant",
  "merchants",
  "staff",
  "team",
  "security",
  "privacy",
  "terms",
  "contact",
  "m",
  "mobile",
  "marketing",
]);

export function normalizeSlug(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function isSlugFormatValid(slug: string): boolean {
  return slugPattern.test(slug) && !slug.startsWith("xn--");
}

export function validateSlug(value: string): { valid: boolean; slug: string; reason?: string } {
  const slug = normalizeSlug(value);
  if (!isSlugFormatValid(slug)) {
    return { valid: false, slug, reason: "SLUG_FORMAT_INVALID" };
  }
  if (reservedSlugs.has(slug)) {
    return { valid: false, slug, reason: "SLUG_RESERVED" };
  }
  return { valid: true, slug };
}

export function oldSlugReservedUntil(releasedAt: Date, cooldownDays = 90): Date {
  return new Date(releasedAt.getTime() + cooldownDays * 24 * 60 * 60 * 1000);
}
