export const walletProviderCodes = ["APPLE", "GOOGLE"] as const;
export type WalletProviderCode = (typeof walletProviderCodes)[number];

export const walletProviderModes = ["DISABLED", "TEST_ADAPTER", "REAL"] as const;
export type WalletProviderMode = (typeof walletProviderModes)[number];

export const walletErrorCategories = [
  "NOT_CONFIGURED",
  "AUTHENTICATION_FAILED",
  "PERMISSION_DENIED",
  "TEMPLATE_INVALID",
  "OBJECT_INVALID",
  "ALREADY_EXISTS",
  "NOT_FOUND",
  "RATE_LIMITED",
  "TEMPORARY_FAILURE",
  "PERMANENT_FAILURE",
  "SIGNING_FAILED",
  "PROVIDER_UNAVAILABLE",
  "MESSAGE_CAPACITY_REACHED",
] as const;
export type WalletErrorCategory = (typeof walletErrorCategories)[number];

export type WalletUpdateReason =
  | "MEMBERSHIP_CREATED"
  | "WALLET_REQUESTED"
  | "PROGRAM_PAUSED"
  | "PROGRAM_RESUMED"
  | "PROGRAM_ARCHIVED"
  | "PROGRAM_SUSPENDED"
  | "MEMBERSHIP_SUSPENDED"
  | "MEMBERSHIP_EXPIRED"
  | "MEMBERSHIP_TRANSFERRED"
  | "CUSTOMER_NAME_CHANGED"
  | "NEARBY_RELEVANCE_CHANGED"
  | "RECONCILIATION";

export const WALLET_NEARBY_LOCATION_LIMIT = 10;
export const APPLE_NEARBY_DESIRED_MAX_DISTANCE_METERS = 2_000;
export const WALLET_NEARBY_TEXT_MAX_CODE_POINTS = 120;

export type WalletNearbyVertical =
  | "COFFEE"
  | "RESTAURANT"
  | "BARBER"
  | "SALON"
  | "BAKERY"
  | "GYM"
  | "RETAIL"
  | "GENERAL";

export interface WalletNearbyLocationInput {
  readonly locationId: string;
  readonly displayName: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly relevantText: string;
}

export interface WalletNearbyRelevanceInput {
  readonly enabled: boolean;
  readonly desiredAppleMaxDistanceMeters: number;
  readonly locations: readonly WalletNearbyLocationInput[];
}

const nearbyTemplateVerticalByCode: Readonly<Record<string, WalletNearbyVertical>> = {
  COFFEE: "COFFEE",
  COFFEE_DARK_ESPRESSO: "COFFEE",
  COFFEE_WARM_LATTE: "COFFEE",
  COFFEE_MODERN_CAFE: "COFFEE",
  COOKIES: "BAKERY",
  BAKERY: "BAKERY",
  BAKERY_ARTISAN: "BAKERY",
  BAKERY_SWEET_TREAT: "BAKERY",
  BAKERY_SOFT_PASTRY: "BAKERY",
  PIZZA: "RESTAURANT",
  RESTAURANT: "RESTAURANT",
  RESTAURANT_MODERN_BISTRO: "RESTAURANT",
  RESTAURANT_CLASSIC_TABLE: "RESTAURANT",
  RESTAURANT_QUICK_BITES: "RESTAURANT",
  BARBERSHOP: "BARBER",
  BARBERSHOP_DARK_GROOMING: "BARBER",
  BARBERSHOP_MODERN_CUT: "BARBER",
  BARBERSHOP_HERITAGE: "BARBER",
  SALON: "SALON",
  SALON_LUXURY_BEAUTY: "SALON",
  SALON_MODERN_NAILS: "SALON",
  SALON_MINIMAL_SPA: "SALON",
  FITNESS: "GYM",
  RETAIL: "RETAIL",
  RETAIL_BOLD: "RETAIL",
  RETAIL_PREMIUM_MEMBER: "RETAIL",
  RETAIL_MINIMAL_STORE: "RETAIL",
};

