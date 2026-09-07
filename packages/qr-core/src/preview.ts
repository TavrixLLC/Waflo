import QRCode from "qrcode";

/**
 * Browser-safe deterministic QR markup for non-secret dashboard previews.
 * Runtime credential QR encoding remains in the server-only qr-core entrypoint.
 */
export function createQrPreviewMarkup(
  value: string,
  options: { margin?: number; errorCorrectionLevel?: "M" | "Q" | "H" } = {},
): { viewSize: number; markup: string } {
  const margin = Math.max(0, Math.min(8, Math.floor(options.margin ?? 4)));
  const qr = QRCode.create(value, {
    errorCorrectionLevel: options.errorCorrectionLevel ?? "Q",
  });
  const moduleCount = qr.modules.size;
  const viewSize = moduleCount + margin * 2;
  const rows: string[] = [];
  for (let row = 0; row < moduleCount; row += 1) {
    const runs: string[] = [];
    let column = 0;
    while (column < moduleCount) {
      if (qr.modules.data[row * moduleCount + column] === 0) {
        column += 1;
        continue;
      }
      const start = column;
      while (column < moduleCount && qr.modules.data[row * moduleCount + column] !== 0) {
        column += 1;
      }
      runs.push(`M${start + margin} ${row + margin}h${column - start}v1h-${column - start}z`);
    }
    if (runs.length) rows.push(`<path d="${runs.join("")}"/>`);
  }
  return {
    viewSize,
    // Keep the browser-safe preview on the same approved dark module colour
    // used by createQrPng/createQrSvg in the server-only entrypoint.
    markup: `<rect width="${viewSize}" height="${viewSize}" fill="#FFFFFFFF"/><g fill="#241916">${rows.join("")}</g>`,
  };
}

/**
 * Returns the exact pixel grid used by the server-side `createQrPng` path,
 * represented as browser-safe SVG paths.  This is deliberately not a second
 * QR encoder: the module matrix still comes from `qrcode`; only its approved
 * PNG pixel allocation is made available to the browser renderer.
 *
 * A QR module is not always an integer number of pixels wide.  The Node PNG
 * renderer assigns each output pixel with `floor((pixel - margin) / scale)`.
 * Reusing that rule avoids the visible module-boundary drift produced by a
 * generic SVG `viewBox` scale at Wallet artwork sizes.
 */
export function createQrPreviewRasterMarkup(
  value: string,
  options: {
    width: number;
    margin?: number;
    errorCorrectionLevel?: "M" | "Q" | "H";
  },
): { width: number; viewSize: number; moduleCount: number; markup: string } {
  const margin = Math.max(0, Math.min(8, Math.floor(options.margin ?? 4)));
  const qr = QRCode.create(value, {
    errorCorrectionLevel: options.errorCorrectionLevel ?? "Q",
  });
  const moduleCount = qr.modules.size;
  const viewSize = moduleCount + margin * 2;
  // Mirrors qrcode/lib/renderer/utils.js getImageWidth(). `createQrPng`
  // accepts a pixel width and always returns an image at this floored size.
  const width = Math.max(viewSize, Math.floor(options.width));
  const scale = width / viewSize;
  const scaledMargin = margin * scale;
  const rows: string[] = [];

  for (let y = 0; y < width; y += 1) {
    if (y < scaledMargin || y >= width - scaledMargin) continue;
    const moduleRow = Math.floor((y - scaledMargin) / scale);
    if (moduleRow < 0 || moduleRow >= moduleCount) continue;
    const runs: string[] = [];
    let x = 0;
    while (x < width) {
      if (x < scaledMargin || x >= width - scaledMargin) {
        x += 1;
        continue;
      }
      const moduleColumn = Math.floor((x - scaledMargin) / scale);
      if (
        moduleColumn < 0 ||
        moduleColumn >= moduleCount ||
        qr.modules.data[moduleRow * moduleCount + moduleColumn] === 0
      ) {
        x += 1;
        continue;
      }
      const start = x;
      x += 1;
      while (x < width) {
        if (x < scaledMargin || x >= width - scaledMargin) break;
        const nextColumn = Math.floor((x - scaledMargin) / scale);
        if (
          nextColumn < 0 ||
          nextColumn >= moduleCount ||
          qr.modules.data[moduleRow * moduleCount + nextColumn] === 0
        )
          break;
        x += 1;
      }
      runs.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
    }
    if (runs.length) rows.push(`<path d="${runs.join("")}"/>`);
  }

  return {
    width,
    viewSize,
    moduleCount,
    markup: `<rect width="${width}" height="${width}" fill="#FFFFFFFF"/><g fill="#241916">${rows.join("")}</g>`,
  };
}

/**
 * Produces the same non-secret preview QR raster as the server PNG encoder.
 * In a browser the package's browser entry renders the module matrix to an
 * in-memory canvas; in Node the same call uses the PNG renderer.  Either way
 * the render options and pixel allocation remain canonical.
 */
export async function createQrPreviewPngDataUri(
  value: string,
  options: {
    width: number;
    margin?: number;
    errorCorrectionLevel?: "M" | "Q" | "H";
  },
): Promise<string> {
  const margin = Math.max(0, Math.min(8, Math.floor(options.margin ?? 4)));
  const qr = QRCode.create(value, {
    errorCorrectionLevel: options.errorCorrectionLevel ?? "Q",
  });
  const viewSize = qr.modules.size + margin * 2;
  const width = Math.max(viewSize, Math.floor(options.width));
  return QRCode.toDataURL(value, {
    type: "image/png",
    width,
    margin,
    errorCorrectionLevel: options.errorCorrectionLevel ?? "Q",
    color: { dark: "#241916", light: "#FFFFFFFF" },
  });
}
