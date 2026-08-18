import { join } from "node:path";
import { createNextContentSecurityPolicy } from "@waflo/security";
import type { NextConfig } from "next";

const configuredApiUrl = process.env.WAFLO_E2E_API_URL ?? process.env.NEXT_PUBLIC_API_URL;

const nextConfig: NextConfig = {
  ...(process.env.WAFLO_E2E_NEXT_START === "1" ? {} : { output: "standalone" }),
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
  // A routed Merchant document must not render before its title metadata is available.
  htmlLimitedBots: /.*/,
  transpilePackages: [
    "@waflo/ui",
    "@waflo/brand",
    "@waflo/billing",
    "@waflo/contracts",
    "@waflo/i18n",
  ],
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: createNextContentSecurityPolicy(process.env.NODE_ENV, {
              ...(configuredApiUrl ? { apiUrl: configuredApiUrl } : {}),
              allowLoopbackApi:
                process.env.WAFLO_LOCAL_PRODUCTION_SMOKE === "1" ||
                process.env.WAFLO_E2E_NEXT_START === "1",
              googleFonts: true,
              stripeJs: true,
              mapboxGl: true,
            }),
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
      {
        source:
          "/:locale(en|ar|ku-badini|ku-sorani)/:sensitive(verify-email|reset-password|invite)",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
};

export default nextConfig;
