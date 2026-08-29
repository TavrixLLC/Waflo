import type { ProgramDraftInput } from "./program-studio-types";

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

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ??
      character,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function replaceLiteral(value: string, before: string, after: string): string {
  if (!before || before === after) return value;
  return value.replace(new RegExp(escapeRegExp(before), "gu"), after);
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

function localizedCopy(draft: ProgramDraftInput, locale: string) {
  return (
    draft.translations[locale] ??
    draft.translations[draft.defaultLocale] ??
    draft.translations.en ?? {
      programName: draft.internalName,
      shortDescription: "",
      rewardSummary: "",
      termsAndConditions: "",
    }
  );
}

function providerTextColor(backgroundColor: string): "#202124" | "#FFFFFF" {
  const match = /^#([0-9a-f]{6})$/iu.exec(backgroundColor);
  if (!match?.[1]) return "#202124";
  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(match[1]?.slice(offset, offset + 2) ?? "ff", 16),
  );
  const [red = 255, green = 255, blue = 255] = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 > 0.42 ? "#202124" : "#FFFFFF";
}

function decodeBase64Utf8(value: string): string | null {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * Applies changes that are safe to preview locally while the authoritative API
 * renderer catches up. Provider structure, stamp geometry and assets remain
 * server-owned; colors and localized copy update immediately without a fake
 * browser-only card implementation.
 */
export function optimisticProgramPreviewSvg(input: {
  svg: string;
  sourceDraft: ProgramDraftInput;
  draft: ProgramDraftInput;
  locale: string;
}): string {
  const sourceCopy = localizedCopy(input.sourceDraft, input.locale);
  const nextCopy = localizedCopy(input.draft, input.locale);
  const replacements = (
    [
      [input.sourceDraft.visualTheme.backgroundColor, input.draft.visualTheme.backgroundColor],
      [input.sourceDraft.visualTheme.foregroundColor, input.draft.visualTheme.foregroundColor],
      [input.sourceDraft.visualTheme.accentColor, input.draft.visualTheme.accentColor],
      [input.sourceDraft.visualTheme.secondaryColor, input.draft.visualTheme.secondaryColor],
      [
        providerTextColor(input.sourceDraft.visualTheme.backgroundColor),
        providerTextColor(input.draft.visualTheme.backgroundColor),
      ],
      [escapeXml(sourceCopy.programName), escapeXml(nextCopy.programName)],
      [
        escapeXml(truncate(sourceCopy.programName, 34)),
        escapeXml(truncate(nextCopy.programName, 34)),
      ],
      [escapeXml(sourceCopy.shortDescription), escapeXml(nextCopy.shortDescription)],
      [escapeXml(sourceCopy.rewardSummary), escapeXml(nextCopy.rewardSummary)],
      [
        escapeXml(truncate(sourceCopy.rewardSummary, 42)),
        escapeXml(truncate(nextCopy.rewardSummary, 42)),
      ],
      [escapeXml(sourceCopy.termsAndConditions), escapeXml(nextCopy.termsAndConditions)],
    ] satisfies Array<readonly [string, string]>
  ).filter(([before, after]) => Boolean(before) && before !== after);

  const apply = (value: string) =>
    replacements.reduce(
      (current, [before, after]) => replaceLiteral(current, before, after),
      value,
    );

  const withUpdatedEmbeddedArtwork = input.svg.replace(
    /data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/gu,
    (match, base64: string) => {
      const decoded = decodeBase64Utf8(base64);
      return decoded === null
        ? match
        : `data:image/svg+xml;base64,${encodeBase64Utf8(apply(decoded))}`;
    },
  );
  return apply(withUpdatedEmbeddedArtwork);
}
