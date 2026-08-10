export interface PublicProgram {
  slug: string;
  status: string;
  enrollmentStatus: "OPEN" | "CLOSED" | "PROGRAM_UNAVAILABLE" | "MERCHANT_UNAVAILABLE";
  versionFingerprint: string;
  translations: Record<
    "en" | "ar",
    {
      programName: string;
      shortDescription: string;
      fullDescription?: string | null;
      rewardSummary: string;
      joinInstructions?: string | null;
      termsAndConditions: string;
      pausedMessage?: string | null;
    }
  >;
  goal: number;
  stampPreview: {
    dataUri: string;
    contentDigest: string;
    configurationDigest: string;
    width: number;
    height: number;
  };
  stampPreviews: Record<"en" | "ar", PublicProgram["stampPreview"]>;
  earningDescription: string;
  rewards: Array<{
    thresholdStampCount: number;
    translations: Record<"en" | "ar", { name: string; description: string }>;
  }>;
  locations: Array<{ name: string; city?: string | null; region?: string | null }>;
  theme: {
    backgroundColor: string;
    foregroundColor: string;
    accentColor: string;
    secondaryColor: string;
    layoutType: string;
  };
  policy: {
    emailCollectionMode: "HIDDEN" | "OPTIONAL" | "REQUIRED";
    primaryCustomerLocale: "en" | "ar";
    allowLocaleSelection: boolean;
    marketingConsentVisible: boolean;
    transferWithoutEmailAllowed: boolean;
  };
}

export function localeForRequest(
  requested: string | undefined,
  fallback: "en" | "ar" | undefined,
): "en" | "ar" {
  return requested === "en" || requested === "ar" ? requested : (fallback ?? "en");
}

export async function fetchCustomerApi<T>(path: string, host: string, tenant?: string): Promise<T> {
  const apiUrl =
    process.env.API_INTERNAL_URL ?? process.env.API_PUBLIC_URL ?? "http://localhost:4000";
  const url = new URL(path, apiUrl);
  const normalizedHost = host.toLocaleLowerCase("en-US").split(":")[0] ?? "";
  const localSuffix = [".localhost", ".lvh.me"].find((suffix) => normalizedHost.endsWith(suffix));
  const localHostTenant = localSuffix ? normalizedHost.slice(0, -localSuffix.length) : "";
  const effectiveTenant =
    tenant ??
    (/^[a-z0-9](?:[a-z0-9-]{0,47}[a-z0-9])?$/.test(localHostTenant) ? localHostTenant : undefined);
  if (effectiveTenant) url.searchParams.set("tenant", effectiveTenant);
  try {
    const response = await fetch(url, {
      headers: { host },
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      data?: T;
      error?: { message?: string };
    };
    if (!response.ok || payload.data === undefined) {
      throw new Error(payload.error?.message ?? "The customer service is unavailable.");
    }
    return payload.data;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("The customer service is unavailable.");
  }
}
