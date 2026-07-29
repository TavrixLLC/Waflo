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
  | "RECONCILIATION";

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
  readonly locale: "en" | "ar";
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
