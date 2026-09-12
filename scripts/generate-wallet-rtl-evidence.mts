import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderStampSvg } from "@waflo/stamp-engine";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { composeProgramPreview } from "../apps/api/src/programs/preview-composer.js";
import { composeDashboardWalletArtwork } from "../apps/api/src/programs/wallet-preview-artwork.js";

const output = path.resolve("artifacts", "wallet-rtl-final");
const cases = [
  {
    locale: "en",
    organizationName: "Gallery Coffee",
    programName: "Gallery Coffee Rewards",
    rewardSummary: "Complimentary reward",
  },
  {
    locale: "ar",
    organizationName: "حلويات اليوم",
    programName: "Waflo حلويات",
    rewardSummary: "مكافأة مجانية / Complimentary reward",
  },
  {
    locale: "ckb",
    organizationName: "کافێ گەلەری",
    programName: "کافێ گەلەری",
    rewardSummary: "خەڵاتی بەخۆڕایی / Complimentary reward",
  },
] as const;

const profiles = [
  { name: "apple-legacy", profile: "APPLE_WALLET" as const, variant: "LEGACY" as const },
  { name: "apple-poster", profile: "APPLE_WALLET" as const, variant: "POSTER" as const },
  { name: "google", profile: "GOOGLE_WALLET" as const },
];

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const fixture of cases) {
    const stamp = renderStampSvg({
      goal: 8,
      progress: 6,
      layout: "GRID",
      filledColor: "#E4572E",
      emptyColor: "#DACFC3",
      accentColor: "#E4572E",
      backgroundColor: "#F7F4EE",
      foregroundColor: "#241916",
      stampSize: 44,
      spacing: 8,
      locale: fixture.locale,
      outputProfile: "APPLE_WALLET",
    });
    for (const profile of profiles) {
      const artwork = await composeDashboardWalletArtwork({
        profile: profile.profile,
        ...(profile.variant ? { appleWalletVariant: profile.variant } : {}),
        locale: fixture.locale,
        renderedStamp: stamp,
        stampSize: 44,
        organizationName: fixture.organizationName,
        programName: fixture.programName,
        rewardSummary: fixture.rewardSummary,
        progress: 6,
        goal: 8,
        backgroundColor: "#F7F4EE",
        foregroundColor: "#241916",
        accentColor: "#E4572E",
        secondaryColor: "#DACFC3",
      });
      const preview = composeProgramPreview({
        profile: profile.profile,
        ...(profile.variant ? { appleWalletVariant: profile.variant } : {}),
        locale: fixture.locale,
        organizationName: fixture.organizationName,
        programName: fixture.programName,
        shortDescription: "Wallet loyalty membership",
        rewardSummary: fixture.rewardSummary,
        terms: "Terms apply.",
        progress: 6,
        goal: 8,
        stampSvg: stamp.svg,
        backgroundColor: "#F7F4EE",
        foregroundColor: "#241916",
        accentColor: "#E4572E",
        secondaryColor: "#DACFC3",
        walletArtwork: artwork,
        customerWebVariant: "CARD",
        apple: {
          headerLabel: "STAMPS",
          headerValue: "6/8",
          secondaryLabel: "REWARD",
          barcodeLabel: "QR",
          showBackContent: true,
        },
        google: {
          title: fixture.programName,
          subtitle: "Wallet loyalty membership",
          detailsLabel: "STAMPS",
          barcodeLabel: "QR",
        },
      });
      const filename = `${fixture.locale}-${profile.name}.png`;
      await writeFile(path.join(output, filename.replace(/\.png$/u, ".svg")), preview.svg);
      // Capture the same browser SVG path used by WalletPreviewCanvas, rather
      // than treating a server rasterizer as an RTL layout authority.
      await page.setViewportSize({ width: preview.width, height: preview.height });
      await page.setContent(
        `<style>html,body{margin:0;padding:0;background:#fff}img{display:block;width:${preview.width}px;height:${preview.height}px}</style><img alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.svg)}">`,
      );
      await page.screenshot({ path: path.join(output, filename), animations: "disabled" });
      // Keep a deterministic compositor raster beside the browser capture for
      // decode and dimensional checks without using it for visual acceptance.
      await writeFile(
        path.join(output, filename.replace(/\.png$/u, ".sharp.png")),
        await sharp(Buffer.from(preview.svg, "utf8")).png().toBuffer(),
      );
    }
  }
} finally {
  await browser.close();
}

process.stdout.write(`${output}\n`);
