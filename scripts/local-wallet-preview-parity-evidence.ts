import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { composeProgramPreview } from "../apps/api/src/programs/preview-composer.js";
import { composeDashboardWalletArtwork } from "../apps/api/src/programs/wallet-preview-artwork.js";
import { createQrPreviewPngDataUri } from "../packages/qr-core/src/preview.js";
import { renderStampSvg } from "../packages/stamp-engine/src/index.js";
import {
  dashboardWalletPreviewQrRasterRequest,
  renderDashboardWalletPreviewSvg,
} from "../packages/wallet-artwork/src/dashboard-preview.js";

const outputDirectory =
  "C:/Users/Alhamza Nazhan/Desktop/TestRES/wallet-preview-frontend-parity/iteration-02-shared-render-plan";

const base = {
  organizationName: "Waflo Coffee",
  programName: "Eight visits earn a coffee",
  rewardSummary: "A free house coffee",
  progress: 4,
  goal: 8,
  backgroundColor: "#F5E5D2",
  foregroundColor: "#2A1710",
  accentColor: "#6B3F2A",
  secondaryColor: "#E7B56B",
};

type PreviewContent = typeof base;

const evidenceLogoDataUri = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="20" fill="#125B72"/><path d="M20 48h56M48 20v56" stroke="#F8E3B1" stroke-width="10"/></svg>',
  "utf8",
).toString("base64")}`;

function localizedBase(locale: string): typeof base {
  if (locale === "ar") {
    return {
      ...base,
      organizationName: "مقهى وافلو",
      programName: "ثماني زيارات تكسبك قهوة",
      rewardSummary: "قهوة منزلية مجانية",
    };
  }
  if (locale === "ckb") {
    return {
      ...base,
      organizationName: "کافێی وافلۆ",
      programName: "هەشت سەردان قاوەیەکت پێدەدات",
      rewardSummary: "قاوەی ماڵی بەخۆڕایی",
    };
  }
  if (locale === "ku-Arab-IQ") {
    return {
      ...base,
      organizationName: "قهوه‌خانه‌ی وافلو",
      programName: "هەشت سەردان قهوەیەک دەدەت",
      rewardSummary: "قهوەی ماڵی بەخۆرایی",
    };
  }
  return base;
}

async function renderPair(
  locale: string,
  profile: "APPLE_LEGACY" | "APPLE_IOS27" | "GOOGLE_WALLET",
  options: {
    readonly content?: Partial<PreviewContent>;
    readonly logoDataUri?: string;
  } = {},
) {
  const content = { ...localizedBase(locale), ...options.content };
  const serverProfile = profile === "GOOGLE_WALLET" ? "GOOGLE_WALLET" : "APPLE_WALLET";
  const stamp = renderStampSvg({
    goal: content.goal,
    progress: content.progress,
    layout: "GRID",
    outputProfile: serverProfile,
    filledColor: content.accentColor,
    emptyColor: content.secondaryColor,
    accentColor: content.accentColor,
    backgroundColor: content.backgroundColor,
    foregroundColor: content.foregroundColor,
    stampSize: 24,
    spacing: 12,
    locale,
  });
  const walletArtwork = await composeDashboardWalletArtwork({
    profile: serverProfile,
    ...(profile === "APPLE_IOS27" ? { appleWalletVariant: "POSTER" as const } : {}),
    locale,
    renderedStamp: stamp,
    stampSize: 24,
    ...content,
  });
  const server = composeProgramPreview({
    profile: serverProfile,
    ...(profile === "APPLE_IOS27" ? { appleWalletVariant: "POSTER" as const } : {}),
    locale,
    shortDescription: "Earn rewards with every visit.",
    terms: "One stamp per visit.",
    stampSvg: stamp.svg,
    stampLayout: "GRID",
    customerWebVariant: "CARD",
    apple: {
      headerLabel: "Stamps",
      headerValue: "4/8",
      secondaryLabel: "Reward",
      barcodeLabel: "Membership",
      showBackContent: true,
    },
    google: {
      title: content.programName,
      subtitle: content.organizationName,
      detailsLabel: "Reward",
      barcodeLabel: "Membership",
    },
    ...content,
    ...(options.logoDataUri ? { logoDataUri: options.logoDataUri } : {}),
    walletArtwork,
  });
  const browserInput = {
    profile,
    locale,
    stampSvg: stamp.svg,
    stampArtwork: {
      width: stamp.width,
      height: stamp.height,
      contentDigest: stamp.digest,
      positions: stamp.positions,
      stampSize: 24,
    },
    ...content,
    ...(options.logoDataUri ? { logoDataUri: options.logoDataUri } : {}),
  } as const;
  const qrRequest = dashboardWalletPreviewQrRasterRequest(browserInput);
  const qrRasterDataUri = qrRequest
    ? await createQrPreviewPngDataUri(qrRequest.value, qrRequest)
    : undefined;
  const browser = renderDashboardWalletPreviewSvg({
    ...browserInput,
    ...(qrRasterDataUri ? { qrRasterDataUri } : {}),
  });
  return { browser, server };
}

type Region = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

function boundedRegion(region: Region, width: number, height: number): Region {
  const left = Math.max(0, Math.floor(region.left));
  const top = Math.max(0, Math.floor(region.top));
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.ceil(region.width))),
    height: Math.max(1, Math.min(height - top, Math.ceil(region.height))),
  };
}

function regionsFor(
  profile: "APPLE_LEGACY" | "APPLE_IOS27" | "GOOGLE_WALLET",
): Record<string, Region> {
  if (profile === "APPLE_LEGACY") {
    return {
      shell: { left: 24, top: 20, width: 412, height: 581 },
      artwork: { left: 24, top: 87, width: 412, height: 159 },
      stamps: { left: 48, top: 108, width: 364, height: 117 },
      qr: { left: 151, top: 425, width: 159, height: 159 },
      text: { left: 24, top: 20, width: 412, height: 310 },
    };
  }
  if (profile === "APPLE_IOS27") {
    return {
      shell: { left: 51, top: 20, width: 358, height: 492 },
      artwork: { left: 51, top: 42, width: 358, height: 448 },
      stamps: { left: 110, top: 150, width: 220, height: 114 },
      qr: { left: 322, top: 260, width: 75, height: 75 },
      text: { left: 100, top: 55, width: 250, height: 95 },
    };
  }
  return {
    shell: { left: 24, top: 20, width: 412, height: 524 },
    artwork: { left: 25, top: 220, width: 410, height: 322 },
    stamps: { left: 62, top: 307, width: 336, height: 127 },
    qr: { left: 334, top: 440, width: 80, height: 80 },
    text: { left: 42, top: 45, width: 376, height: 155 },
  };
}

function pixelMetrics(
  first: Buffer,
  second: Buffer,
  width: number,
  region: Region,
): {
  readonly changedPixelPercent: number;
  readonly meanChannelDifference: number;
  readonly differenceBounds: Region | null;
} {
  let changedPixels = 0;
  let absoluteDifference = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  const pixels = region.width * region.height;
  for (let y = region.top; y < region.top + region.height; y += 1) {
    for (let x = region.left; x < region.left + region.width; x += 1) {
      const offset = (y * width + x) * 4;
      let changed = false;
      for (let channel = 0; channel < 4; channel += 1) {
        const difference = Math.abs(
          (first[offset + channel] ?? 0) - (second[offset + channel] ?? 0),
        );
        absoluteDifference += difference;
        changed ||= difference > 0;
      }
      if (changed) {
        changedPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return {
    changedPixelPercent: Number(((changedPixels / pixels) * 100).toFixed(3)),
    meanChannelDifference: Number((absoluteDifference / (pixels * 4)).toFixed(3)),
    differenceBounds:
      maxX < 0 ? null : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

async function compare(
  left: Buffer,
  right: Buffer,
  profile: "APPLE_LEGACY" | "APPLE_IOS27" | "GOOGLE_WALLET",
) {
  const [first, second] = await Promise.all([
    sharp(left).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(right).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (first.info.width !== second.info.width || first.info.height !== second.info.height) {
    throw new Error("Rendered comparison dimensions differ.");
  }
  const full = { left: 0, top: 0, width: first.info.width, height: first.info.height };
  const regional = Object.fromEntries(
    Object.entries(regionsFor(profile)).map(([name, region]) => [
      name,
      pixelMetrics(
        first.data,
        second.data,
        first.info.width,
        boundedRegion(region, first.info.width, first.info.height),
      ),
    ]),
  );
  return {
    width: first.info.width,
    height: first.info.height,
    ...pixelMetrics(first.data, second.data, first.info.width, full),
    regions: regional,
  };
}

async function main(): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  const results: Record<string, unknown> = {};
  for (const { name, locale, profile, options = {} } of [
    { name: "english", locale: "en", profile: "APPLE_LEGACY" },
    { name: "arabic", locale: "ar", profile: "APPLE_IOS27" },
    { name: "sorani", locale: "ckb", profile: "GOOGLE_WALLET" },
    { name: "badini", locale: "ku-Arab-IQ", profile: "GOOGLE_WALLET" },
    {
      name: "long-content",
      locale: "en",
      profile: "GOOGLE_WALLET",
      options: {
        content: {
          programName: "Eight qualifying visits unlock a carefully prepared seasonal coffee reward",
          rewardSummary:
            "A complimentary hand-crafted house coffee is ready after the final qualifying visit.",
        },
      },
    },
    {
      name: "custom-colors",
      locale: "en",
      profile: "GOOGLE_WALLET",
      options: {
        content: {
          backgroundColor: "#D8EEF7",
          foregroundColor: "#103A4C",
          accentColor: "#146C94",
          secondaryColor: "#8FC8DC",
        },
      },
    },
    {
      name: "logo",
      locale: "en",
      profile: "GOOGLE_WALLET",
      options: { logoDataUri: evidenceLogoDataUri },
    },
  ] as const) {
    const { browser, server } = await renderPair(locale, profile, options);
    const backendPath = path.join(outputDirectory, `backend-${name}.png`);
    const frontendPath = path.join(outputDirectory, `frontend-${name}.png`);
    const diffPath = path.join(outputDirectory, `diff-${name}.png`);
    const [backendPng, frontendPng] = await Promise.all([
      sharp(Buffer.from(server.svg)).png().toBuffer(),
      sharp(Buffer.from(browser.svg)).png().toBuffer(),
    ]);
    await Promise.all([
      sharp(backendPng).toFile(backendPath),
      sharp(frontendPng).toFile(frontendPath),
      sharp(frontendPng)
        .composite([{ input: backendPng, blend: "difference" }])
        .png()
        .toFile(diffPath),
    ]);
    results[name] = await compare(backendPng, frontendPng, profile);
  }
  await writeFile(
    path.join(outputDirectory, "metrics.json"),
    `${JSON.stringify(results, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(results, null, 2));
}

void main();
