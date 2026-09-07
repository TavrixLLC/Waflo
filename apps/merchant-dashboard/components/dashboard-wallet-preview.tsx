"use client";

import { renderStampSvg } from "@waflo/stamp-engine";
import { createQrPreviewPngDataUri } from "@waflo/qr-core/preview";
import {
  dashboardWalletPreviewQrRasterRequest,
  renderDashboardWalletPreviewSvg,
  type DashboardWalletPreviewInput,
  type DashboardWalletPreviewProfile,
} from "@waflo/wallet-artwork/dashboard-preview";
import type { WalletArtworkQrRasterRequest } from "@waflo/wallet-artwork/render-plan";
import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "../lib/api-client";
import { WalletPreviewCanvas } from "./program-preview-qr";
import type { AssetItem, ProgramDraftInput } from "./program-studio-types";

const assetDataUriCache = new Map<string, Promise<string | undefined>>();
const qrDataUriCache = new Map<string, Promise<string>>();

function blobDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Invalid image.")),
    );
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Image load failed.")));
    reader.readAsDataURL(blob);
  });
}

function assetVariantUrl(contentUrl: string | undefined, variant: "STAMP_256" | "ORIGINAL_SAFE") {
  if (!contentUrl?.startsWith("/")) return undefined;
  const url = new URL(contentUrl, apiUrl);
  url.searchParams.set("variant", variant);
  return url.toString();
}

function loadAssetDataUri(source: string | undefined): Promise<string | undefined> {
  if (!source) return Promise.resolve(undefined);
  const cached = assetDataUriCache.get(source);
  if (cached) return cached;
  const request = fetch(source, { credentials: "include", cache: "no-store" })
    .then((response) => {
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
        throw new Error("Preview asset unavailable.");
      }
      return response.blob();
    })
    .then(blobDataUri)
    .catch(() => {
      // A newly processed private asset can briefly be unavailable while its
      // object-store write becomes readable. Never cache that transient miss:
      // the live preview must be able to resolve the selected artwork locally
      // on its next safe retry rather than remain on a previous/default stamp.
      assetDataUriCache.delete(source);
      return undefined;
    });
  assetDataUriCache.set(source, request);
  return request;
}

function assetById(
  assets: readonly AssetItem[],
  id: string | null | undefined,
): AssetItem | undefined {
  return id ? assets.find((asset) => asset.id === id) : undefined;
}

function stampArtworkFromDataUri(value: string | undefined) {
  if (!value) return undefined;
  const match = value.match(/^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,/i);
  if (!match) return undefined;
  const mimeType = match[1];
  if (!mimeType) return undefined;
  return {
    kind: "data-uri" as const,
    value,
    mimeType: mimeType.toLowerCase() as "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml",
    trusted: true as const,
  };
}

function usePreviewAssets(input: {
  readonly assets: readonly AssetItem[];
  readonly draft: ProgramDraftInput;
  readonly merchantBrandLogoUrl?: string;
}) {
  const sources = useMemo(() => {
    const visual = input.draft.visualTheme;
    return {
      filled: assetVariantUrl(
        assetById(input.assets, visual.filledStampAssetId)?.contentUrl,
        "STAMP_256",
      ),
      empty: assetVariantUrl(
        assetById(input.assets, visual.emptyStampAssetId)?.contentUrl,
        "STAMP_256",
      ),
      logo: assetVariantUrl(
        assetById(input.assets, visual.logoAssetId)?.contentUrl,
        "ORIGINAL_SAFE",
      ),
      merchant: assetVariantUrl(input.merchantBrandLogoUrl, "ORIGINAL_SAFE"),
    };
  }, [input.assets, input.draft.visualTheme, input.merchantBrandLogoUrl]);
  const [resolved, setResolved] = useState<
    Record<string, { source: string | undefined; value: string | undefined }>
  >({});

  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const resolve = async (attempt: number) => {
      const entries = await Promise.all(
        Object.entries(sources).map(async ([key, source]) => {
          const value = await loadAssetDataUri(source);
          return [key, { source, value }] as const;
        }),
      );
      if (!active) return;
      setResolved(Object.fromEntries(entries));
      // A private processed variant is expected to be readable immediately,
      // but retry a transient first miss without using a preview-image API.
      if (attempt < 2 && entries.some(([, entry]) => entry.source && !entry.value)) {
        retryTimer = setTimeout(() => void resolve(attempt + 1), 250 * (attempt + 1));
      }
    };
    void resolve(0);
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [sources]);
  return Object.fromEntries(
    Object.entries(sources).map(([key, source]) => [
      key,
      resolved[key]?.source === source ? resolved[key]?.value : undefined,
    ]),
  ) as Record<keyof typeof sources, string | undefined>;
}

