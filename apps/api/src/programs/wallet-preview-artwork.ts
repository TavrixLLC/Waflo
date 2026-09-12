import { cardLocalePresentation } from "@waflo/contracts";
import type { StampPosition } from "@waflo/stamp-engine";
import {
  composeApplePosterArtwork,
  composeAppleStoreCardStripArtwork,
  composeWalletArtwork,
  type WalletArtworkTarget,
} from "@waflo/wallet-artwork";

export interface DashboardWalletArtwork {
  readonly target: WalletArtworkTarget;
  readonly dataUri: string;
  readonly width: number;
  readonly height: number;
}

export async function composeDashboardWalletArtwork(input: {
  readonly profile: "APPLE_WALLET" | "GOOGLE_WALLET";
  readonly appleWalletVariant?: "LEGACY" | "POSTER";
  readonly locale: string;
  readonly renderedStamp: {
    readonly svg: string;
    readonly digest: string;
    readonly width: number;
    readonly height: number;
    readonly positions: readonly StampPosition[];
  };
  readonly stampSize: number;
  readonly organizationName: string;
  readonly programName: string;
  readonly rewardSummary: string;
  readonly progress: number;
  readonly goal: number;
  readonly backgroundColor: string;
  readonly foregroundColor: string;
  readonly accentColor: string;
  readonly secondaryColor: string;
}): Promise<DashboardWalletArtwork> {
  const locale = cardLocalePresentation(input.locale).locale;
  const artworkInput = {
    stampArtwork: {
      ...input.renderedStamp,
      contentDigest: input.renderedStamp.digest,
    },
    stampSize: input.stampSize,
    // All runtime wallet artwork is fail-closed to the approved Grid renderer.
    layoutType: "GRID" as const,
    theme: {
      backgroundColor: input.backgroundColor,
      foregroundColor: input.foregroundColor,
      accentColor: input.accentColor,
      secondaryColor: input.secondaryColor,
    },
    currentStampCount: input.progress,
    requiredStampCount: input.goal,
    rewardReady: input.progress >= input.goal,
    rewardLabel: input.rewardSummary,
    organizationName: input.organizationName,
    programName: input.programName,
    memberName: "Preview member",
    credentialPayload: "waflo-wallet-preview-only",
    locale,
  } as const;

  const composed =
    input.profile === "GOOGLE_WALLET"
      ? await composeWalletArtwork(artworkInput, "GOOGLE_HERO")
      : input.appleWalletVariant === "POSTER"
        ? (await composeApplePosterArtwork(artworkInput)).times1
        : (await composeAppleStoreCardStripArtwork(artworkInput)).times1;
  return {
    target: composed.target,
    dataUri: `data:image/png;base64,${composed.bytes.toString("base64")}`,
    width: composed.width,
    height: composed.height,
  };
}