const nearbyCopy: Readonly<Record<WalletNearbyVertical, Readonly<Record<"en" | "ar", string>>>> = {
  COFFEE: {
    en: "You’re near {merchant}. Your loyalty card is ready for your next coffee visit.",
    ar: "أنت بالقرب من {merchant}. بطاقة الولاء جاهزة لزيارتك القادمة.",
  },
  RESTAURANT: {
    en: "You’re near {merchant}. Your loyalty card is ready for your next visit.",
    ar: "أنت بالقرب من {merchant}. بطاقة الولاء جاهزة لزيارتك القادمة.",
  },
  BARBER: {
    en: "You’re near {merchant}. Your loyalty card is ready when you are.",
    ar: "أنت بالقرب من {merchant}. بطاقة الولاء جاهزة لزيارتك القادمة.",
  },
  SALON: {
    en: "You’re near {merchant}. Your loyalty card is ready for your next visit.",
    ar: "أنت بالقرب من {merchant}. بطاقة الولاء جاهزة لزيارتك القادمة.",
  },
  BAKERY: {
    en: "You’re near {merchant}. Your loyalty card is ready for your next bakery visit.",
    ar: "أنت بالقرب من {merchant}. بطاقة الولاء جاهزة لزيارتك القادمة.",
  },
  GYM: {
    en: "You’re near {merchant}. Your membership card is ready for your next check-in.",
    ar: "أنت بالقرب من {merchant}. بطاقة العضوية جاهزة لزيارتك القادمة.",
  },
  RETAIL: {
    en: "You’re near {merchant}. Your loyalty card is ready for your next visit.",
    ar: "أنت بالقرب من {merchant}. بطاقة الولاء جاهزة لزيارتك القادمة.",
  },
  GENERAL: {
    en: "You’re near {merchant}. Your loyalty card is ready for your next visit.",
    ar: "أنت بالقرب من {merchant}. بطاقة الولاء جاهزة لزيارتك القادمة.",
  },
};

const unsafeWalletText = /[\p{Cc}\p{Cs}\u202a-\u202e\u2066-\u2069<>]/u;
const credentialLikeWalletText =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk_(?:live|test)_[0-9a-z_-]{12,}|\bAIza[0-9a-z_-]{20,}|\bgh[pousr]_[0-9a-z]{20,}|\bAKIA[0-9A-Z]{16}\b/iu;
const unsupportedNearbyOfferClaim =
  /\b(?:guaranteed?|discount|free)\b|\u062e\u0635\u0645|\u0645\u0636\u0645\u0648\u0646|\u0645\u062c\u0627\u0646(?:\u0627|\u064a|\u064a\u0629)?/iu;

export function walletTextCodePointLength(value: string): number {
  return Array.from(value).length;
}

export function normalizeWalletPlainText(value: string, maxCodePoints: number): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\t\n\r ]+/gu, " ")
    .trim();
  if (!normalized) throw new Error("Wallet message text is required.");
  if (unsafeWalletText.test(normalized)) {
    throw new Error("Wallet message text contains unsupported characters or markup.");
  }
  if (/\{\{|\}\}|\$\{|<\/?[a-z]/iu.test(normalized)) {
    throw new Error("Customer templates and markup are not supported.");
  }
  if (credentialLikeWalletText.test(normalized)) {
    throw new Error("Credentials and secrets are not supported in Wallet messages.");
  }
  if (walletTextCodePointLength(normalized) > maxCodePoints) {
    throw new Error(`Wallet message text exceeds ${maxCodePoints} characters.`);
  }
  return normalized;
}

export function walletNearbyVertical(input: {
  templateCode?: string | null | undefined;
  businessCategory?: string | null | undefined;
}): WalletNearbyVertical {
  const byTemplate = input.templateCode
    ? nearbyTemplateVerticalByCode[input.templateCode.toUpperCase()]
    : undefined;
  if (byTemplate) return byTemplate;
  const category = (input.businessCategory ?? "").normalize("NFKC").toLocaleLowerCase("en-US");
  if (/coffee|cafe|café|قهو|مقهى/u.test(category)) return "COFFEE";
  if (/restaurant|dining|bistro|pizza|مطعم/u.test(category)) return "RESTAURANT";
  if (/barber|groom|حلاق/u.test(category)) return "BARBER";
  if (/salon|beauty|nail|spa|صالون|تجميل/u.test(category)) return "SALON";
  if (/bakery|bake|bread|cookie|مخبز|حلويات/u.test(category)) return "BAKERY";
  if (/gym|fitness|training|نادي|لياقة/u.test(category)) return "GYM";
  if (/retail|shop|store|متجر|تجزئة/u.test(category)) return "RETAIL";
  return "GENERAL";
}

function safeNearbyName(value: string | null | undefined, locale: "en" | "ar"): string {
  try {
    return normalizeWalletPlainText(value ?? "", 80);
  } catch {
    return locale === "ar" ? "هذا النشاط" : "this business";
  }
}

function interpolateNearbyText(
  template: string,
  merchantName: string,
  locationName: string | undefined,
): string {
  const allowed = template
    .replaceAll("{merchant}", merchantName)
    .replaceAll("{location}", locationName ?? "");
  if (/\{[^{}]+\}/u.test(allowed)) throw new Error("Unsupported nearby-message variable.");
  return allowed.replace(/[\t\n\r ]+/gu, " ").trim();
}

