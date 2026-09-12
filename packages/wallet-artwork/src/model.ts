/** Browser-safe Wallet artwork geometry shared by local previews and Sharp composition. */
export type WalletArtworkTarget =
  | "APPLE_POSTER"
  | "APPLE_STORE_CARD_STRIP"
  | "APPLE_GENERIC_STRIP"
  | "APPLE_LEGACY_STRIP"
  | "GOOGLE_HERO";
export type WalletArtworkScale = 1 | 2 | 3;

export interface WalletArtworkPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface WalletArtworkLayout {
  readonly safeArea: WalletArtworkPlacement;
  readonly stampPanelRegion: WalletArtworkPlacement;
  readonly stampRegion: WalletArtworkPlacement;
  readonly identityRegion?: WalletArtworkPlacement;
  readonly counterBadgeRegion?: WalletArtworkPlacement;
  readonly rewardRegion?: WalletArtworkPlacement;
  readonly qrRegion?: WalletArtworkPlacement;
  readonly decorationRegion: WalletArtworkPlacement;
  readonly centerToleranceRatio: number;
}

export const walletArtworkDimensions = {
  APPLE_POSTER: { width: 358, height: 448, maxBytes: 4_000_000 },
  // Apple reserves this 375 by 144 point region for Store Card strips.
  APPLE_STORE_CARD_STRIP: { width: 375, height: 144, maxBytes: 4_000_000 },
  APPLE_GENERIC_STRIP: { width: 375, height: 144, maxBytes: 4_000_000 },
  APPLE_LEGACY_STRIP: { width: 375, height: 123, maxBytes: 4_000_000 },
  GOOGLE_HERO: { width: 1_032, height: 812, maxBytes: 5_000_000 },
} as const satisfies Readonly<
  Record<WalletArtworkTarget, { width: number; height: number; maxBytes: number }>
>;

export const APPLE_POSTER_LAYOUT: WalletArtworkLayout = {
  safeArea: { left: 18, top: 22, width: 322, height: 404 },
  identityRegion: { left: 26, top: 20, width: 222, height: 74 },
  counterBadgeRegion: { left: 271, top: 30, width: 61, height: 54 },
  stampPanelRegion: { left: 14, top: 104, width: 330, height: 118 },
  stampRegion: { left: 35, top: 118, width: 183, height: 90 },
  rewardRegion: { left: 32, top: 238, width: 186, height: 62 },
  qrRegion: { left: 228, top: 184, width: 116, height: 116 },
  decorationRegion: { left: 0, top: 0, width: 358, height: 448 },
  centerToleranceRatio: 0.02,
};

export const APPLE_GENERIC_LAYOUT: WalletArtworkLayout = {
  safeArea: { left: 5, top: 5, width: 365, height: 134 },
  stampPanelRegion: { left: 5, top: 5, width: 365, height: 134 },
  stampRegion: { left: 22, top: 19, width: 331, height: 106 },
  decorationRegion: { left: 0, top: 0, width: 375, height: 144 },
  centerToleranceRatio: 0.02,
};

/** The Store Card strip is a wide, artwork-only Apple-native region. */
export const APPLE_STORE_CARD_LAYOUT: WalletArtworkLayout = APPLE_GENERIC_LAYOUT;

export const APPLE_LEGACY_LAYOUT: WalletArtworkLayout = {
  safeArea: { left: 5, top: 4, width: 365, height: 115 },
  stampPanelRegion: { left: 5, top: 4, width: 365, height: 115 },
  stampRegion: { left: 22, top: 16, width: 331, height: 91 },
  decorationRegion: { left: 0, top: 0, width: 375, height: 123 },
  centerToleranceRatio: 0.02,
};

export const GOOGLE_HERO_LAYOUT: WalletArtworkLayout = {
  safeArea: { left: 54, top: 48, width: 924, height: 716 },
  identityRegion: { left: 68, top: 76, width: 650, height: 108 },
  counterBadgeRegion: { left: 786, top: 70, width: 178, height: 132 },
  stampPanelRegion: { left: 32, top: 214, width: 968, height: 320 },
  stampRegion: { left: 92, top: 250, width: 848, height: 248 },
  rewardRegion: { left: 84, top: 574, width: 676, height: 146 },
  qrRegion: { left: 786, top: 558, width: 192, height: 192 },
  decorationRegion: { left: 0, top: 0, width: 1_032, height: 812 },
  centerToleranceRatio: 0.02,
};

export const walletArtworkLayouts = {
  APPLE_POSTER: APPLE_POSTER_LAYOUT,
  APPLE_STORE_CARD_STRIP: APPLE_STORE_CARD_LAYOUT,
  APPLE_GENERIC_STRIP: APPLE_GENERIC_LAYOUT,
  APPLE_LEGACY_STRIP: APPLE_LEGACY_LAYOUT,
  GOOGLE_HERO: GOOGLE_HERO_LAYOUT,
} as const satisfies Readonly<Record<WalletArtworkTarget, WalletArtworkLayout>>;

export const walletArtworkPanelCorners = {
  APPLE_POSTER: { topLeft: 38, topRight: 18, bottomLeft: 18, bottomRight: 38 },
  GOOGLE_HERO: { topLeft: 72, topRight: 30, bottomLeft: 30, bottomRight: 72 },
} as const;

export const walletArtworkArabicTypeface =
  "'Noto Sans Arabic','Noto Sans','DejaVu Sans','Segoe UI','Arial',sans-serif";
