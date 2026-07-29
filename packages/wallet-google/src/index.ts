import { createHash, createSign } from "node:crypto";
import {
  type WalletAddAction,
  type WalletInvalidateResult,
  type WalletIssueResult,
  type WalletMembershipInput,
  type WalletProgramInput,
  type WalletProgramTemplateResult,
  type WalletProvider,
  WalletProviderError,
  type WalletProviderHealth,
  type WalletProviderMode,
  type WalletReconcileResult,
  type WalletUpdateReason,
  type WalletUpdateResult,
  normalizeWalletProviderError,
} from "@waflo/wallet-core";

export interface GoogleServiceAccount {
  readonly client_email: string;
  readonly private_key: string;
  readonly token_uri?: string;
}

function suffix(value: string): string {
  const compact = value.replaceAll("-", "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!compact) throw new Error("Google Wallet identifier cannot be empty.");
  return compact;
}

export function googleLoyaltyClassId(
  issuerId: string,
  programVersionId: string,
  schemaVersion = 1,
): string {
  return `${issuerId}.waflo_loyalty_v${schemaVersion}_${suffix(programVersionId)}`;
}

export function googleLoyaltyObjectId(
  issuerId: string,
  walletPassInstanceId: string,
  schemaVersion = 1,
): string {
  return `${issuerId}.waflo_member_v${schemaVersion}_${suffix(walletPassInstanceId)}`;
}

function translated(value: string, locale: "en" | "ar") {
  return {
    defaultValue: {
      language: locale === "ar" ? "ar" : "en-US",
      value,
    },
  };
}

export function mapGoogleLoyaltyClass(input: WalletProgramInput, classId: string) {
  return {
    id: classId,
    issuerName: input.organizationName.slice(0, 60),
    programName: input.programName.slice(0, 60),
    reviewStatus: "UNDER_REVIEW",
    hexBackgroundColor: input.backgroundColor,
    ...(input.programLogoUrl
      ? {
          programLogo: {
            sourceUri: { uri: input.programLogoUrl },
            contentDescription: translated(`${input.programName} logo`, input.locale),
          },
        }
      : {}),
    localizedIssuerName: translated(input.organizationName.slice(0, 60), input.locale),
    localizedProgramName: translated(input.programName.slice(0, 60), input.locale),
    textModulesData: [
      { id: "reward", header: "Reward", body: input.rewardSummary.slice(0, 500) },
      {
        id: "waflo",
        header: "Operator",
        body: "Waflo is owned and operated by Tavrix LLC.",
      },
    ],
  };
}

export function mapGoogleLoyaltyObject(
  input: WalletMembershipInput,
  objectId: string,
  classId: string,
) {
  const inactive =
    input.transferred ||
    input.membershipStatus !== "ACTIVE" ||
    input.programStatus === "ARCHIVED" ||
    input.programStatus === "SUSPENDED";
  return {
    id: objectId,
    classId,
    state: inactive ? "INACTIVE" : "ACTIVE",
    accountName: input.displayName.slice(0, 20),
    accountId: input.publicMembershipId.slice(-20),
    loyaltyPoints: {
      label: "Stamps",
      balance: { string: `${input.currentStampCount}/${input.requiredStampCount}` },
    },
    barcode: {
      type: "QR_CODE",
      value: input.credentialPayload,
      alternateText: inactive ? "No longer valid" : input.publicMembershipId.slice(-12),
    },
    ...(input.publicAssetBaseUrl
      ? {
          imageModulesData: [
            {
              id: "waflo-progress",
              mainImage: {
                sourceUri: { uri: input.publicAssetBaseUrl },
                contentDescription: translated("Stamp progress", input.locale),
              },
            },
          ],
        }
      : {}),
    textModulesData: [
      {
        id: "status",
        header: "Status",
        body: input.transferred
          ? "Transferred — no longer valid"
          : input.programStatus === "PAUSED"
            ? "Program temporarily paused"
            : input.rewardReady
              ? "Reward ready"
              : "Active",
      },
    ],
  };
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function createGoogleSaveJwt(input: {
  readonly serviceAccount: GoogleServiceAccount;
  readonly objectId: string;
  readonly allowedOrigins: readonly string[];
  readonly issuedAt?: number;
}): { token: string; claims: Readonly<Record<string, unknown>> } {
  const iat = input.issuedAt ?? Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: input.serviceAccount.client_email,
    aud: "google",
    typ: "savetowallet",
    iat,
    origins: [...input.allowedOrigins],
    payload: { loyaltyObjects: [{ id: input.objectId }] },
  };
  const unsigned = `${encodeJson(header)}.${encodeJson(claims)}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .end()
    .sign(input.serviceAccount.private_key)
    .toString("base64url");
  return { token: `${unsigned}.${signature}`, claims };
}

export function googleSaveUrl(token: string): string {
  return `https://pay.google.com/gp/v/save/${token}`;
}

export function googleConfigurationFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export class GoogleWalletRestClient {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly serviceAccount: GoogleServiceAccount,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  private async token(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.accessToken && this.accessToken.expiresAt - 60 > now) return this.accessToken.value;
    const assertionClaims = {
      iss: this.serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/wallet_object.issuer",
      aud: this.serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    };
    const header = { alg: "RS256", typ: "JWT" };
    const unsigned = `${encodeJson(header)}.${encodeJson(assertionClaims)}`;
    const signature = createSign("RSA-SHA256")
      .update(unsigned)
      .end()
      .sign(this.serviceAccount.private_key)
      .toString("base64url");
    const response = await this.fetchImplementation(
      this.serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: `${unsigned}.${signature}`,
        }),
      },
    );
    if (!response.ok) {
      throw new WalletProviderError(
        response.status === 401 ? "AUTHENTICATION_FAILED" : "PROVIDER_UNAVAILABLE",
        "Google Wallet authentication failed.",
        { retryable: response.status >= 500 },
      );
    }
    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) {
      throw new WalletProviderError(
        "AUTHENTICATION_FAILED",
        "Google Wallet authentication returned no access token.",
        { retryable: false },
      );
    }
    this.accessToken = {
      value: payload.access_token,
      expiresAt: now + (payload.expires_in ?? 3600),
    };
    return payload.access_token;
  }

  async request<T>(
    path: string,
    options: { method?: "GET" | "POST" | "PATCH"; body?: unknown } = {},
  ): Promise<{ value: T; requestId?: string }> {
    const response = await this.fetchImplementation(
      `https://walletobjects.googleapis.com/walletobjects/v1/${path.replace(/^\/+/, "")}`,
      {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${await this.token()}`,
          accept: "application/json",
          ...(options.body ? { "content-type": "application/json" } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      },
    );
    const requestId = response.headers.get("x-request-id") ?? undefined;
    if (!response.ok) {
      throw new WalletProviderError(
        response.status === 401
          ? "AUTHENTICATION_FAILED"
          : response.status === 403
            ? "PERMISSION_DENIED"
            : response.status === 404
              ? "NOT_FOUND"
              : response.status === 409
                ? "ALREADY_EXISTS"
                : response.status === 429
                  ? "RATE_LIMITED"
                  : response.status >= 500
                    ? "TEMPORARY_FAILURE"
                    : "PERMANENT_FAILURE",
        "Google Wallet request failed.",
        {
          retryable: response.status === 429 || response.status >= 500,
          ...(requestId ? { providerRequestId: requestId } : {}),
        },
      );
    }
    return {
      value: (await response.json()) as T,
      ...(requestId ? { requestId } : {}),
    };
  }
}

export interface GoogleWalletProviderOptions {
  readonly mode: WalletProviderMode;
  readonly issuerId?: string;
  readonly serviceAccount?: GoogleServiceAccount;
  readonly allowedOrigins: readonly string[];
  readonly testActionBaseUrl: string;
  readonly client?: GoogleWalletRestClient;
}

export class GoogleWalletProvider implements WalletProvider {
  readonly provider = "GOOGLE" as const;
  readonly mode: WalletProviderMode;
  private readonly client: GoogleWalletRestClient | null;
  private healthCache: { expiresAt: number; value: WalletProviderHealth } | null = null;

  constructor(private readonly options: GoogleWalletProviderOptions) {
    this.mode = options.mode;
    this.client =
      options.client ??
      (options.mode === "REAL" && options.serviceAccount
        ? new GoogleWalletRestClient(options.serviceAccount)
        : null);
  }

  async healthCheck(): Promise<WalletProviderHealth> {
    if (this.mode === "REAL" && this.healthCache && this.healthCache.expiresAt > Date.now()) {
      return this.healthCache.value;
    }
    const value = await this.uncachedHealthCheck();
    if (this.mode === "REAL") {
      this.healthCache = { expiresAt: Date.now() + 60_000, value };
    }
    return value;
  }

  private async uncachedHealthCheck(): Promise<WalletProviderHealth> {
    const checkedAt = new Date().toISOString();
    if (this.mode === "DISABLED") {
      return {
        provider: this.provider,
        mode: this.mode,
        status: "NOT_CONFIGURED",
        checkedAt,
        safeMessage: "Google Wallet is disabled.",
        demo: false,
      };
    }
    if (!this.options.issuerId || (this.mode === "REAL" && !this.options.serviceAccount)) {
      return {
        provider: this.provider,
        mode: this.mode,
        status: "NOT_CONFIGURED",
        checkedAt,
        safeMessage: "Google Wallet issuer configuration is incomplete.",
        demo: this.mode === "TEST_ADAPTER",
      };
    }
    if (this.mode === "REAL" && this.client) {
      try {
        await this.client.request(`issuer/${encodeURIComponent(this.options.issuerId)}`);
      } catch (error) {
        const normalized = normalizeWalletProviderError(error);
        const status =
          normalized.category === "AUTHENTICATION_FAILED"
            ? "CREDENTIAL_INVALID"
            : normalized.category === "PERMISSION_DENIED" || normalized.category === "NOT_FOUND"
              ? "ISSUER_ACCESS_DENIED"
              : normalized.category === "RATE_LIMITED"
                ? "RATE_LIMITED"
                : "API_UNAVAILABLE";
        return {
          provider: this.provider,
          mode: this.mode,
          status,
          checkedAt,
          safeMessage:
            status === "CREDENTIAL_INVALID"
              ? "Google Wallet credentials were rejected."
              : status === "ISSUER_ACCESS_DENIED"
                ? "Google Wallet issuer access was denied."
                : status === "RATE_LIMITED"
                  ? "Google Wallet health verification was rate limited."
                  : "Google Wallet API could not be reached.",
          demo: false,
          configured: true,
          providerReachable: false,
          externallyCertified: false,
        };
      }
    }
    return {
      provider: this.provider,
      mode: this.mode,
      status: "HEALTHY",
      checkedAt,
      safeMessage:
        this.mode === "TEST_ADAPTER"
          ? "Google Wallet Test Adapter is ready. No Google save is claimed."
          : "Google Wallet authenticated issuer access was verified.",
      demo: this.mode === "TEST_ADAPTER",
      configured: true,
      providerReachable: this.mode === "REAL",
      externallyCertified: false,
    };
  }

  async ensureProgramTemplate(input: WalletProgramInput): Promise<WalletProgramTemplateResult> {
    const issuerId = this.requireIssuer();
    const classId = googleLoyaltyClassId(issuerId, input.programVersionId);
    const intended = mapGoogleLoyaltyClass(input, classId);
    if (this.mode === "REAL" && this.client) {
      try {
        await this.client.request(`loyaltyClass/${encodeURIComponent(classId)}`);
        await this.client.request(`loyaltyClass/${encodeURIComponent(classId)}`, {
          method: "PATCH",
          body: intended,
        });
      } catch (error) {
        if (error instanceof WalletProviderError && error.category === "NOT_FOUND") {
          await this.client.request("loyaltyClass", { method: "POST", body: intended });
        } else {
          throw error;
        }
      }
    }
    return {
      providerTemplateId: classId,
      state: this.mode === "TEST_ADAPTER" ? "TEST_READY" : "READY",
      fingerprint: googleConfigurationFingerprint(intended),
    };
  }

  async issueMembershipPass(input: WalletMembershipInput): Promise<WalletIssueResult> {
    const issuerId = this.requireIssuer();
    const classId = googleLoyaltyClassId(issuerId, input.programVersionId);
    const object = mapGoogleLoyaltyObject(input, input.providerIdentity, classId);
    if (this.mode === "REAL" && this.client) {
      try {
        await this.client.request(`loyaltyObject/${encodeURIComponent(input.providerIdentity)}`);
        await this.client.request(`loyaltyObject/${encodeURIComponent(input.providerIdentity)}`, {
          method: "PATCH",
          body: object,
        });
      } catch (error) {
        if (error instanceof WalletProviderError && error.category === "NOT_FOUND") {
          await this.client.request("loyaltyObject", { method: "POST", body: object });
        } else {
          throw error;
        }
      }
    }
    return {
      providerObjectId: input.providerIdentity,
      state: "ACTIVE",
      safeMetadata: {
        mode: this.mode,
        classId,
        objectState: object.state,
        fingerprint: googleConfigurationFingerprint(object),
      },
    };
  }

  async createAddToWalletAction(input: WalletMembershipInput): Promise<WalletAddAction> {
    this.requireIssuer();
    if (this.mode === "TEST_ADAPTER") {
      const url = new URL(this.options.testActionBaseUrl);
      url.searchParams.set("provider", "google-test-adapter");
      url.searchParams.set("object", input.providerIdentity);
      return { mode: this.mode, url: url.toString(), testAdapter: true };
    }
    if (!this.options.serviceAccount) throw new Error("Google service account is unavailable.");
    const { token } = createGoogleSaveJwt({
      serviceAccount: this.options.serviceAccount,
      objectId: input.providerIdentity,
      allowedOrigins: this.options.allowedOrigins,
    });
    return {
      mode: this.mode,
      url: googleSaveUrl(token),
      testAdapter: false,
    };
  }

  async updateMembershipPass(
    input: WalletMembershipInput,
    _reason: WalletUpdateReason,
  ): Promise<WalletUpdateResult> {
    await this.issueMembershipPass(input);
    return { state: "ACTIVE" };
  }

  async invalidateMembershipPass(
    input: WalletMembershipInput,
    _reason: WalletUpdateReason,
  ): Promise<WalletInvalidateResult> {
    const issuerId = this.requireIssuer();
    const classId = googleLoyaltyClassId(issuerId, input.programVersionId);
    const inactive = mapGoogleLoyaltyObject(
      { ...input, transferred: true },
      input.providerIdentity,
      classId,
    );
    if (this.mode === "REAL" && this.client) {
      await this.client.request(`loyaltyObject/${encodeURIComponent(input.providerIdentity)}`, {
        method: "PATCH",
        body: { state: "INACTIVE", textModulesData: inactive.textModulesData },
      });
    }
    return { state: "INACTIVE" };
  }

  async reconcileMembershipPass(input: WalletMembershipInput): Promise<WalletReconcileResult> {
    await this.issueMembershipPass(input);
    return { state: "ACTIVE", changed: false };
  }

  private requireIssuer(): string {
    if (this.mode === "DISABLED" || !this.options.issuerId) {
      throw new Error("Google Wallet is not configured.");
    }
    return this.options.issuerId;
  }
}
