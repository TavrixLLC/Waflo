import { existsSync, readFileSync } from "node:fs";
import { Injectable } from "@nestjs/common";
import {
  AppleWalletProvider,
  Pkcs7ApplePassSigner,
  TestApplePassSigner,
  type ApplePassSigner,
} from "@waflo/wallet-apple";
import type { WalletProvider, WalletProviderCode, WalletProviderHealth } from "@waflo/wallet-core";
import { GoogleWalletProvider, type GoogleServiceAccount } from "@waflo/wallet-google";
import { EnvironmentService } from "../config/environment.service.js";
import { CustomerSecurityService } from "../customer/customer-security.service.js";

function bytesFromSource(value: string): Buffer {
  if (existsSync(value)) return readFileSync(value);
  return Buffer.from(value, "base64");
}

function textFromSource(value: string): string {
  if (existsSync(value)) return readFileSync(value, "utf8");
  return Buffer.from(value, "base64").toString("utf8");
}

function googleServiceAccount(value: string | undefined): GoogleServiceAccount | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(textFromSource(value)) as Partial<GoogleServiceAccount>;
    if (!parsed.client_email || !parsed.private_key?.includes("PRIVATE KEY")) {
      return undefined;
    }
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
      ...(parsed.token_uri ? { token_uri: parsed.token_uri } : {}),
    };
  } catch {
    return undefined;
  }
}

@Injectable()
export class WalletProviderRegistry {
  private readonly providers: ReadonlyMap<WalletProviderCode, WalletProvider>;
  private readonly configured: Readonly<Record<WalletProviderCode, boolean>>;
  private publicHealthCache:
    | { expiresAt: number; value: Promise<readonly WalletProviderHealth[]> }
    | undefined;

  constructor(environment: EnvironmentService, security: CustomerSecurityService) {
    const values = environment.values;
    let appleSigner: ApplePassSigner | undefined;
    if (values.APPLE_WALLET_MODE === "TEST_ADAPTER") {
      appleSigner = new TestApplePassSigner();
    } else if (
      values.APPLE_WALLET_MODE === "REAL" &&
      values.APPLE_PASS_CERTIFICATE_PATH_OR_BASE64 &&
      values.APPLE_PASS_CERTIFICATE_PASSWORD &&
      values.APPLE_WWDR_CERTIFICATE_PATH_OR_BASE64
    ) {
      try {
        appleSigner = new Pkcs7ApplePassSigner(
          bytesFromSource(values.APPLE_PASS_CERTIFICATE_PATH_OR_BASE64),
          values.APPLE_PASS_CERTIFICATE_PASSWORD,
          textFromSource(values.APPLE_WWDR_CERTIFICATE_PATH_OR_BASE64),
        );
      } catch {
        appleSigner = undefined;
      }
    }
    const appleReady =
      values.APPLE_WALLET_MODE === "TEST_ADAPTER" ||
      (values.APPLE_WALLET_MODE === "REAL" &&
        Boolean(
          appleSigner &&
            values.APPLE_PASS_TYPE_IDENTIFIER &&
            values.APPLE_TEAM_IDENTIFIER &&
            values.APPLE_PASS_WEB_SERVICE_URL,
        ));
    const effectiveAppleMode = appleReady ? values.APPLE_WALLET_MODE : "DISABLED";
    const appleConfiguration =
      effectiveAppleMode === "DISABLED"
        ? undefined
        : {
            passTypeIdentifier: values.APPLE_PASS_TYPE_IDENTIFIER ?? "pass.app.waflo.test-adapter",
            teamIdentifier: values.APPLE_TEAM_IDENTIFIER ?? "WAFLOTEST",
            organizationName: values.APPLE_ORGANIZATION_NAME,
            webServiceUrl:
              values.APPLE_PASS_WEB_SERVICE_URL ||
              `${values.API_PUBLIC_URL.replace(/\/+$/, "")}/v1/apple-wallet`,
          };
    const googleAccount = googleServiceAccount(
      values.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_PATH_OR_BASE64,
    );
    const apple = new AppleWalletProvider({
      mode: effectiveAppleMode,
      ...(appleConfiguration ? { configuration: appleConfiguration } : {}),
      ...(appleSigner ? { signer: appleSigner } : {}),
      authenticationToken: (input) =>
        security.appleAuthenticationToken(input.walletPassInstanceId, input.providerIdentity),
      passDownloadUrl: `${values.API_PUBLIC_URL.replace(/\/+$/, "")}/v1/customer/wallet/apple/pass`,
    });
    const googleIssuerId =
      values.GOOGLE_WALLET_ISSUER_ID ??
      (values.GOOGLE_WALLET_MODE === "TEST_ADAPTER" ? "test-issuer" : undefined);
    const googleReady =
      values.GOOGLE_WALLET_MODE === "TEST_ADAPTER" ||
      (values.GOOGLE_WALLET_MODE === "REAL" &&
        Boolean(googleIssuerId && googleAccount && values.GOOGLE_WALLET_PUBLIC_ASSET_BASE_URL));
    const effectiveGoogleMode = googleReady ? values.GOOGLE_WALLET_MODE : "DISABLED";
    const google = new GoogleWalletProvider({
      mode: effectiveGoogleMode,
      ...(googleIssuerId ? { issuerId: googleIssuerId } : {}),
      ...(googleAccount ? { serviceAccount: googleAccount } : {}),
      allowedOrigins: values.GOOGLE_WALLET_ALLOWED_ORIGINS.split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      testActionBaseUrl: `${values.CUSTOMER_WEB_URL.replace(/\/+$/, "")}/wallet-test/google`,
    });
    this.providers = new Map<WalletProviderCode, WalletProvider>([
      ["APPLE", apple],
      ["GOOGLE", google],
    ]);
    this.configured = { APPLE: appleReady, GOOGLE: googleReady };
  }

