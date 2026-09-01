"use client";

import { memo, useLayoutEffect, useRef } from "react";

export const WalletPreviewCanvas = memo(function WalletPreviewCanvas({
  ariaLabel,
  height,
  profile,
  svg,
  width,
}: {
  ariaLabel: string;
  height: number;
  profile: "APPLE_LEGACY" | "APPLE_IOS27" | "APPLE_WALLET" | "GOOGLE_WALLET";
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
  }, [height, svg, width]);

  return (
    <canvas
      aria-label={ariaLabel}
      className="wallet-preview-image-stack__canvas"
      data-wallet-profile={profile}
      data-preview-ready="false"
      height={height}
      ref={canvasRef}
      role="img"
      style={{ aspectRatio: `${width} / ${height}`, height: "auto" }}
      width={width}
    />
  );
});
