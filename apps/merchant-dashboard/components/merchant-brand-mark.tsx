"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { apiUrl } from "../lib/api-client";

const privateImageCache = new Map<string, Promise<string | null>>();

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Invalid image")),
    );
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Invalid image")));
    reader.readAsDataURL(blob);
  });
}

function loadPrivateImage(source: string): Promise<string | null> {
  const cached = privateImageCache.get(source);
  if (cached) return cached;

  const request = fetch(source, { credentials: "include", cache: "no-store" })
    .then((response) => {
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
        throw new Error("Merchant brand image is unavailable.");
      }
      return response.blob();
    })
    .then(blobDataUrl)
    .catch(() => null);
  privateImageCache.set(source, request);
  return request;
}

function assetSource(contentUrl: string | null | undefined): string | null {
  if (!contentUrl) return null;
  if (contentUrl.startsWith("/")) return `${apiUrl}${contentUrl}`;
  try {
    const parsed = new URL(contentUrl);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function MerchantBrandMark({
  contentUrl,
  className,
  size = 96,
  fallback = "W",
}: {
  contentUrl?: string | null | undefined;
  className: string;
  size?: number;
  fallback?: ReactNode;
}) {
  const [source, setSource] = useState<string | null>(null);
  const resolved = assetSource(contentUrl);

  useEffect(() => {
    let active = true;
    setSource(null);
    if (!resolved) return undefined;

    void loadPrivateImage(resolved).then((loadedSource) => {
      if (!active) return;
      setSource(loadedSource);
    });

    return () => {
      active = false;
    };
  }, [resolved]);

  return source ? (
    <Image
      alt=""
      aria-hidden="true"
      className={className}
      height={size}
      src={source}
      unoptimized
      width={size}
    />
  ) : (
    <span className={className} aria-hidden="true">
      {fallback}
    </span>
  );
}
