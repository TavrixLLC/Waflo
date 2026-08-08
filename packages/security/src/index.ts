const sensitiveKeys = [
  "password",
  "cookie",
  "authorization",
  "token",
  "secret",
  "signature",
  "card",
] as const;

const sensitiveQueryKeys = new Set(["token", "code", "password", "secret", "signature", "key"]);

export function sanitizeRequestUrl(input: string | undefined): string {
  if (!input) return "";
  const [path, query] = input.split("?", 2);
  if (!query) return path ?? "";
  const parameters = new URLSearchParams(query);
  for (const key of [...parameters.keys()]) {
    if (sensitiveQueryKeys.has(key.toLocaleLowerCase("en-US"))) {
      parameters.set(key, "[REDACTED]");
    }
  }
  const safeQuery = parameters.toString();
  return safeQuery ? `${path ?? ""}?${safeQuery}` : (path ?? "");
}

export interface ErrorReportContext {
  requestId?: string;
  component?: string;
  operation?: string;
  metadata?: Record<string, unknown>;
}

export interface ErrorReporter {
  captureException(error: unknown, context?: ErrorReportContext): void | Promise<void>;
  captureMessage(message: string, context?: ErrorReportContext): void | Promise<void>;
  setUserContext(userId: string | null): void | Promise<void>;
  setOrganizationContext(organizationId: string | null): void | Promise<void>;
  clearContext(): void | Promise<void>;
  flush(timeoutMs?: number): Promise<boolean>;
}

export function sanitizeErrorForReporting(error: unknown): Error {
  const source = error instanceof Error ? error : new Error("Non-error exception");
  const safeMessage = sanitizeRequestUrl(source.message)
    .replace(
      /\b(token|password|secret|authorization|cookie|signature)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .slice(0, 1_000);
  const sanitized = new Error(safeMessage || "Application error");
  sanitized.name = source.name.slice(0, 120);
  return sanitized;
}

export class NoopErrorReporter implements ErrorReporter {
  captureException(): void {}
  captureMessage(): void {}
  setUserContext(): void {}
  setOrganizationContext(): void {}
  clearContext(): void {}
  async flush(): Promise<boolean> {
    return true;
  }
}

export class DynamicSentryErrorReporter implements ErrorReporter {
  private sentry: {
    captureException(error: unknown, options?: unknown): string;
    captureMessage(message: string, options?: unknown): string;
    setUser(user: { id: string } | null): void;
    setContext(name: string, context: { id: string } | null): void;
    flush(timeout?: number): Promise<boolean>;
  } | null = null;

  constructor(dsn: string) {
    const packageName = "@sentry/node";
    // Optional telemetry must never sit on the request path. Start loading in
    // the background and act as a no-op until the adapter is ready.
    void import(packageName)
      .then((module: Record<string, unknown>) => {
        const init = module.init;
        const captureException = module.captureException;
        const captureMessage = module.captureMessage;
        const setUser = module.setUser;
        const setContext = module.setContext;
        const flush = module.flush;
        if (
          typeof init !== "function" ||
          typeof captureException !== "function" ||
          typeof captureMessage !== "function" ||
          typeof setUser !== "function" ||
          typeof setContext !== "function" ||
          typeof flush !== "function"
        ) {
          return null;
        }
        init({ dsn, sendDefaultPii: false });
        return {
          captureException: captureException as (error: unknown, options?: unknown) => string,
          captureMessage: captureMessage as (message: string, options?: unknown) => string,
          setUser: setUser as (user: { id: string } | null) => void,
          setContext: setContext as (name: string, context: { id: string } | null) => void,
          flush: flush as (timeout?: number) => Promise<boolean>,
        };
      })
      .then((adapter) => {
        this.sentry = adapter;
      })
      .catch(() => undefined);
  }

  captureException(error: unknown, context?: ErrorReportContext): void {
    const sentry = this.sentry;
    if (!sentry) return;
    try {
      sentry.captureException(sanitizeErrorForReporting(error), {
        tags: {
          component: context?.component,
          operation: context?.operation,
        },
        extra: {
          requestId: context?.requestId,
          metadata: redactMetadata(context?.metadata),
        },
      });
    } catch {}
  }

  captureMessage(message: string, context?: ErrorReportContext): void {
    const sentry = this.sentry;
    if (!sentry) return;
    try {
      sentry.captureMessage(sanitizeErrorForReporting(new Error(message)).message, {
        level: "warning",
        tags: {
          component: context?.component,
          operation: context?.operation,
        },
        extra: {
          requestId: context?.requestId,
          metadata: redactMetadata(context?.metadata),
        },
      });
    } catch {}
  }

  setUserContext(userId: string | null): void {
    const sentry = this.sentry;
    try {
      sentry?.setUser(userId ? { id: userId.slice(0, 128) } : null);
    } catch {}
  }

  setOrganizationContext(organizationId: string | null): void {
    const sentry = this.sentry;
    try {
      sentry?.setContext(
        "organization",
        organizationId ? { id: organizationId.slice(0, 128) } : null,
      );
    } catch {}
  }

  clearContext(): void {
    const sentry = this.sentry;
    try {
      sentry?.setUser(null);
      sentry?.setContext("organization", null);
    } catch {}
  }

  async flush(timeoutMs = 2_000): Promise<boolean> {
    const sentry = this.sentry;
    try {
      return sentry ? await sentry.flush(timeoutMs) : true;
    } catch {
      return false;
    }
  }
}

export function createErrorReporter(dsn: string | undefined): ErrorReporter {
  return dsn ? new DynamicSentryErrorReporter(dsn) : new NoopErrorReporter();
}

export function redactMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMetadata);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveKeys.some((sensitive) => key.toLocaleLowerCase("en-US").includes(sensitive))
        ? "[REDACTED]"
        : redactMetadata(entry),
    ]),
  );
}

