import { createNextContentSecurityPolicy } from "@waflo/security";
import { join } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.WAFLO_E2E_NEXT_START === "1" ? {} : { output: "standalone" }),
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
  transpilePackages: ["@waflo/ui", "@waflo/brand", "@waflo/billing", "@waflo/i18n"],
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          ...(process.env.DEPLOYMENT_ENVIRONMENT === "staging"
            ? [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }]
            : []),
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Content-Security-Policy",
            value: createNextContentSecurityPolicy(process.env.NODE_ENV, { googleFonts: true }),
          },
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
