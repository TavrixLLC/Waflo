"use client";

import type { InterfaceLocale } from "@waflo/i18n";
import { apiFetch } from "./api-client";

export const oauthInterfaceLocaleKey = "waflo:oauth-interface-locale";
export const oauthReturnPathKey = "waflo:oauth-return-path";

export async function beginGoogleReauthentication(locale: InterfaceLocale, returnPath: string) {
  sessionStorage.setItem(oauthInterfaceLocaleKey, locale);
  sessionStorage.setItem(oauthReturnPathKey, returnPath);
  try {
    const result = await apiFetch<{ authorizationUrl: string }>(
      "/v1/auth/external/google/reauthenticate",
      {
        method: "POST",
        body: JSON.stringify({ locale: locale === "ar" ? "ar" : "en" }),
      },
    );
    window.location.assign(result.authorizationUrl);
  } catch (error) {
    sessionStorage.removeItem(oauthReturnPathKey);
    throw error;
  }
}

export function safeOAuthReturnPath(value: string | null, locale: InterfaceLocale): string | null {
  if (!value?.startsWith("/") || value.startsWith("//")) return null;
  const parsed = new URL(value, "https://waflo.local");
  const dashboardRoot = `/${locale}/dashboard`;
  if (parsed.pathname !== dashboardRoot && !parsed.pathname.startsWith(`${dashboardRoot}/`)) {
    return null;
  }
  return `${parsed.pathname}${parsed.search}`;
}
