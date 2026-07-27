import { z } from "zod";

const optionalUrl = z.union([z.literal(""), z.url()]).optional();

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
    EMAIL_FROM: z.string().default("Waflo <hello@waflo.app>"),
    MARKETING_WEB_URL: z.url().default("http://localhost:3000"),
    MERCHANT_DASHBOARD_URL: z.url().default("http://localhost:3001"),
    CUSTOMER_WEB_URL: z.url().default("http://localhost:3002"),
    API_PUBLIC_URL: z.url().default("http://localhost:4000"),
    ALLOWED_ORIGINS: z
      .string()
      .default("http://localhost:3000,http://localhost:3001,http://localhost:3002"),
    COOKIE_SECURE: z.stringbool().default(false),
    COOKIE_NAME: z.string().min(1).default("waflo_session"),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    EMAIL_VERIFICATION_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
    INVITATION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    MERCHANT_BASE_DOMAIN: z.string().min(3).default("waflo.app"),
    SCALE_LOCATION_LIMIT: z.coerce.number().int().positive().optional(),
    SCALE_TEAM_LIMIT: z.coerce.number().int().positive().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_STARTER_MONTHLY_PRICE_ID: z.string().optional(),
    STRIPE_GROWTH_MONTHLY_PRICE_ID: z.string().optional(),
    STRIPE_SCALE_MONTHLY_PRICE_ID: z.string().optional(),
    STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID: z.string().optional(),
    SENTRY_DSN: optionalUrl,
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    LEGAL_TERMS_VERSION: z.string().default("2026-07-draft"),
    LEGAL_PRIVACY_VERSION: z.string().default("2026-07-draft"),
    LEGAL_EFFECTIVE_DATE: z.string().default("To be confirmed after legal review"),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV !== "production") return;
    if (!value.COOKIE_SECURE) {
      context.addIssue({
        code: "custom",
        path: ["COOKIE_SECURE"],
        message: "Production cookies must be secure.",
      });
    }
    if (value.COOKIE_NAME !== "__Host-waflo_session") {
      context.addIssue({
        code: "custom",
        path: ["COOKIE_NAME"],
        message: "Production must use the __Host-waflo_session cookie.",
      });
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
    if (value.SMTP_HOST === "localhost" || value.SMTP_HOST === "127.0.0.1") {
      context.addIssue({
        code: "custom",
        path: ["SMTP_HOST"],
        message: "Production requires an explicitly configured SMTP provider.",
      });
    }
    for (const key of [
      "MARKETING_WEB_URL",
      "MERCHANT_DASHBOARD_URL",
      "CUSTOMER_WEB_URL",
      "API_PUBLIC_URL",
    ] as const) {
      if (!value[key].startsWith("https://")) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Production public URLs must use HTTPS.",
        });
      }
    }
    const origins = value.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim());
    if (origins.some((origin) => !origin.startsWith("https://"))) {
      context.addIssue({
        code: "custom",
        path: ["ALLOWED_ORIGINS"],
        message: "Production allowed origins must use HTTPS.",
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(source: NodeJS.ProcessEnv): Environment {
  const result = environmentSchema.safeParse(source);
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
