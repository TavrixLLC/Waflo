/**
 * Local-only iteration-03 evidence harness. It deliberately loads candidate
 * WASM packages from explicit temporary paths so an unproven renderer is not
 * added to the production bundle or workspace dependency graph.
 *
 * Required environment variables:
 * - WAFLO_WASM_VIPS_PATH: package root for wasm-vips
 * - WAFLO_RESVG_WASM_PATH: package root for @resvg/resvg-wasm
 */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
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
  "C:/Users/Alhamza Nazhan/Desktop/TestRES/wallet-preview-frontend-parity/iteration-03-shared-rasterizer";
const require = createRequire(import.meta.url);
// biome-ignore lint/suspicious/noUndeclaredEnvVars: This local-only spike is not a Turbo task.
const wasmVipsPath = process.env.WAFLO_WASM_VIPS_PATH;
// biome-ignore lint/suspicious/noUndeclaredEnvVars: This local-only spike is not a Turbo task.
const resvgWasmPath = process.env.WAFLO_RESVG_WASM_PATH;

if (!wasmVipsPath || !resvgWasmPath) {
  throw new Error("The local WASM candidate paths are required for this evidence harness.");
}

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
type PreviewProfile = "APPLE_LEGACY" | "APPLE_IOS27" | "GOOGLE_WALLET";