export function resolveWalletNearbyText(input: {
  templateCode?: string | null | undefined;
  businessCategory?: string | null | undefined;
  merchantName?: string | null | undefined;
  locationName?: string | null | undefined;
  locale: "en" | "ar";
  customText?: string | null | undefined;
}): { text: string; vertical: WalletNearbyVertical; usedCustomText: boolean } {
  const vertical = walletNearbyVertical(input);
  const merchant = safeNearbyName(input.merchantName, input.locale);
  const location = input.locationName
    ? safeNearbyName(input.locationName, input.locale)
    : undefined;
  const source = input.customText
    ? normalizeWalletPlainText(input.customText, WALLET_NEARBY_TEXT_MAX_CODE_POINTS)
    : nearbyCopy[vertical][input.locale];
  if (input.customText && unsupportedNearbyOfferClaim.test(source)) {
    throw new Error("Nearby wording cannot make unverified offer or discount claims.");
  }
  const text = interpolateNearbyText(source, merchant, location);
  if (walletTextCodePointLength(text) > WALLET_NEARBY_TEXT_MAX_CODE_POINTS) {
    const fallback = interpolateNearbyText(nearbyCopy[vertical][input.locale], merchant, undefined);
    if (walletTextCodePointLength(fallback) <= WALLET_NEARBY_TEXT_MAX_CODE_POINTS) {
      return { text: fallback, vertical, usedCustomText: false };
    }
    const clipped = Array.from(fallback)
      .slice(0, WALLET_NEARBY_TEXT_MAX_CODE_POINTS - 1)
      .join("");
    return { text: `${clipped}…`, vertical, usedCustomText: false };
  }
  return { text, vertical, usedCustomText: Boolean(input.customText) };
}

export interface WalletProviderHealth {
  readonly provider: WalletProviderCode;
  readonly mode: WalletProviderMode;
  readonly status:
    | "NOT_CONFIGURED"
    | "HEALTHY"
    | "DEGRADED"
    | "CERTIFICATE_EXPIRING"
    | "CERTIFICATE_EXPIRED"
    | "CREDENTIAL_INVALID"
    | "ISSUER_ACCESS_DENIED"
    | "API_UNAVAILABLE"
    | "RATE_LIMITED"
    | "EXTERNALLY_UNCERTIFIED"
    | "AUTHENTICATION_FAILED"
    | "PERMISSION_DENIED"
    | "PROVIDER_UNAVAILABLE";
  readonly checkedAt: string;
  readonly safeMessage: string;
  readonly demo: boolean;
  readonly configured?: boolean;
  readonly providerReachable?: boolean;
  readonly externallyCertified?: boolean;
  readonly certificateExpiresAt?: string;
}

export interface WalletProgramInput {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly programId: string;
  readonly programVersionId: string;
  readonly programName: string;
  readonly description: string;
  readonly rewardSummary: string;
  readonly backgroundColor: string;
  readonly foregroundColor: string;
  readonly programLogoUrl?: string;
  readonly publicAssetBaseUrl?: string;
  readonly configurationFingerprint: string;
  /** Locale selected for this membership/pass instance. */
  readonly locale: string;
  /** Published card-version source of truth, independent of provider identifiers. */
  readonly defaultLocale?: string;
  readonly localizedContent?: ReadonlyArray<{
    readonly locale: string;
    readonly programName: string;
    readonly description: string;
    readonly rewardSummary: string;
  }>;
  readonly nearbyRelevance?: WalletNearbyRelevanceInput;
}

export interface WalletPromotionalMessageInput {
  readonly messageId: string;
  readonly locale: "en" | "ar";
  readonly title: string;
  readonly body: string;
  readonly destinationUrl?: string;
  readonly obsoleteMessageIds?: readonly string[];
}

export interface WalletPromotionalMessageResult {
  readonly state: "STORED_AND_NOTIFIED" | "NO_ACTIVE_WALLET_HOLDER";
  readonly providerRequestId?: string;
}

export interface WalletMembershipInput extends WalletProgramInput {
  readonly walletPassInstanceId: string;
  readonly providerIdentity: string;
  readonly publicMembershipId: string;
  readonly displayName: string;
  readonly credentialPayload: string;
  readonly currentStampCount: number;
  readonly requiredStampCount: number;
  readonly rewardReady: boolean;
  readonly membershipStatus: "ACTIVE" | "SUSPENDED" | "EXPIRED" | "REVOKED";
  readonly programStatus:
    | "PUBLISHED"
    | "PAUSED"
    | "ARCHIVED"
    | "SUSPENDED"
    | "SCHEDULED"
    | "DRAFT"
    | "VALIDATED"
    | "TEST";
  readonly transferred: boolean;
  readonly stampRenderInput: PublishedMembershipStampRenderInput;
  /** Provider-correct, generated branding images for an Apple pass package. */
  readonly applePassImages?: Readonly<Record<string, Uint8Array>>;
}

