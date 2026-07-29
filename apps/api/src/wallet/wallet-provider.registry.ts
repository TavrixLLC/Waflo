import { existsSync, readFileSync } from "node:fs";
import { Injectable } from "@nestjs/common";
import {
  AppleWalletProvider,
  Pkcs7ApplePassSigner,
  TestApplePassSigner,
  type ApplePassSigner,
} from "@waflo/wallet-apple";
import type { WalletProvider, WalletProviderCode } from "@waflo/wallet-core";
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
  const parsed = JSON.parse(textFromSource(value)) as Partial<GoogleServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Google Wallet service-account configuration is incomplete.");
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    ...(parsed.token_uri ? { token_uri: parsed.token_uri } : {}),
  };
}

@Injectable()
export class WalletProviderRegistry {
  private readonly providers: ReadonlyMap<WalletProviderCode, WalletProvider>;

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
      appleSigner = new Pkcs7ApplePassSigner(
        bytesFromSource(values.APPLE_PASS_CERTIFICATE_PATH_OR_BASE64),
        values.APPLE_PASS_CERTIFICATE_PASSWORD,
        textFromSource(values.APPLE_WWDR_CERTIFICATE_PATH_OR_BASE64),
      );
    }
    const appleConfiguration =
      values.APPLE_WALLET_MODE === "DISABLED"
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
      mode: values.APPLE_WALLET_MODE,
      ...(appleConfiguration ? { configuration: appleConfiguration } : {}),
      ...(appleSigner ? { signer: appleSigner } : {}),
      authenticationToken: (input) =>
        security.appleAuthenticationToken(input.walletPassInstanceId, input.providerIdentity),
      passDownloadUrl: `${values.API_PUBLIC_URL.replace(/\/+$/, "")}/v1/customer/wallet/apple/pass`,
    });
    const googleIssuerId =
      values.GOOGLE_WALLET_ISSUER_ID ??
      (values.GOOGLE_WALLET_MODE === "TEST_ADAPTER" ? "test-issuer" : undefined);
    const google = new GoogleWalletProvider({
      mode: values.GOOGLE_WALLET_MODE,
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
  }

  get(provider: WalletProviderCode): WalletProvider {
    const value = this.providers.get(provider);
    if (!value) throw new Error(`Wallet provider ${provider} is unavailable.`);
    return value;
  }

  all(): readonly WalletProvider[] {
    return [...this.providers.values()];
  }
}
