"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { apiUrl } from "../lib/api-client";

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
}: {
  contentUrl?: string | null | undefined;
  className: string;
  size?: number;
}) {
  const [source, setSource] = useState<string | null>(null);
  const resolved = assetSource(contentUrl);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setSource(null);
    if (!resolved) return undefined;

    void fetch(resolved, { credentials: "include", cache: "no-store" })
      .then((response) => {
        if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
          throw new Error("Merchant brand image is unavailable.");
        }
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => {
        if (active) setSource(null);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
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
      W
    </span>
  );
}