export function privacyAwareIp(ip: string | undefined): string | null {
  if (!ip) return null;
  if (ip.includes(":")) {
    const groups = ip.split(":");
    return `${groups.slice(0, 3).join(":")}::/48`;
  }
  const octets = ip.split(".");
  return octets.length === 4 ? `${octets.slice(0, 3).join(".")}.0/24` : null;
}

export interface NextContentSecurityPolicyOptions {
  apiUrl?: string;
  allowLoopbackApi?: boolean;
  googleFonts?: boolean;
}

function contentSecurityPolicyOrigin(
  value: string | undefined,
  allowLoopback: boolean,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.origin;
    if (
      allowLoopback &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    ) {
      return url.origin;
    }
  } catch {
    // Invalid configuration is omitted from the policy rather than injected into a header.
  }
  return null;
}

export function createNextContentSecurityPolicy(
  nodeEnvironment: string | undefined,
  options: NextContentSecurityPolicyOptions = {},
): string {
  const developmentScriptSource = nodeEnvironment === "development" ? " 'unsafe-eval'" : "";
  const externalFontSource = options.googleFonts ? " https://fonts.gstatic.com" : "";
  const externalFontStyleSource = options.googleFonts ? " https://fonts.googleapis.com" : "";
  const externalFontConnectSource = options.googleFonts
    ? " https://fonts.googleapis.com https://fonts.gstatic.com"
    : "";

  const developmentConnectSource =
    nodeEnvironment === "development" ? " http://localhost:4000" : "";
  const configuredApiOrigin = contentSecurityPolicyOrigin(
    options.apiUrl,
    options.allowLoopbackApi === true,
  );
  const configuredApiSource =
    configuredApiOrigin && configuredApiOrigin !== "https://api.waflo.app"
      ? ` ${configuredApiOrigin}`
      : "";

  return `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; font-src 'self' data:${externalFontSource}; script-src 'self' 'unsafe-inline'${developmentScriptSource}; style-src 'self' 'unsafe-inline'${externalFontStyleSource}; connect-src 'self'${developmentConnectSource}${externalFontConnectSource}${configuredApiSource} https://api.waflo.app`;
}

export const securityHeaders = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      imgSrc: ["'self'", "data:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'"],
    },
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" as const },
};