  get(provider: WalletProviderCode): WalletProvider {
    const value = this.providers.get(provider);
    if (!value) throw new Error(`Wallet provider ${provider} is unavailable.`);
    return value;
  }

  all(): readonly WalletProvider[] {
    return [...this.providers.values()];
  }

  isConfigured(provider: WalletProviderCode): boolean {
    return this.configured[provider];
  }

  healthChecks(): Promise<readonly WalletProviderHealth[]> {
    return Promise.all(this.all().map((provider) => provider.healthCheck()));
  }

  private cachedPublicHealth(): Promise<readonly WalletProviderHealth[]> {
    const now = Date.now();
    if (this.publicHealthCache && this.publicHealthCache.expiresAt > now) {
      return this.publicHealthCache.value;
    }
    const value = this.healthChecks().catch(() => []);
    this.publicHealthCache = { expiresAt: now + 60_000, value };
    return value;
  }

  async publicCapabilities() {
    const health = await this.cachedPublicHealth();
    const state = (provider: WalletProviderCode) => {
      const current = health.find((item) => item.provider === provider);
      if (!this.configured[provider] || !current || current.status === "NOT_CONFIGURED") {
        return "NOT_CONFIGURED" as const;
      }
      if (current.mode === "TEST_ADAPTER") return "TEST_ONLY" as const;
      if (current.status === "HEALTHY") return "CONNECTED" as const;
      if (current.status === "EXTERNALLY_UNCERTIFIED") {
        return "DEVICE_VERIFICATION_REQUIRED" as const;
      }
      return "TEMPORARILY_UNAVAILABLE" as const;
    };
    const googleWallet = state("GOOGLE");
    const appleWallet = state("APPLE");
    return {
      googleWalletAvailable: googleWallet === "CONNECTED",
      appleWalletAvailable: appleWallet === "CONNECTED",
      googleWalletConfigured: this.configured.GOOGLE,
      appleWalletConfigured: this.configured.APPLE,
      googleWallet,
      appleWallet,
    } as const;
  }
}
