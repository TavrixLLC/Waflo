"use client";

import { memo, useLayoutEffect, useRef } from "react";
import { walletPreviewQrOverlay, walletPreviewQrRows } from "./program-preview-optimistic";

const walletPreviewQrViewSize = 37;
const walletPreviewQrQuietZone = 4;
const walletPreviewQrPixelSize = 4;
const walletPreviewQrCanvasSize = walletPreviewQrViewSize * walletPreviewQrPixelSize;

function paintWalletPreviewQr(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return;
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, walletPreviewQrCanvasSize, walletPreviewQrCanvasSize);
  context.fillStyle = "#111827";
  walletPreviewQrRows.forEach((hex, row) => {
    const bits = BigInt(`0x${hex}`);
    for (let column = 0; column < 29; column += 1) {
      if (((bits >> BigInt(28 - column)) & 1n) === 0n) continue;
      context.fillRect(
        (column + walletPreviewQrQuietZone) * walletPreviewQrPixelSize,
        (row + walletPreviewQrQuietZone) * walletPreviewQrPixelSize,
        walletPreviewQrPixelSize,
        walletPreviewQrPixelSize,
      );
    }
  });
}

function percentage(value: string): number {
  return Number.parseFloat(value) / 100;
}

export const WalletPreviewCanvas = memo(function WalletPreviewCanvas({
  ariaLabel,
  height,
  profile,
  svg,
  width,
}: {
  ariaLabel: string;
  height: number;
  profile: "APPLE_WALLET" | "GOOGLE_WALLET";
  svg: string;
  width: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.dataset.previewReady = "false";
    let cancelled = false;
    const previewImage = new Image();
    previewImage.decoding = "sync";
    previewImage.onload = () => {
      if (cancelled) return;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      context.imageSmoothingEnabled = true;
      context.clearRect(0, 0, width, height);
      context.drawImage(previewImage, 0, 0, width, height);

      const qrCanvas = document.createElement("canvas");
      qrCanvas.width = walletPreviewQrCanvasSize;
      qrCanvas.height = walletPreviewQrCanvasSize;
      paintWalletPreviewQr(qrCanvas);
      const overlay = walletPreviewQrOverlay(profile);
      context.imageSmoothingEnabled = false;
      context.drawImage(
        qrCanvas,
        Math.round(width * percentage(overlay.left)),
        Math.round(height * percentage(overlay.top)),
        Math.round(width * percentage(overlay.width)),
        Math.round(height * percentage(overlay.height)),
      );
      canvas.dataset.previewReady = "true";
    };
    previewImage.onerror = () => {
      if (!cancelled) canvas.dataset.previewReady = "false";
    };
    previewImage.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    return () => {
      cancelled = true;
      previewImage.onload = null;
      previewImage.onerror = null;
    };
  }, [height, profile, svg, width]);

  return (
    <canvas
      aria-label={ariaLabel}
      className="wallet-preview-image-stack__canvas"
      data-preview-ready="false"
      height={height}
      ref={canvasRef}
      role="img"
      width={width}
    />
  );
});
