import {
  renderPublishedMembershipStampSvg,
  type PublishedMembershipStampRenderInput,
  type StampOutputProfile,
} from "@waflo/stamp-engine";
import type { ObjectStorage } from "./object-storage.js";
import {
  previewAssetCacheIdentity,
  resolvePreviewAssetContent,
  type PreviewAsset,
} from "./preview-assets.js";

export const publishedVisualThemeInclude = {
  include: {
    filledStampAsset: { include: { variants: true } },
    emptyStampAsset: { include: { variants: true } },
  },
} as const;

type PublishedTheme = {
  backgroundColor: string;
  foregroundColor: string;
  accentColor: string;
  secondaryColor: string;
  layoutType: "ROW" | "GRID" | "PATH" | "RING";
  layoutConfiguration: unknown;
  stampSize: number;
  stampSpacing: number;
  filledStampAsset: PreviewAsset;
  emptyStampAsset: PreviewAsset;
};

export async function renderPublishedStampArtwork(input: {
  storage: ObjectStorage;
  organizationId: string;
  programId: string;
  programVersionId: string;
  membershipId: string;
  locale: "en" | "ar";
  requiredStampCount: number;
  currentStampCount: number;
  rewardReady: boolean;
  theme: PublishedTheme;
  outputProfile: StampOutputProfile;
}) {
  const [filled, empty] = await Promise.all([
    resolvePreviewAssetContent(
      input.storage,
      input.theme.filledStampAsset,
      "STAMP_256",
      "filled stamp",
      true,
    ),
    resolvePreviewAssetContent(
      input.storage,
      input.theme.emptyStampAsset,
      "STAMP_256",
      "empty stamp",
      true,
    ),
  ]);
  if (!filled || !empty) throw new Error("Published stamp artwork is required.");
  const filledIdentity = previewAssetCacheIdentity(input.theme.filledStampAsset, "STAMP_256");
  const emptyIdentity = previewAssetCacheIdentity(input.theme.emptyStampAsset, "STAMP_256");
  const rawLayout =
    input.theme.layoutConfiguration &&
    typeof input.theme.layoutConfiguration === "object" &&
    !Array.isArray(input.theme.layoutConfiguration)
      ? input.theme.layoutConfiguration
      : {};
  const layoutConfiguration = {
    ...("columns" in rawLayout && typeof rawLayout.columns === "number"
      ? { columns: rawLayout.columns }
      : {}),
    ...("maxPerRow" in rawLayout && typeof rawLayout.maxPerRow === "number"
      ? { maxPerRow: rawLayout.maxPerRow }
      : {}),
    ...("serpentine" in rawLayout && typeof rawLayout.serpentine === "boolean"
      ? { serpentine: rawLayout.serpentine }
      : {}),
    ...("startAngle" in rawLayout && typeof rawLayout.startAngle === "number"
      ? { startAngle: rawLayout.startAngle }
      : {}),
  };
  const renderInput: PublishedMembershipStampRenderInput = {
    organizationId: input.organizationId,
    programId: input.programId,
    programVersionId: input.programVersionId,
    membershipId: input.membershipId,
    rendererSchemaVersion: "waflo-stamp-render-v1",
    locale: input.locale,
    requiredStampCount: input.requiredStampCount,
    currentStampCount: input.currentStampCount,
    rewardReady: input.rewardReady,
    layoutType: input.theme.layoutType,
    ...(Object.keys(layoutConfiguration).length > 0 ? { layoutConfiguration } : {}),
    visualTheme: {
      filledColor: input.theme.accentColor,
      emptyColor: input.theme.secondaryColor,
      accentColor: input.theme.accentColor,
      backgroundColor: input.theme.backgroundColor,
      foregroundColor: input.theme.foregroundColor,
      stampSize: input.theme.stampSize,
      spacing: input.theme.stampSpacing,
    },
    filledArtwork: filled.artwork,
    emptyArtwork: empty.artwork,
    assetDigests: {
      filled:
        filledIdentity?.variantDigest ??
        filledIdentity?.assetDigest ??
        input.theme.filledStampAsset.sha256Digest,
      empty:
        emptyIdentity?.variantDigest ??
        emptyIdentity?.assetDigest ??
        input.theme.emptyStampAsset.sha256Digest,
    },
    outputProfile: input.outputProfile,
  };
  const rendered = renderPublishedMembershipStampSvg(renderInput);
  return {
    ...rendered,
    dataUri: `data:image/svg+xml;base64,${Buffer.from(rendered.svg, "utf8").toString("base64")}`,
    renderInput,
  };
}
