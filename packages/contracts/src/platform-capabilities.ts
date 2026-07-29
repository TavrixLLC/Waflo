export type ProgramPreviewPlatform = "CUSTOMER_WEB" | "APPLE_WALLET" | "GOOGLE_WALLET";
export type ProgramPlatformFeature =
  | "logo"
  | "heroArtwork"
  | "backgroundArtwork"
  | "backgroundColor"
  | "foregroundColor"
  | "textFields"
  | "backContent"
  | "links"
  | "locationMetadata"
  | "expiryPresentation"
  | "customStampArtwork"
  | "barcodeRegion";
export type ProgramPlatformSupport = "SUPPORTED" | "MAPPED" | "UNSUPPORTED";

export interface ProgramPlatformCapability {
  support: ProgramPlatformSupport;
  explanation: string;
}

export const programPlatformCapabilities: Record<
  ProgramPreviewPlatform,
  Record<ProgramPlatformFeature, ProgramPlatformCapability>
> = {
  CUSTOMER_WEB: {
    logo: { support: "SUPPORTED", explanation: "Rendered in the customer card header." },
    heroArtwork: { support: "SUPPORTED", explanation: "Rendered by the Hero card variant." },
    backgroundArtwork: {
      support: "SUPPORTED",
      explanation: "Rendered behind the customer card with a readability overlay.",
    },
    backgroundColor: { support: "SUPPORTED", explanation: "Applied to the customer card." },
    foregroundColor: { support: "SUPPORTED", explanation: "Applied to customer-facing text." },
    textFields: { support: "SUPPORTED", explanation: "Localized customer copy is rendered." },
    backContent: { support: "MAPPED", explanation: "Terms are shown in the card footer." },
    links: { support: "SUPPORTED", explanation: "Customer Web can present merchant links." },
    locationMetadata: {
      support: "SUPPORTED",
      explanation: "Eligible merchant locations can be presented.",
    },
    expiryPresentation: {
      support: "SUPPORTED",
      explanation: "Reward validity can be shown as customer copy.",
    },
    customStampArtwork: {
      support: "SUPPORTED",
      explanation: "Filled, empty, and milestone artwork is rendered.",
    },
    barcodeRegion: {
      support: "UNSUPPORTED",
      explanation: "W2 Customer Web does not expose a membership barcode.",
    },
  },
  APPLE_WALLET: {
    logo: { support: "SUPPORTED", explanation: "Mapped to the pass logo/header region." },
    heroArtwork: {
      support: "UNSUPPORTED",
      explanation: "The W2 Apple preview does not map hero artwork.",
    },
    backgroundArtwork: {
      support: "UNSUPPORTED",
      explanation: "Apple preview uses pass colors; selected background artwork is not used.",
    },
    backgroundColor: { support: "SUPPORTED", explanation: "Mapped to pass background color." },
    foregroundColor: { support: "SUPPORTED", explanation: "Mapped to pass foreground text." },
    textFields: { support: "SUPPORTED", explanation: "Mapped to pass header and field regions." },
    backContent: {
      support: "SUPPORTED",
      explanation: "Represented by the back-content indicator.",
    },
    links: { support: "MAPPED", explanation: "Links belong in pass back content." },
    locationMetadata: {
      support: "MAPPED",
      explanation: "Location metadata is capability-only in the W2 preview.",
    },
    expiryPresentation: {
      support: "MAPPED",
      explanation: "Validity is represented as descriptive back content.",
    },
    customStampArtwork: {
      support: "SUPPORTED",
      explanation: "Generated stamp artwork is rendered in the pass region.",
    },
    barcodeRegion: {
      support: "SUPPORTED",
      explanation: "A non-issuance barcode placeholder is rendered.",
    },
  },
  GOOGLE_WALLET: {
    logo: { support: "SUPPORTED", explanation: "Mapped to the card logo region." },
    heroArtwork: { support: "SUPPORTED", explanation: "Mapped to the card hero region." },
    backgroundArtwork: {
      support: "UNSUPPORTED",
      explanation: "Google preview uses hero artwork; selected background artwork is not used.",
    },
    backgroundColor: {
      support: "MAPPED",
      explanation: "Mapped through the Google card color treatment.",
    },
    foregroundColor: {
      support: "MAPPED",
      explanation: "Google preview applies platform text colors for readability.",
    },
    textFields: { support: "SUPPORTED", explanation: "Mapped to title, subtitle, and details." },
    backContent: { support: "MAPPED", explanation: "Mapped to descriptive details content." },
    links: { support: "MAPPED", explanation: "Links belong in details modules." },
    locationMetadata: {
      support: "MAPPED",
      explanation: "Location metadata is capability-only in the W2 preview.",
    },
    expiryPresentation: {
      support: "MAPPED",
      explanation: "Validity is represented as descriptive details content.",
    },
    customStampArtwork: {
      support: "SUPPORTED",
      explanation: "Generated stamp artwork is rendered in the card region.",
    },
    barcodeRegion: {
      support: "SUPPORTED",
      explanation: "A non-issuance barcode placeholder is rendered.",
    },
  },
};

export function unsupportedProgramCapabilities(
  platform: ProgramPreviewPlatform,
): Array<[ProgramPlatformFeature, ProgramPlatformCapability]> {
  return Object.entries(programPlatformCapabilities[platform]).filter(
    ([, capability]) => capability.support === "UNSUPPORTED",
  ) as Array<[ProgramPlatformFeature, ProgramPlatformCapability]>;
}
