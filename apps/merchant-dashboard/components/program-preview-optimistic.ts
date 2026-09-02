import type { ProgramDraftInput } from "./program-studio-types";

/**
 * Shared fixed QR geometry for the lightweight Builder loading state. The
 * authoritative API SVG remains the only provider-card renderer.
 */
export function walletPreviewQrOverlay(
  profile: "APPLE_LEGACY" | "APPLE_IOS27" | "APPLE_WALLET" | "GOOGLE_WALLET",
) {
  if (profile === "APPLE_LEGACY" || profile === "APPLE_WALLET")
    return { left: "32.1739%", top: "62.8571%", width: "35.6522%", height: "23.4286%" };
  if (profile === "APPLE_IOS27")
    return { left: "32.1739%", top: "71.5789%", width: "35.6522%", height: "21.5789%" };
  return { left: "32.1739%", top: "68.5%", width: "35.6522%", height: "20.5%" };
}

export const walletPreviewQrRows = [
  "1fc1bb7f",
  "105ad241",
  "174db25d",
  "1758f95d",
  "1756925d",
  "10474041",
  "1fd5557f",
  "001b0e00",
  "0bdab0da",
  "17827430",
  "1c77eb4c",
  "15042fca",
  "0c527569",
  "1f8914dd",
  "0f6c4621",
  "1bb1b02c",
  "045d6f20",
  "1502801a",
  "1b7f5a55",
  "1f35f3e6",
  "1dd5d9f6",
  "001aa91e",
  "1fc4a350",
  "105d771b",
  "175aabf9",
  "17588586",
  "174666b7",
  "10525695",
  "1fc0b380",
] as const;

/**
 * Wallet previews always render provider composition from the API. Rewriting a
 * finished SVG changes text geometry after bidi resolution and can diverge from
 * the issued pass, so a locally edited draft deliberately leaves the last
 * authoritative preview intact until the debounced provider preview arrives.
 */
export function optimisticProgramPreviewSvg(input: {
  svg: string;
  sourceDraft: ProgramDraftInput;
  draft: ProgramDraftInput;
  locale: string;
}): string {
  void input.sourceDraft;
  void input.draft;
  void input.locale;
  return input.svg;
}
