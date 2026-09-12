import { join } from "node:path";
import { createNextContentSecurityPolicy } from "@waflo/security";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
  transpilePackages: ["@waflo/ui", "@waflo/brand", "@waflo/contracts"],
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Content-Security-Policy",
            value: createNextContentSecurityPolicy(process.env.NODE_ENV, {
              ...(process.env.NEXT_PUBLIC_API_URL
                ? { apiUrl: process.env.NEXT_PUBLIC_API_URL }
                : {}),
              allowLoopbackApi:
                process.env.WAFLO_LOCAL_PRODUCTION_SMOKE === "1" ||
                process.env.WAFLO_E2E_NEXT_START === "1",
              googleFonts: true,
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
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