const evidenceLogoDataUri = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="20" fill="#125B72"/><path d="M20 48h56M48 20v56" stroke="#F8E3B1" stroke-width="10"/></svg>',
  "utf8",
).toString("base64")}`;

function localizedBase(locale: string): PreviewContent {
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
      programName: "هەشت سەردان قاوەیەک دەدەت",
      rewardSummary: "قاوەی ماڵی بەخۆڕایی",
    };
  }
  return base;
}

type Fixture = {
  readonly name: string;
  readonly locale: string;
  readonly profile: PreviewProfile;
  readonly options?: {
    readonly content?: Partial<PreviewContent>;
    readonly logoDataUri?: string;
  };
};

const fixtures: readonly Fixture[] = [
  { name: "english", locale: "en", profile: "APPLE_LEGACY" },
  { name: "arabic", locale: "ar", profile: "APPLE_IOS27" },
  { name: "sorani", locale: "ckb", profile: "GOOGLE_WALLET" },
  { name: "badini", locale: "ku-Arab-IQ", profile: "GOOGLE_WALLET" },
  {
    name: "long",
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
    name: "colors",
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
];

type Region = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};
type Metric = {
  readonly width: number;
  readonly height: number;
  readonly exactPixels: number;
  readonly exactPixelPercent: number;
  readonly changedPixels: number;
  readonly changedPixelPercent: number;
  readonly meanChannelDifference: number;
  readonly maxChannelDifference: number;
  readonly rmse: number;
  readonly differenceBounds: Region | null;
};

type WasmVipsImage = {
  readonly pngsaveBuffer: (options: { readonly compression: number }) => Uint8Array;
  readonly delete: () => void;
};

type WasmVipsRuntime = {
  readonly Image: {
    readonly svgloadBuffer: (input: Uint8Array, options: { readonly dpi: number }) => WasmVipsImage;
    readonly pngloadBuffer: (input: Uint8Array) => WasmVipsImage;
  };
  readonly Stats: {
    readonly mem: () => number;
    readonly memHighwater: () => number;
  };
  readonly version: () => string;
  readonly config: () => unknown;
  readonly shutdown: () => void;
};

type WasmVipsFactory = (options: {
  readonly dynamicLibraries: readonly string[];
}) => Promise<WasmVipsRuntime>;

function percentile(values: readonly number[], value: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  return (
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * value) - 1))] ?? 0
  );
}

async function metric(left: Buffer, right: Buffer): Promise<Metric> {
  const [first, second] = await Promise.all([
    sharp(left).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(right).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (first.info.width !== second.info.width || first.info.height !== second.info.height) {
    throw new Error("Candidate dimensions differ from the native Sharp baseline.");
  }
  let exactPixels = 0;
  let changedPixels = 0;
  let absoluteDifference = 0;
  let squaredDifference = 0;
  let maxChannelDifference = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < first.info.width * first.info.height; pixel += 1) {
    let changed = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const index = pixel * 4 + channel;
      const difference = Math.abs((first.data[index] ?? 0) - (second.data[index] ?? 0));
      absoluteDifference += difference;
      squaredDifference += difference ** 2;
      maxChannelDifference = Math.max(maxChannelDifference, difference);
      changed ||= difference !== 0;
    }
    if (!changed) {
      exactPixels += 1;
      continue;
    }
    changedPixels += 1;
    const x = pixel % first.info.width;
    const y = Math.floor(pixel / first.info.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const pixels = first.info.width * first.info.height;
  return {
    width: first.info.width,
    height: first.info.height,
    exactPixels,
    exactPixelPercent: Number(((exactPixels / pixels) * 100).toFixed(5)),
    changedPixels,
    changedPixelPercent: Number(((changedPixels / pixels) * 100).toFixed(5)),
    meanChannelDifference: Number((absoluteDifference / (pixels * 4)).toFixed(5)),
    maxChannelDifference,
    rmse: Number(Math.sqrt(squaredDifference / (pixels * 4)).toFixed(5)),
    differenceBounds:
      maxX < 0 ? null : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

async function saveComparison(
  name: string,
  native: Buffer,
  candidate: Buffer,
  prefix = "operation",
): Promise<Metric> {
  const nativeName = prefix === "main" ? `sharp-${name}.png` : `${prefix}-${name}.png`;
  const candidateName =
    prefix === "main" ? `candidate-${name}.png` : `${prefix}-candidate-${name}.png`;
  const diffName = prefix === "main" ? `diff-${name}.png` : `${prefix}-${name}-diff.png`;
  await Promise.all([
    sharp(native).png().toFile(path.join(outputDirectory, nativeName)),
    sharp(candidate).png().toFile(path.join(outputDirectory, candidateName)),
    sharp(candidate)
      .composite([{ input: native, blend: "difference" }])
      .png()
      .toFile(path.join(outputDirectory, diffName)),
  ]);
  return metric(native, candidate);
}

async function renderFixture(fixture: Fixture) {
  const content = { ...localizedBase(fixture.locale), ...fixture.options?.content };
  const serverProfile = fixture.profile === "GOOGLE_WALLET" ? "GOOGLE_WALLET" : "APPLE_WALLET";
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
    locale: fixture.locale,
  });
  const artwork = await composeDashboardWalletArtwork({
    profile: serverProfile,
    ...(fixture.profile === "APPLE_IOS27" ? { appleWalletVariant: "POSTER" as const } : {}),
    locale: fixture.locale,
    renderedStamp: stamp,
    stampSize: 24,
    ...content,
  });
  const server = composeProgramPreview({
    profile: serverProfile,
    ...(fixture.profile === "APPLE_IOS27" ? { appleWalletVariant: "POSTER" as const } : {}),
    locale: fixture.locale,
    shortDescription: "Earn rewards with every visit.",
    terms: "One stamp per visit.",
    stampSvg: stamp.svg,
    stampLayout: "GRID",
    customerWebVariant: "CARD",
    apple: {
      headerLabel: "Stamps",
      headerValue: `${content.progress}/${content.goal}`,
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
    ...(fixture.options?.logoDataUri ? { logoDataUri: fixture.options.logoDataUri } : {}),
    walletArtwork: artwork,
  });
  const browserInput = {
    profile: fixture.profile,
    locale: fixture.locale,
    stampSvg: stamp.svg,
    stampArtwork: {
      width: stamp.width,
      height: stamp.height,
      contentDigest: stamp.digest,
      positions: stamp.positions,
      stampSize: 24,
    },
    ...content,
    ...(fixture.options?.logoDataUri ? { logoDataUri: fixture.options.logoDataUri } : {}),
  } as const;
  const qrRequest = dashboardWalletPreviewQrRasterRequest(browserInput);
  const qrRasterDataUri = qrRequest
    ? await createQrPreviewPngDataUri(qrRequest.value, qrRequest)
    : undefined;
  const browser = renderDashboardWalletPreviewSvg({
    ...browserInput,
    ...(qrRasterDataUri ? { qrRasterDataUri } : {}),
  });
  return { artwork, browser, server, stamp };
}

function dataUriBytes(value: string): Buffer {
  return Buffer.from(value.split(",", 2)[1] ?? "", "base64");
}

async function main(): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  const initialFixture = fixtures[0];
  if (!initialFixture) {
    throw new Error("The required first raster fixture is unavailable.");
  }
  // Build the representative composition before initializing the candidate so
  // the first render measurement includes only candidate raster work.
  const firstFixture = await renderFixture(initialFixture);
  const Vips = require(wasmVipsPath) as WasmVipsFactory;
  const wasmVipsStarted = performance.now();
  const vips = await Vips({ dynamicLibraries: ["vips-resvg.wasm"] });
  const wasmVipsInitMs = performance.now() - wasmVipsStarted;
  const resvgModule = (await import(pathToFileURL(path.join(resvgWasmPath, "index.mjs")).href)) as {
    initWasm(input: Uint8Array): Promise<void>;
    Resvg: new (
      svg: Uint8Array | string,
      options?: Record<string, unknown>,
    ) => {
      render(): { asPng(): Uint8Array; free(): void };
      free(): void;
    };
  };
  const resvgStarted = performance.now();
  await resvgModule.initWasm(
    new Uint8Array(await readFile(path.join(resvgWasmPath, "index_bg.wasm"))),
  );
  const resvgInitMs = performance.now() - resvgStarted;

  const renderVipsSvg = (svg: string, dpi = 72): Buffer => {
    const image = vips.Image.svgloadBuffer(new Uint8Array(Buffer.from(svg, "utf8")), { dpi });
    try {
      return Buffer.from(image.pngsaveBuffer({ compression: 9 }));
    } finally {
      image.delete();
    }
  };
  const renderVipsPng = (input: Buffer): Buffer => {
    const image = vips.Image.pngloadBuffer(new Uint8Array(input));
    try {
      return Buffer.from(image.pngsaveBuffer({ compression: 9 }));
    } finally {
      image.delete();
    }
  };
  const renderResvg = (svg: string): Buffer => {
    const renderer = new resvgModule.Resvg(svg, { fitTo: { mode: "original" } });
    try {
      const rendered = renderer.render();
      try {
        return Buffer.from(rendered.asPng());
      } finally {
        rendered.free();
      }
    } finally {
      renderer.free();
    }
  };

  const firstRenderStarted = performance.now();
  renderVipsSvg(firstFixture.server.svg);
  const firstRenderMs = performance.now() - firstRenderStarted;

  const operations: Record<string, Metric | { readonly error: string }> = {};
  const solidSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="127" height="73"><rect width="127" height="73" fill="#1D5B79"/><circle cx="87" cy="32" r="24" fill="#F2BC62" opacity=".72"/></svg>';
  const solidNative = await sharp(Buffer.from(solidSvg)).png().toBuffer();
  operations.solid = await saveComparison("solid", solidNative, renderVipsSvg(solidSvg));
  const logoSvg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="20" fill="#125B72"/><path d="M20 48h56M48 20v56" stroke="#F8E3B1" stroke-width="10"/></svg>',
  );
  const logoNative = await sharp(logoSvg).png().toBuffer();
  operations.logo = await saveComparison(
    "logo",
    logoNative,
    renderVipsSvg(logoSvg.toString("utf8")),
  );
  const textSamples = {
    "text-english": "Waflo Coffee",
    "text-arabic": "مقهى وافلو",
    "text-sorani": "کافێی وافلۆ",
  } as const;
  for (const [name, text] of Object.entries(textSamples)) {
    const font =
      name === "text-english" ? "Arial,sans-serif" : "'Noto Sans Arabic',Arial,sans-serif";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="96"><rect width="100%" height="100%" fill="#F5E5D2"/><text direction="${name === "text-english" ? "ltr" : "rtl"}" unicode-bidi="plaintext" x="340" y="64" text-anchor="end" font-family="${font}" font-size="38" font-weight="700" fill="#2A1710">${text}</text></svg>`;
    operations[name] = await saveComparison(
      name,
      await sharp(Buffer.from(svg)).png().toBuffer(),
      renderVipsSvg(svg),
    );
  }
  const [, arabicFixture, soraniFixture] = fixtures;
  if (!arabicFixture || !soraniFixture) {
    throw new Error("The required Arabic and Sorani fixtures are unavailable.");
  }
  const stampNative = await sharp(Buffer.from(firstFixture.stamp.svg), { density: 216 })
    .png()
    .toBuffer();
  operations.stamp = await saveComparison(
    "stamp",
    stampNative,
    renderVipsSvg(firstFixture.stamp.svg, 216),
  );
  const googleFixture = await renderFixture(soraniFixture);
  const googleInput = dashboardWalletPreviewQrRasterRequest({
    profile: "GOOGLE_WALLET",
    locale: "ckb",
    organizationName: "کافێی وافلۆ",
    programName: "هەشت سەردان قاوەیەکت پێدەدات",
    rewardSummary: "قاوەی ماڵی بەخۆڕایی",
    progress: 4,
    goal: 8,
    stampSvg: googleFixture.stamp.svg,
    stampArtwork: {
      width: googleFixture.stamp.width,
      height: googleFixture.stamp.height,
      contentDigest: googleFixture.stamp.digest,
      positions: googleFixture.stamp.positions,
      stampSize: 24,
    },
    ...localizedBase("ckb"),
  });
  if (googleInput) {
    const qr = await createQrPreviewPngDataUri(googleInput.value, googleInput);
    const qrNative = dataUriBytes(qr);
    operations.qr = await saveComparison("qr", qrNative, renderVipsPng(qrNative));
  }

  const scenarioResults: Record<string, unknown> = {};
  for (const fixture of fixtures) {
    const rendered = await renderFixture(fixture);
    const native = await sharp(Buffer.from(rendered.server.svg, "utf8")).png().toBuffer();
    const candidate = renderVipsSvg(rendered.server.svg);
    const resvg = renderResvg(rendered.server.svg);
    const candidateMetric = await saveComparison(fixture.name, native, candidate, "main");
    const resvgMetric = await metric(native, resvg);
    await sharp(resvg)
      .png()
      .toFile(path.join(outputDirectory, `resvg-${fixture.name}.png`));
    scenarioResults[fixture.name] = {
      wasmVips: candidateMetric,
      resvg: resvgMetric,
      nativeTarget: rendered.artwork.target,
      nativeDimensions: { width: rendered.artwork.width, height: rendered.artwork.height },
    };
  }
  const posterFixture = await renderFixture(arabicFixture);
  operations.poster = await saveComparison(
    "poster",
    await sharp(Buffer.from(posterFixture.server.svg)).png().toBuffer(),
    renderVipsSvg(posterFixture.server.svg),
  );

  const latencySamples: number[] = [];
  const warmSvg = (await renderFixture(soraniFixture)).server.svg;
  for (let index = 0; index < 12; index += 1) {
    const started = performance.now();
    renderVipsSvg(warmSvg);
    latencySamples.push(performance.now() - started);
  }
  const metrics = {
    generatedAt: new Date().toISOString(),
    canonicalPlanParity: "100% (validated by dashboard-wallet-preview-parity.test.ts)",
    backend: {
      sharp: sharp.versions.sharp,
      libvips: sharp.versions.vips,
      rsvg: sharp.versions.rsvg,
      pango: sharp.versions.pango,
      fontconfig: sharp.versions.fontconfig,
    },
    candidates: {
      wasmVips: {
        libvips: vips.version(),
        config: vips.config(),
        packageBytes: 12502001,
        runtimeInitializationMs: Number(wasmVipsInitMs.toFixed(2)),
        firstRenderMs: Number(firstRenderMs.toFixed(2)),
        warmRenderMs: {
          p50: Number(percentile(latencySamples, 0.5).toFixed(2)),
          p95: Number(percentile(latencySamples, 0.95).toFixed(2)),
        },
        memory: {
          current: vips.Stats.mem(),
          highwater: vips.Stats.memHighwater(),
        },
        requiredBrowserHeaders: [
          "Cross-Origin-Opener-Policy: same-origin",
          "Cross-Origin-Embedder-Policy: require-corp",
        ],
      },
      resvgWasm: {
        packageBytes: 2526600,
        runtimeInitializationMs: Number(resvgInitMs.toFixed(2)),
        license: "MPL-2.0",
      },
    },
    operations,
    scenarios: scenarioResults,
  };
  await writeFile(
    path.join(outputDirectory, "metrics.json"),
    `${JSON.stringify(metrics, null, 2)}\n`,
  );
  console.log(JSON.stringify(metrics, null, 2));
  vips.shutdown();
}

void main();
