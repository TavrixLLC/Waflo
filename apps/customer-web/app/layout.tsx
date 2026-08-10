import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Waflo",
  description: "A customer loyalty-card experience powered by Waflo.",
  manifest: "/site.webmanifest",
  icons: {
    icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }, { url: "/favicon.ico" }],
    apple: "/apple-touch-icon-180.png",
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
