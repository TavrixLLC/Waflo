/**
 * Iteration-04 local-only feasibility evidence.
 *
 * This is deliberately not imported by application code. It reads the actual
 * Sharp runtime and compares native Sharp/libvips SVG output with the same
 * wasm-vips experiment used in iteration 03. It isolates opaque fill and
 * antialiased-vector behaviour using decoded, lossless RGBA rather than a
 * browser screenshot pipeline.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import sharp from "sharp";

const outputDirectory =
  "C:/Users/Alhamza Nazhan/Desktop/TestRES/wallet-preview-frontend-parity/iteration-04-native-stack-feasibility";
const require = createRequire(import.meta.url);
// biome-ignore lint/suspicious/noUndeclaredEnvVars: Local-only spike, never a Turbo task.
const wasmVipsPath = process.env.WAFLO_WASM_VIPS_PATH;
const emittedNotoFont =
  "C:/WafloProject/waflo-release-final/apps/merchant-dashboard/.next/static/media/3fd1b3eda9c5392f-s.p.28efgb-r-zxeb.woff2";

interface WasmVipsImage {
  pngsaveBuffer(options: { readonly compression: number }): Uint8Array;
  delete(): void;
}

interface WasmVipsRuntime {
  readonly Image: {
    svgloadBuffer(input: Uint8Array, options: { readonly dpi: number }): WasmVipsImage;
  };
  version(): string;
  config(): string;
}

type WasmVipsFactory = (options: {
  readonly dynamicLibraries: readonly string[];
}) => Promise<WasmVipsRuntime>;

interface RgbaMetric {
  readonly width: number;
  readonly height: number;
  readonly exactPixels: number;
  readonly exactPixelPercent: number;
  readonly changedPixels: number;
  readonly changedPixelPercent: number;
  readonly meanChannelDifference: number;
  readonly maxChannelDifference: number;
  readonly differenceBounds: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  } | null;
}

async function rgba(input: Buffer): Promise<{
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
  readonly metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
}> {
  const decoded = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    data: decoded.data,
    width: decoded.info.width,
    height: decoded.info.height,
    metadata: await sharp(input).metadata(),
  };
}

function compareRgba(
  left: Awaited<ReturnType<typeof rgba>>,
  right: Awaited<ReturnType<typeof rgba>>,
): RgbaMetric {
  if (
    left.width !== right.width ||
    left.height !== right.height ||
    left.data.length !== right.data.length
  ) {
    throw new Error(
      `Comparison dimensions differ: ${left.width}x${left.height}/${left.data.length} versus ${right.width}x${right.height}/${right.data.length}.`,
    );
  }
  let exactPixels = 0;
  let changedPixels = 0;
  let totalDifference = 0;
  let maxChannelDifference = 0;
  let minX = left.width;
  let minY = left.height;
  let maxX = -1;
  let maxY = -1;

  for (let offset = 0; offset < left.data.length; offset += 4) {
    let pixelChanged = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const difference = Math.abs(
        (left.data[offset + channel] ?? 0) - (right.data[offset + channel] ?? 0),
      );
      totalDifference += difference;
      maxChannelDifference = Math.max(maxChannelDifference, difference);
      pixelChanged ||= difference !== 0;
    }
    if (!pixelChanged) {
      exactPixels += 1;
      continue;
    }
    changedPixels += 1;
    const pixelIndex = offset / 4;
    const x = pixelIndex % left.width;
    const y = Math.floor(pixelIndex / left.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const totalPixels = left.width * left.height;
  return {
    width: left.width,
    height: left.height,
    exactPixels,
    exactPixelPercent: Number(((exactPixels / totalPixels) * 100).toFixed(5)),
    changedPixels,
    changedPixelPercent: Number(((changedPixels / totalPixels) * 100).toFixed(5)),
    meanChannelDifference: Number((totalDifference / left.data.length).toFixed(5)),
    maxChannelDifference,
    differenceBounds:
      maxX < 0 ? null : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

async function saveComparison(
  name: string,
  native: Buffer,
  candidate: Buffer,
): Promise<{
  readonly png: RgbaMetric;
  readonly rawRgba: RgbaMetric;
  readonly nativeMetadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  readonly candidateMetadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
}> {
  const [nativeRgba, candidateRgba] = await Promise.all([rgba(native), rgba(candidate)]);
  const rawRgba = compareRgba(nativeRgba, candidateRgba);
  await Promise.all([
    writeFile(path.join(outputDirectory, `${name}-native.png`), native),
    writeFile(path.join(outputDirectory, `${name}-candidate.png`), candidate),
    sharp(candidate)
      .composite([{ input: native, blend: "difference" }])
      .png()
      .toFile(path.join(outputDirectory, `${name}-diff.png`)),
  ]);
  return {
    // PNG comparison is intentionally the decoded-pixel comparison: PNG
    // container compression must not influence visual metrics.
    png: rawRgba,
    rawRgba,
    nativeMetadata: nativeRgba.metadata,
    candidateMetadata: candidateRgba.metadata,
  };
}

async function main(): Promise<void> {
  if (!wasmVipsPath) {
    throw new Error("WAFLO_WASM_VIPS_PATH must point to the temporary wasm-vips package.");
  }
  await mkdir(outputDirectory, { recursive: true });

  const nativeStack = {
    generatedAt: new Date().toISOString(),
    sharp: sharp.versions.sharp,
    libraries: sharp.versions,
    actualBackendOperationBoundary: {
      input: "canonical SVG/image buffers",
      rasterizer: "Sharp -> libvips -> librsvg -> Pango/HarfBuzz/FreeType/Fontconfig -> Cairo",
      output: "lossless PNG then decoded RGBA for comparison",
      glyphRunIntrospection: "not exposed by Sharp's JavaScript API",
    },
  };
  await writeFile(
    path.join(outputDirectory, "native-stack.json"),
    `${JSON.stringify(nativeStack, null, 2)}\n`,
    "utf8",
  );

  const Vips = require(wasmVipsPath) as WasmVipsFactory;
  const started = performance.now();
  const vips = await Vips({ dynamicLibraries: ["vips-resvg.wasm"] });
  const wasmInitializationMs = Number((performance.now() - started).toFixed(2));
  const renderCandidate = (svg: string): Buffer => {
    const image = vips.Image.svgloadBuffer(new Uint8Array(Buffer.from(svg, "utf8")), { dpi: 72 });
    try {
      return Buffer.from(image.pngsaveBuffer({ compression: 9 }));
    } finally {
      image.delete();
    }
  };

  const opaqueRectangleSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="127" height="73"><rect width="127" height="73" fill="#1D5B79"/></svg>';
  const circleSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="127" height="73"><rect width="127" height="73" fill="#1D5B79"/><circle cx="87" cy="32" r="24" fill="#F2BC62" opacity=".72"/></svg>';
  const [opaqueNative, circleNative] = await Promise.all([
    sharp(Buffer.from(opaqueRectangleSvg)).png().toBuffer(),
    sharp(Buffer.from(circleSvg)).png().toBuffer(),
  ]);
  const opaque = await saveComparison(
    "opaque-rectangle",
    opaqueNative,
    renderCandidate(opaqueRectangleSvg),
  );
  const circle = await saveComparison(
    "antialiased-circle",
    circleNative,
    renderCandidate(circleSvg),
  );

  const noto = await readFile(emittedNotoFont);
  const notoInfo = await stat(emittedNotoFont);
  const shapingComparison = {
    nativeBackend: {
      status: "NOT_INTROSPECTABLE_THROUGH_SHARP_JS",
      reason:
        "Sharp exposes raster buffers and dependency versions, not librsvg/Pango glyph IDs, clusters, advances, or outlines. No supported API permits extracting the native PangoGlyphString from the existing backend renderer.",
    },
    harfbuzzJsExperiment: {
      package: "harfbuzzjs@1.6.1",
      status: "NOT_A_COMPARABLE_CANDIDATE",
      nativeHarfbuzz: sharp.versions.harfbuzz,
      candidateBuild: "HB_TINY",
      approvedFont: {
        path: emittedNotoFont,
        format: "WOFF2",
        bytes: notoInfo.size,
        sha256: createHash("sha256").update(noto).digest("hex"),
      },
      observedResult:
        "The stripped candidate produced .notdef glyphs for the emitted WOFF2 Noto subset, while a system TTF sanity sample produced normal glyph IDs. It cannot consume the exact approved WOFF2 font without a separate WOFF2/decompression-capable build or preprocessing path.",
      glyphStructureEqualToNative: "NOT_COMPARABLE",
      outlinesEqualToNative: "NOT_COMPARABLE",
    },
  };
  await writeFile(
    path.join(outputDirectory, "shaping-comparison.json"),
    `${JSON.stringify(shapingComparison, null, 2)}\n`,
    "utf8",
  );

  const colorPipeline = {
    input: {
      logicalDimensions: "127x73",
      physicalDimensions: "127x73",
      devicePixelRatio: "not involved; no browser capture",
      sourceSvgBytes: "identical per native/candidate pair",
      output: "lossless PNG decoded to RGBA with Sharp.ensureAlpha().raw()",
      browserZoom: "not involved",
      cssTransform: "not involved",
      screenshotResampling: "not involved",
    },
    opaqueRectangle: opaque,
    antialiasedCircle: circle,
    conclusion:
      opaque.png.changedPixels === 0
        ? "Opaque fills are exact. The earlier solid-fixture delta is isolated to the partially transparent, antialiased circle edge and is not a screenshot/DPR/PNG-compression defect."
        : "Opaque fills diverged; investigate before attributing differences to vector antialiasing.",
  };
  await writeFile(
    path.join(outputDirectory, "color-pipeline.json"),
    `${JSON.stringify(colorPipeline, null, 2)}\n`,
    "utf8",
  );

  const candidateMatrix = {
    generatedAt: new Date().toISOString(),
    candidates: [
      {
        project: "wasm-vips@0.0.18",
        browserSupport: true,
        effectiveSvgStack: "dynamic Resvg; no Pangocairo; no Fontconfig",
        exactNativeVersionMatch: { libvips: "YES (8.18.3)", svgAndTextStack: "NO" },
        result: "REJECTED in iteration 03 visual comparison",
      },
      {
        project: "@resvg/resvg-wasm@2.6.2",
        browserSupport: true,
        effectiveSvgStack: "Resvg, not librsvg/Pango/Fontconfig",
        exactNativeVersionMatch: "NO",
        result: "REJECTED in iteration 03 visual comparison",
      },
      {
        project: "VitoVan/pango-cairo-wasm",
        browserSupport: "demonstrated with Emscripten",
        effectiveSvgStack:
          "PangoCairo with FreeType/Fontconfig/HarfBuzz, but no librsvg distribution",
        exactNativeVersionMatch: {
          pango: "NEAR ONLY (published build instructions use a 1.50.14 fork)",
          librsvg: "NO",
        },
        result:
          "useful custom-build precedent, not a maintained drop-in native-equivalent renderer",
      },
      {
        project: "harfbuzzjs@1.6.1",
        browserSupport: true,
        effectiveSvgStack: "HarfBuzz HB_TINY shaping only; no Pango, Fontconfig, Cairo, or librsvg",
        exactNativeVersionMatch: {
          harfbuzz: "NO (backend 14.2.1)",
          fontInput: "WOFF2 probe failed",
        },
        result: "fallback glyph-plan research only; not a current renderer",
      },
    ],
    customBuild: {
      technicalPossibility: "YES, but very high complexity",
      requiredComponents:
        "Emscripten glue, GLib/GObject, Cairo, Pixman, FreeType, Fontconfig, HarfBuzz, Fribidi, Pango, librsvg Rust/C build, XML/image dependencies, virtual filesystem, pinned fonts and fontconfig files",
      blockersForProductAdoption:
        "No maintained exact-stack browser distribution; exact dependency pins must be maintained; PangoCairo precedent needs pthreads; threads require cross-origin isolation; Waflo currently cannot change COOP/COEP without a separate Stripe/resource compatibility investigation.",
    },
  };
  await writeFile(
    path.join(outputDirectory, "candidate-matrix.json"),
    `${JSON.stringify(candidateMatrix, null, 2)}\n`,
    "utf8",
  );

  const metrics = {
    wasmVips: {
      libvips: vips.version(),
      initializationMs: wasmInitializationMs,
      config: vips.config(),
    },
    controlledRasterMetrics: {
      opaqueRectangle: opaque.png,
      antialiasedCircle: circle.png,
    },
    priorIteration03FullComposition: {
      status: "REJECTED",
      reason:
        "Visible provider-shell text/SVG rasterization divergence despite canonical-plan equality.",
    },
  };
  await writeFile(
    path.join(outputDirectory, "metrics.json"),
    `${JSON.stringify(metrics, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({ nativeStack, colorPipeline, shapingComparison, metrics }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
