const sensitiveKeys = [
  "password",
  "cookie",
  "authorization",
  "token",
  "secret",
  "signature",
  "card",
] as const;

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
