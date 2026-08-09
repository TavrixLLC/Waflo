import { z } from "zod";

const optionalUrl = z.union([z.literal(""), z.url()]).optional();
const walletProviderMode = z.enum(["DISABLED", "TEST_ADAPTER", "REAL"]);

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DEPLOYMENT_ENVIRONMENT: z.enum(["development", "staging", "production"]).default("development"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z
      .string()
      .min(1)
      .default("postgresql://waflo:waflo_dev_password@localhost:5432/waflo?schema=public"),
    REDIS_URL: optionalUrl,
    RATE_LIMIT_NAMESPACE: z.string().min(1).default("waflo"),
    TRUSTED_PROXIES: z.string().default(""),
    SMTP_HOST: z.string().default("127.0.0.1"),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_SECURE: z.stringbool().default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().optional(),
    EMAIL_FROM: z.string().default("Waflo <hello@waflo.app>"),
    MARKETING_WEB_URL: z.url().default("http://localhost:3000"),
    MERCHANT_DASHBOARD_URL: z.url().default("http://localhost:3001"),
    CUSTOMER_WEB_URL: z.url().default("http://localhost:3002"),
    API_PUBLIC_URL: z.url().default("http://localhost:4000"),
    OBJECT_STORAGE_ENDPOINT: z.url().default("http://127.0.0.1:9000"),
    OBJECT_STORAGE_REGION: z.string().min(1).default("us-east-1"),
    OBJECT_STORAGE_BUCKET: z.string().min(3).max(63).default("waflo-private"),
    OBJECT_STORAGE_ACCESS_KEY_ID: z.string().min(1).default("waflo_local"),
    OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().min(8).default("waflo_local_password"),
    OBJECT_STORAGE_FORCE_PATH_STYLE: z.stringbool().default(true),
    OBJECT_STORAGE_SIGNING_SECRET: z
      .string()
      .min(32)
      .default("waflo-local-signing-secret-change-before-production"),
    ALLOWED_ORIGINS: z
      .string()
      .default("http://localhost:3000,http://localhost:3001,http://localhost:3002"),
    COOKIE_SECURE: z.stringbool().default(false),
    COOKIE_SAME_SITE: z.enum(["LAX", "NONE"]).default("LAX"),
    COOKIE_NAME: z.string().min(1).default("waflo_session"),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    SESSION_IDLE_TTL_MINUTES: z.coerce.number().int().min(15).max(43_200).default(1_440),
    CUSTOMER_COOKIE_NAME: z.string().min(1).default("waflo_customer"),
    CUSTOMER_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(90),
    CUSTOMER_DATA_ENCRYPTION_KEY_V1: z
      .string()
      .min(32)
      .default("1111111111111111111111111111111111111111111111111111111111111111"),
    CUSTOMER_DATA_ACTIVE_KEY_VERSION: z.coerce.number().int().min(1).default(1),
    CUSTOMER_DATA_ENCRYPTION_KEYS_JSON: z.string().optional(),
    CUSTOMER_CONTACT_LOOKUP_HMAC_KEY: z
      .string()
      .min(32)
      .default("2222222222222222222222222222222222222222222222222222222222222222"),
    CUSTOMER_SESSION_SECRET: z
      .string()
      .min(32)
      .default("3333333333333333333333333333333333333333333333333333333333333333"),
    MEMBERSHIP_CREDENTIAL_SECRET_V1: z
      .string()
      .min(32)
      .default("4444444444444444444444444444444444444444444444444444444444444444"),
    MEMBERSHIP_CREDENTIAL_ACTIVE_SECRET_VERSION: z.coerce.number().int().min(1).default(1),
    MEMBERSHIP_CREDENTIAL_SECRETS_JSON: z.string().optional(),
    TRANSFER_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(20),
    TRANSFER_CHALLENGE_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(5),
    TRANSFER_QR_MAX_BYTES: z.coerce.number().int().min(1024).max(10_000_000).default(2_097_152),
    TRANSFER_QR_MAX_PIXELS: z.coerce.number().int().min(10_000).max(40_000_000).default(12_000_000),
    LEDGER_HASH_SECRET_V1: z
      .string()
      .min(32)
      .default("6666666666666666666666666666666666666666666666666666666666666666"),
    LEDGER_HASH_ACTIVE_VERSION: z.coerce.number().int().min(1).max(1).default(1),
    MERCHANT_TRANSACTION_REFERENCE_HMAC_KEY_V1: z
      .string()
      .min(32)
      .default("8888888888888888888888888888888888888888888888888888888888888888"),
    MERCHANT_TRANSACTION_REFERENCE_ACTIVE_KEY_VERSION: z.coerce
      .number()
      .int()
      .min(1)
      .max(1)
      .default(1),
    DEVICE_SESSION_SECRET: z
      .string()
      .min(32)
      .default("7777777777777777777777777777777777777777777777777777777777777777"),
    DEVICE_PAIRING_TTL_MINUTES: z.coerce.number().int().min(2).max(30).default(10),
    DEVICE_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    DEVICE_REQUEST_MAX_CLOCK_SKEW_SECONDS: z.coerce.number().int().min(15).max(900).default(120),
    DEVICE_NONCE_TTL_MINUTES: z.coerce.number().int().min(2).max(60).default(10),
    STAFF_MOBILE_MINIMUM_APP_VERSION: z
      .string()
      .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
      .default("1.0.0"),
    STAFF_OWN_REVERSAL_WINDOW_SECONDS: z.coerce.number().int().min(15).max(900).default(120),
    MANAGER_REVERSAL_WINDOW_MINUTES: z.coerce.number().int().min(1).max(10080).default(1440),
    MANAGER_APPROVAL_TTL_MINUTES: z.coerce.number().int().min(1).max(30).default(5),
    OPERATION_RATE_LIMIT_PER_DEVICE_MINUTE: z.coerce.number().int().min(1).max(1000).default(60),
    OPERATION_RATE_LIMIT_PER_STAFF_HOUR: z.coerce.number().int().min(1).max(10000).default(600),
    PROJECTION_INTEGRITY_SAMPLE_SIZE: z.coerce.number().int().min(1).max(10000).default(100),
    REWARD_EXPIRY_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
    ANALYTICS_BATCH_SIZE: z.coerce.number().int().min(1).max(10000).default(500),
    EXPORT_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    EXPORT_MAX_ROWS: z.coerce.number().int().min(1).max(1_000_000).default(100_000),
    WALLET_UPDATE_COALESCE_SECONDS: z.coerce.number().int().min(0).max(300).default(5),
    TEST_STAFF_CLIENT_ENABLED: z.stringbool().default(true),
    EMAIL_VERIFICATION_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
    INVITATION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    OAUTH_FLOW_TTL_MINUTES: z.coerce.number().int().min(2).max(20).default(10),
    OAUTH_FLOW_SECRET: z
      .string()
      .min(32)
      .default("waflo-local-oauth-flow-secret-change-before-deployment"),
    GOOGLE_SIGNIN_CLIENT_ID: z.string().optional(),
    GOOGLE_SIGNIN_CLIENT_SECRET: z.string().optional(),
    GOOGLE_SIGNIN_REDIRECT_URI: optionalUrl,
    APPLE_SIGNIN_CLIENT_ID: z.string().optional(),
    APPLE_SIGNIN_TEAM_ID: z.string().optional(),
    APPLE_SIGNIN_KEY_ID: z.string().optional(),
    APPLE_SIGNIN_PRIVATE_KEY: z.string().optional(),
    APPLE_SIGNIN_PRIVATE_KEY_BASE64: z.string().optional(),
    APPLE_SIGNIN_REDIRECT_URI: optionalUrl,
    MERCHANT_BASE_DOMAIN: z.string().min(3).default("waflo.app"),
    SCALE_LOCATION_LIMIT: z.coerce.number().int().positive().optional(),
    SCALE_TEAM_LIMIT: z.coerce.number().int().positive().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_PUBLISHABLE_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_STARTER_MONTHLY_PRICE_ID: z.string().optional(),
    STRIPE_GROWTH_MONTHLY_PRICE_ID: z.string().optional(),
    STRIPE_SCALE_MONTHLY_PRICE_ID: z.string().optional(),
    STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID: z.string().optional(),
    STRIPE_RECONCILIATION_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
    STRIPE_RECONCILIATION_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
    SENTRY_DSN: optionalUrl,
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    LEGAL_TERMS_VERSION: z.string().default("2026-07-draft"),
    LEGAL_PRIVACY_VERSION: z.string().default("2026-07-draft"),
    LEGAL_EFFECTIVE_DATE: z.string().default("To be confirmed after legal review"),
    WALLET_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
    WALLET_COMMAND_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(25).default(8),
    WORKER_HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(300).default(30),
    WORKER_DEGRADED_AFTER_SECONDS: z.coerce.number().int().min(15).max(3600).default(120),
    CLEANUP_BATCH_SIZE: z.coerce.number().int().min(1).max(5000).default(500),
    SECURITY_TOKEN_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    WALLET_PUBLIC_BASE_URL: z.url().default("http://localhost:4000/v1/public/wallet-assets"),
    APPLE_WALLET_MODE: walletProviderMode.default("DISABLED"),
    APPLE_PASS_TYPE_IDENTIFIER: z.string().optional(),
    APPLE_TEAM_IDENTIFIER: z.string().optional(),
    APPLE_ORGANIZATION_NAME: z.string().default("Waflo by Tavrix LLC"),
    APPLE_PASS_CERTIFICATE_PATH_OR_BASE64: z.string().optional(),
    APPLE_PASS_CERTIFICATE_PASSWORD: z.string().optional(),
    APPLE_WWDR_CERTIFICATE_PATH_OR_BASE64: z.string().optional(),
    APPLE_PASS_WEB_SERVICE_URL: optionalUrl,
    APPLE_PASS_AUTH_SECRET_V1: z
      .string()
      .min(32)
      .default("5555555555555555555555555555555555555555555555555555555555555555"),
    APPLE_PASS_AUTH_ACTIVE_SECRET_VERSION: z.coerce.number().int().min(1).default(1),
    APPLE_PASS_AUTH_SECRETS_JSON: z.string().optional(),
    APPLE_APNS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
    GOOGLE_WALLET_MODE: walletProviderMode.default("DISABLED"),
    GOOGLE_WALLET_ISSUER_ID: z.string().optional(),
    GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_PATH_OR_BASE64: z.string().optional(),
    GOOGLE_WALLET_ALLOWED_ORIGINS: z.string().default("http://localhost:3002"),
    GOOGLE_WALLET_PUBLIC_ASSET_BASE_URL: optionalUrl,
    GOOGLE_WALLET_PUBLISHING_MODE: z.enum(["DEMO", "PUBLISHING"]).default("DEMO"),
  })
  .superRefine((value, context) => {
    const deployed = value.DEPLOYMENT_ENVIRONMENT !== "development";
    if (deployed && value.NODE_ENV !== "production") {
      context.addIssue({
        code: "custom",
        path: ["NODE_ENV"],
        message: "Staging and production must run optimized production builds.",
      });
    }
    if (!deployed) return;
    if (value.COOKIE_SAME_SITE === "NONE" && !value.COOKIE_SECURE) {
      context.addIssue({
        code: "custom",
        path: ["COOKIE_SAME_SITE"],
        message: "SameSite=None requires secure cookies.",
      });
    }
    for (const [encoded, legacy, active, path] of [
      [
        value.CUSTOMER_DATA_ENCRYPTION_KEYS_JSON,
        value.CUSTOMER_DATA_ENCRYPTION_KEY_V1,
        value.CUSTOMER_DATA_ACTIVE_KEY_VERSION,
        "CUSTOMER_DATA_ACTIVE_KEY_VERSION",
      ],
      [
        value.MEMBERSHIP_CREDENTIAL_SECRETS_JSON,
        value.MEMBERSHIP_CREDENTIAL_SECRET_V1,
        value.MEMBERSHIP_CREDENTIAL_ACTIVE_SECRET_VERSION,
        "MEMBERSHIP_CREDENTIAL_ACTIVE_SECRET_VERSION",
      ],
      [
        value.APPLE_PASS_AUTH_SECRETS_JSON,
        value.APPLE_PASS_AUTH_SECRET_V1,
        value.APPLE_PASS_AUTH_ACTIVE_SECRET_VERSION,
        "APPLE_PASS_AUTH_ACTIVE_SECRET_VERSION",
      ],
    ] as const) {
      try {
        const entries = parseVersionedSecretEntries(encoded, legacy);
        if (!entries[active]) throw new Error("active version missing");
      } catch {
        context.addIssue({
          code: "custom",
          path: [path],
          message: "The active version must be present in the configured versioned secret set.",
        });
      }
    }
    if (value.OAUTH_FLOW_SECRET.startsWith("waflo-local-")) {
      context.addIssue({
        code: "custom",
        path: ["OAUTH_FLOW_SECRET"],
        message: "Staging and production require a dedicated OAuth flow secret.",
      });
    }
    const googleSignInParts = [
      value.GOOGLE_SIGNIN_CLIENT_ID,
      value.GOOGLE_SIGNIN_CLIENT_SECRET,
      value.GOOGLE_SIGNIN_REDIRECT_URI,
    ];
    if (googleSignInParts.some(Boolean) && !googleSignInParts.every(Boolean)) {
      context.addIssue({
        code: "custom",
        path: ["GOOGLE_SIGNIN_CLIENT_ID"],
        message: "Google Sign-In configuration must be complete or absent.",
      });
    }
    const appleSignInParts = [
      value.APPLE_SIGNIN_CLIENT_ID,
      value.APPLE_SIGNIN_TEAM_ID,
      value.APPLE_SIGNIN_KEY_ID,
      value.APPLE_SIGNIN_PRIVATE_KEY || value.APPLE_SIGNIN_PRIVATE_KEY_BASE64,
      value.APPLE_SIGNIN_REDIRECT_URI,
    ];
    if (appleSignInParts.some(Boolean) && !appleSignInParts.every(Boolean)) {
      context.addIssue({
        code: "custom",
        path: ["APPLE_SIGNIN_CLIENT_ID"],
        message: "Apple Sign-In configuration must be complete or absent.",
      });
    }
    if (!value.COOKIE_SECURE) {
      context.addIssue({
        code: "custom",
        path: ["COOKIE_SECURE"],
        message: "Staging and production cookies must be secure.",
      });
    }
    if (value.COOKIE_NAME !== "__Host-waflo_session") {
      context.addIssue({
        code: "custom",
        path: ["COOKIE_NAME"],
        message: "Staging and production must use the __Host-waflo_session cookie.",
      });
    }
    if (value.CUSTOMER_COOKIE_NAME !== "__Host-waflo_customer") {
      context.addIssue({
        code: "custom",
        path: ["CUSTOMER_COOKIE_NAME"],
        message: "Staging and production must use the __Host-waflo_customer cookie.",
      });
    }
    const unsafeW3Secrets = [
      value.CUSTOMER_DATA_ENCRYPTION_KEY_V1,
      value.CUSTOMER_CONTACT_LOOKUP_HMAC_KEY,
      value.CUSTOMER_SESSION_SECRET,
      value.MEMBERSHIP_CREDENTIAL_SECRET_V1,
      value.APPLE_PASS_AUTH_SECRET_V1,
      value.LEDGER_HASH_SECRET_V1,
      value.MERCHANT_TRANSACTION_REFERENCE_HMAC_KEY_V1,
      value.DEVICE_SESSION_SECRET,
    ].some((secret) => /^([1-8])\1{63}$/.test(secret));
    if (unsafeW3Secrets) {
      context.addIssue({
        code: "custom",
        path: ["CUSTOMER_DATA_ENCRYPTION_KEY_V1"],
        message: "Production requires dedicated customer and membership secrets.",
      });
    }
    if (value.APPLE_WALLET_MODE === "TEST_ADAPTER" || value.GOOGLE_WALLET_MODE === "TEST_ADAPTER") {
      context.addIssue({
        code: "custom",
        path: ["APPLE_WALLET_MODE"],
        message: "Wallet test adapters cannot run in staging or production.",
      });
    }
    if (value.TEST_STAFF_CLIENT_ENABLED) {
      context.addIssue({
        code: "custom",
        path: ["TEST_STAFF_CLIENT_ENABLED"],
        message: "The Staff Test Client cannot run in staging or production.",
      });
    }
    if (
      value.APPLE_WALLET_MODE === "REAL" &&
      (!value.APPLE_PASS_TYPE_IDENTIFIER ||
        !value.APPLE_TEAM_IDENTIFIER ||
        !value.APPLE_PASS_CERTIFICATE_PATH_OR_BASE64 ||
        !value.APPLE_PASS_CERTIFICATE_PASSWORD ||
        !value.APPLE_WWDR_CERTIFICATE_PATH_OR_BASE64 ||
        !value.APPLE_PASS_WEB_SERVICE_URL)
    ) {
      context.addIssue({
        code: "custom",
        path: ["APPLE_WALLET_MODE"],
        message:
          "Real Apple Wallet mode requires a complete signing and update-service configuration.",
      });
    }
    if (
      value.GOOGLE_WALLET_MODE === "REAL" &&
      (!value.GOOGLE_WALLET_ISSUER_ID ||
        !value.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_PATH_OR_BASE64 ||
        !value.GOOGLE_WALLET_PUBLIC_ASSET_BASE_URL)
    ) {
      context.addIssue({
        code: "custom",
        path: ["GOOGLE_WALLET_MODE"],
        message:
          "Real Google Wallet mode requires issuer, service-account, and public asset configuration.",
      });
    }
    if (value.DEPLOYMENT_ENVIRONMENT === "production") {
      if (
        value.GOOGLE_WALLET_MODE === "REAL" &&
        value.GOOGLE_WALLET_PUBLISHING_MODE !== "PUBLISHING"
      ) {
        context.addIssue({
          code: "custom",
          path: ["GOOGLE_WALLET_PUBLISHING_MODE"],
          message: "Production Google Wallet requires publishing mode.",
        });
      }
      if (value.APPLE_WALLET_MODE === "REAL" && value.APPLE_APNS_ENVIRONMENT !== "production") {
        context.addIssue({
          code: "custom",
          path: ["APPLE_APNS_ENVIRONMENT"],
          message: "Production Apple Wallet requires production APNs.",
        });
      }
    }
    if (
      value.DATABASE_URL.includes("localhost") ||
      value.DATABASE_URL.includes("waflo_dev_password")
    ) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "Production cannot use the local development database.",
      });
    }
    if (!value.REDIS_URL) {
      context.addIssue({
        code: "custom",
        path: ["REDIS_URL"],
        message: "Production requires Redis for distributed rate limiting.",
      });
    }
    if (!value.TRUSTED_PROXIES.trim()) {
      context.addIssue({
        code: "custom",
        path: ["TRUSTED_PROXIES"],
        message: "Production requires an explicit trusted proxy allowlist.",
      });
    }
    if (
      value.OBJECT_STORAGE_ACCESS_KEY_ID === "waflo_local" ||
      value.OBJECT_STORAGE_SECRET_ACCESS_KEY === "waflo_local_password" ||
      value.OBJECT_STORAGE_SIGNING_SECRET.startsWith("waflo-local-")
    ) {
      context.addIssue({
        code: "custom",
        path: ["OBJECT_STORAGE_SECRET_ACCESS_KEY"],
        message: "Production requires dedicated object-storage credentials and a signing secret.",
      });
    }
    if (!value.OBJECT_STORAGE_ENDPOINT.startsWith("https://")) {
      context.addIssue({
        code: "custom",
        path: ["OBJECT_STORAGE_ENDPOINT"],
        message: "Production object storage must use HTTPS.",
      });
    }
    if (value.SMTP_HOST === "localhost" || value.SMTP_HOST === "127.0.0.1") {
      context.addIssue({
        code: "custom",
        path: ["SMTP_HOST"],
        message: "Production requires an explicitly configured SMTP provider.",
      });
    }
    if (!value.SMTP_USER || !value.SMTP_PASSWORD || !(value.SMTP_FROM || value.EMAIL_FROM)) {
      context.addIssue({
        code: "custom",
        path: ["SMTP_USER"],
        message: "Staging and production require authenticated SMTP and a sender.",
      });
    }
    for (const key of [
      "MARKETING_WEB_URL",
      "MERCHANT_DASHBOARD_URL",
      "CUSTOMER_WEB_URL",
      "API_PUBLIC_URL",
      "WALLET_PUBLIC_BASE_URL",
    ] as const) {
      if (!value[key].startsWith("https://")) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Production public URLs must use HTTPS.",
        });
      }
    }
    if (
      value.APPLE_PASS_WEB_SERVICE_URL &&
      !value.APPLE_PASS_WEB_SERVICE_URL.startsWith("https://")
    ) {
      context.addIssue({
        code: "custom",
        path: ["APPLE_PASS_WEB_SERVICE_URL"],
        message: "The Apple Wallet update web service must use HTTPS in production.",
      });
    }
    if (
      value.GOOGLE_WALLET_PUBLIC_ASSET_BASE_URL &&
      !value.GOOGLE_WALLET_PUBLIC_ASSET_BASE_URL.startsWith("https://")
    ) {
      context.addIssue({
        code: "custom",
        path: ["GOOGLE_WALLET_PUBLIC_ASSET_BASE_URL"],
        message: "Google Wallet public assets must use HTTPS in production.",
      });
    }
    const origins = value.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim());
    if (origins.some((origin) => !origin.startsWith("https://"))) {
      context.addIssue({
        code: "custom",
        path: ["ALLOWED_ORIGINS"],
        message: "Production allowed origins must use HTTPS.",
      });
    }
    const exactOrigins = new Set([
      new URL(value.MARKETING_WEB_URL).origin,
      new URL(value.MERCHANT_DASHBOARD_URL).origin,
      new URL(value.CUSTOMER_WEB_URL).origin,
    ]);
    if (
      origins.some((origin) => !exactOrigins.has(origin)) ||
      origins.length !== new Set(origins).size
    ) {
      context.addIssue({
        code: "custom",
        path: ["ALLOWED_ORIGINS"],
        message: "Allowed origins must be an exact, duplicate-free Waflo web-origin allowlist.",
      });
    }
    for (const [key, redirect, expectedPath] of [
      [
        "GOOGLE_SIGNIN_REDIRECT_URI",
        value.GOOGLE_SIGNIN_REDIRECT_URI,
        "/v1/auth/external/google/callback",
      ],
      [
        "APPLE_SIGNIN_REDIRECT_URI",
        value.APPLE_SIGNIN_REDIRECT_URI,
        "/v1/auth/external/apple/callback",
      ],
    ] as const) {
      if (redirect) {
        const callback = new URL(redirect);
        if (
          callback.origin !== new URL(value.API_PUBLIC_URL).origin ||
          callback.protocol !== "https:" ||
          callback.pathname !== expectedPath ||
          callback.search ||
          callback.hash
        ) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: "OAuth callbacks must be exact HTTPS URLs on the configured API origin.",
          });
        }
      }
    }
    const stripeKey = value.STRIPE_SECRET_KEY ?? "";
    const stripePublishable = value.STRIPE_PUBLISHABLE_KEY ?? "";
    if (
      value.DEPLOYMENT_ENVIRONMENT === "staging" &&
      (stripeKey.startsWith("sk_live_") || stripePublishable.startsWith("pk_live_"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["STRIPE_SECRET_KEY"],
        message: "Staging accepts Stripe test-mode keys only.",
      });
    }
    if (
      value.DEPLOYMENT_ENVIRONMENT === "production" &&
      ((stripeKey && !stripeKey.startsWith("sk_live_")) ||
        (stripePublishable && !stripePublishable.startsWith("pk_live_")))
    ) {
      context.addIssue({
        code: "custom",
        path: ["STRIPE_SECRET_KEY"],
        message: "Production accepts Stripe live-mode keys only.",
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function parseVersionedSecretEntries(
  encoded: string | undefined,
  legacyVersionOne: string,
): Readonly<Record<number, string>> {
  if (!encoded?.trim()) return { 1: legacyVersionOne };
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new Error("Versioned secret configuration must be a JSON object.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Versioned secret configuration must be a JSON object.");
  }
  const entries: Record<number, string> = {};
  for (const [rawVersion, secret] of Object.entries(value)) {
    const version = Number(rawVersion);
    if (!Number.isInteger(version) || version < 1 || typeof secret !== "string" || !secret.trim()) {
      throw new Error("Versioned secret configuration contains an invalid entry.");
    }
    entries[version] = secret;
  }
  if (Object.keys(entries).length === 0) {
    throw new Error("Versioned secret configuration cannot be empty.");
  }
  return entries;
}

export function parseEnvironment(source: NodeJS.ProcessEnv): Environment {
  const result = environmentSchema.safeParse({
    ...source,
    DEPLOYMENT_ENVIRONMENT:
      source.DEPLOYMENT_ENVIRONMENT ??
      (source.NODE_ENV === "production" ? "production" : "development"),
  });
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid Waflo environment configuration: ${details}`);
  }
  return result.data;
}

export const platformDomains = {
  marketing: "waflo.app",
  dashboard: "app.waflo.app",
  api: "api.waflo.app",
} as const;
