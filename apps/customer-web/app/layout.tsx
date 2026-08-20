import type { Metadata } from "next";
import { Cairo, Manrope, Noto_Sans_Arabic } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const cairo = Cairo({ subsets: ["arabic", "latin"], variable: "--font-cairo", display: "swap" });
const notoSansArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-noto-sans-arabic",
  display: "swap",
});

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
      <body className={`${manrope.variable} ${cairo.variable} ${notoSansArabic.variable}`}>
        {children}
      </body>
    </html>
  );
}