function qrRasterKey(request: WalletArtworkQrRasterRequest): string {
  return `${request.value}:${request.width}:${request.margin}:${request.errorCorrectionLevel}`;
}

function loadPreviewQrDataUri(request: WalletArtworkQrRasterRequest): Promise<string> {
  const key = qrRasterKey(request);
  const cached = qrDataUriCache.get(key);
  if (cached) return cached;
  const created = createQrPreviewPngDataUri(request.value, request);
  qrDataUriCache.set(key, created);
  return created;
}

/**
 * The QR is rasterized locally from the render plan. It never calls the API;
 * the vector plan remains visible during this short in-memory conversion.
 */
function usePreviewQrRaster(request: WalletArtworkQrRasterRequest | undefined): string | undefined {
  const [dataUri, setDataUri] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    setDataUri(undefined);
    if (!request)
      return () => {
        active = false;
      };
    void loadPreviewQrDataUri(request)
      .then((value) => {
        if (active) setDataUri(value);
      })
      .catch(() => {
        // The pure SVG plan remains the safe local fallback. No server-image
        // request is ever made if browser QR rasterization is unavailable.
      });
    return () => {
      active = false;
    };
  }, [request]);

  return dataUri;
}

export function DashboardWalletPreview({
  ariaLabel,
  assets,
  draft,
  merchantBrandLogoUrl,
  organizationName,
  profile,
  locale,
  progress,
}: {
  readonly ariaLabel: string;
  readonly assets: readonly AssetItem[];
  readonly draft: ProgramDraftInput;
  readonly merchantBrandLogoUrl?: string;
  readonly organizationName: string;
  readonly profile: DashboardWalletPreviewProfile;
  readonly locale: string;
  readonly progress: number;
}) {
  const previewAssets = usePreviewAssets({
    assets,
    draft,
    ...(merchantBrandLogoUrl ? { merchantBrandLogoUrl } : {}),
  });
  const previewInput = useMemo<DashboardWalletPreviewInput>(() => {
    const content =
      draft.translations[locale] ??
      draft.translations[draft.defaultLocale] ??
      draft.translations.en;
    const theme = draft.visualTheme;
    const walletProfile = profile === "GOOGLE_WALLET" ? "GOOGLE_WALLET" : "APPLE_WALLET";
    const filledArtwork = stampArtworkFromDataUri(previewAssets.filled);
    const emptyArtwork = stampArtworkFromDataUri(previewAssets.empty);
    const stamp = renderStampSvg({
      goal: draft.requiredStampCount,
      progress,
      layout: "GRID",
      filledColor: theme.accentColor,
      emptyColor: theme.secondaryColor,
      accentColor: theme.accentColor,
      backgroundColor: theme.backgroundColor,
      foregroundColor: theme.foregroundColor,
      stampSize: theme.stampSize,
      spacing: theme.stampSpacing,
      ...(filledArtwork ? { filledArtwork } : {}),
      ...(emptyArtwork ? { emptyArtwork } : {}),
      outputProfile: walletProfile,
      locale,
      rewardReady: progress >= draft.requiredStampCount,
      progressLabelVisible: false,
      rewardLabelVisible: false,
    });
    return {
      profile,
      locale,
      organizationName,
      programName: content.programName || draft.internalName,
      rewardSummary: content.rewardSummary,
      progress,
      goal: draft.requiredStampCount,
      stampSvg: stamp.svg,
      stampArtwork: {
        width: stamp.width,
        height: stamp.height,
        contentDigest: stamp.digest,
        positions: stamp.positions,
        stampSize: theme.stampSize,
      },
      backgroundColor: theme.backgroundColor,
      foregroundColor: theme.foregroundColor,
      accentColor: theme.accentColor,
      secondaryColor: theme.secondaryColor,
      ...(previewAssets.logo ? { logoDataUri: previewAssets.logo } : {}),
      ...(previewAssets.merchant ? { merchantBrandLogoDataUri: previewAssets.merchant } : {}),
    };
  }, [
    draft,
    locale,
    organizationName,
    previewAssets.empty,
    previewAssets.filled,
    previewAssets.logo,
    previewAssets.merchant,
    profile,
    progress,
  ]);
  const qrRequest = useMemo(
    () => dashboardWalletPreviewQrRasterRequest(previewInput),
    [previewInput],
  );
  const qrRasterDataUri = usePreviewQrRaster(qrRequest);
  const rendered = useMemo(
    () =>
      renderDashboardWalletPreviewSvg({
        ...previewInput,
        ...(qrRasterDataUri ? { qrRasterDataUri } : {}),
      }),
    [previewInput, qrRasterDataUri],
  );

  return (
    <WalletPreviewCanvas
      ariaLabel={ariaLabel}
      height={rendered.height}
      profile={profile}
      svg={rendered.svg}
      width={rendered.width}
    />
  );
}