export interface WalletProgramTemplateResult {
  readonly providerTemplateId: string;
  readonly state: string;
  readonly fingerprint: string;
  readonly providerRequestId?: string;
}

export interface WalletIssueResult {
  readonly providerObjectId: string;
  readonly state: "ISSUED" | "ACTIVE";
  readonly providerRequestId?: string;
  readonly artifact?: Uint8Array;
  readonly safeMetadata?: Readonly<Record<string, unknown>>;
}

export interface WalletAddAction {
  readonly mode: WalletProviderMode;
  readonly url: string;
  readonly expiresAt?: string;
  readonly testAdapter: boolean;
}

export interface WalletUpdateResult {
  readonly state: string;
  readonly updateTag?: string;
  readonly providerRequestId?: string;
}

export interface WalletInvalidateResult {
  readonly state: "INVALIDATED" | "INACTIVE" | "EXPIRED";
  readonly providerRequestId?: string;
}

export interface WalletReconcileResult {
  readonly state: string;
  readonly changed: boolean;
  readonly providerRequestId?: string;
}

export interface WalletProvider {
  readonly provider: WalletProviderCode;
  readonly mode: WalletProviderMode;
  healthCheck(): Promise<WalletProviderHealth>;
  ensureProgramTemplate(input: WalletProgramInput): Promise<WalletProgramTemplateResult>;
  issueMembershipPass(input: WalletMembershipInput): Promise<WalletIssueResult>;
  createAddToWalletAction(input: WalletMembershipInput): Promise<WalletAddAction>;
  updateMembershipPass(
    input: WalletMembershipInput,
    reason: WalletUpdateReason,
  ): Promise<WalletUpdateResult>;
  invalidateMembershipPass(
    input: WalletMembershipInput,
    reason: WalletUpdateReason,
  ): Promise<WalletInvalidateResult>;
  reconcileMembershipPass(input: WalletMembershipInput): Promise<WalletReconcileResult>;
  sendPromotionalMessage?(
    input: Pick<WalletMembershipInput, "providerIdentity">,
    message: WalletPromotionalMessageInput,
  ): Promise<WalletPromotionalMessageResult>;
}

export class WalletProviderError extends Error {
  constructor(
    readonly category: WalletErrorCategory,
    message: string,
    readonly options: {
      retryable: boolean;
      providerRequestId?: string;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "WalletProviderError";
  }
}

export function normalizeWalletProviderError(error: unknown): WalletProviderError {
  if (error instanceof WalletProviderError) return error;
  const status =
    error && typeof error === "object" && "status" in error ? Number(error.status) : undefined;
  if (status === 401) {
    return new WalletProviderError("AUTHENTICATION_FAILED", "Provider authentication failed.", {
      retryable: false,
      cause: error,
    });
  }
  if (status === 403) {
    return new WalletProviderError("PERMISSION_DENIED", "Provider access was denied.", {
      retryable: false,
      cause: error,
    });
  }
  if (status === 404) {
    return new WalletProviderError("NOT_FOUND", "Provider resource was not found.", {
      retryable: false,
      cause: error,
    });
  }
  if (status === 409) {
    return new WalletProviderError("ALREADY_EXISTS", "Provider resource already exists.", {
      retryable: false,
      cause: error,
    });
  }
  if (status === 429) {
    return new WalletProviderError("RATE_LIMITED", "Provider rate limit reached.", {
      retryable: true,
      cause: error,
    });
  }
  if (status !== undefined && status >= 500) {
    return new WalletProviderError("TEMPORARY_FAILURE", "Provider is temporarily unavailable.", {
      retryable: true,
      cause: error,
    });
  }
  return new WalletProviderError("PERMANENT_FAILURE", "Wallet provider operation failed.", {
    retryable: false,
    cause: error,
  });
}

export function walletCommandIdempotencyKey(input: {
  provider: WalletProviderCode;
  commandType: string;
  membershipId: string;
  credentialVersion: number;
  projectionVersion?: number;
}): string {
  return [
    "wallet",
    input.provider.toLocaleLowerCase("en-US"),
    input.commandType.toLocaleLowerCase("en-US"),
    input.membershipId,
    `c${input.credentialVersion}`,
    `p${input.projectionVersion ?? 0}`,
  ].join(":");
}

import type { PublishedMembershipStampRenderInput } from "@waflo/stamp-engine";
