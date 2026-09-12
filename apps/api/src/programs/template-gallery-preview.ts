import {
  cardLocalePresentation,
  walletStructuralCopyForLocale,
  type ProgramTemplateDefinition,
} from "@waflo/contracts";
import {
  renderStampSvg,
  type StampOutputProfile,
  type StampRenderInput,
} from "@waflo/stamp-engine";
import { artworkFor } from "./library-artwork.js";
import { composeProgramPreview, type ProgramPreviewComposition } from "./preview-composer.js";
import {
  composeDashboardWalletArtwork,
  type DashboardWalletArtwork,
} from "./wallet-preview-artwork.js";

export type TemplateGalleryPreviewProfile = Exclude<StampOutputProfile, "JOIN_PREVIEW">;

export interface TemplateGalleryPreview extends ProgramPreviewComposition {
  profile: TemplateGalleryPreviewProfile;
  locale: string;
  presentation: "TEMPLATE" | "BLANK";
}

const blankPresentation: NonNullable<ProgramTemplateDefinition["presentation"]> = {
  visualRole: "MINIMAL",
  composition: "EDITORIAL",
  motifTreatment: "WATERMARK",
  rewardTreatment: "RULE",
  density: "AIRY",
  cornerTreatment: "CRISP",
  titleTreatment: "QUIET",
};

const blankGalleryTranslations = {
  ar: {
    programName: "\u0628\u0637\u0627\u0642\u0629 \u0648\u0644\u0627\u0626\u0643",
    shortDescription:
      "\u0627\u062c\u0645\u0639 \u062e\u062a\u0645\u064b\u0627 \u0645\u0639 \u0643\u0644 \u0632\u064a\u0627\u0631\u0629 \u0645\u0624\u0647\u0644\u0629.",
    rewardSummary: "\u0645\u0643\u0627\u0641\u0623\u062a\u0643",
    termsAndConditions:
      "\u062e\u0635\u0651\u0635 \u0627\u0644\u062a\u0635\u0645\u064a\u0645 \u0648\u0627\u0644\u0645\u0643\u0627\u0641\u0623\u0629 \u062f\u0627\u062e\u0644 \u0627\u0644\u0645\u062d\u0631\u0631.",
  },
  ckb: {
    programName:
      "\u06a9\u0627\u0631\u062a\u06cc \u0648\u06d5\u0641\u0627\u062f\u0627\u0631\u06cc\u062a",
    shortDescription:
      "\u0644\u06d5 \u0647\u06d5\u0631 \u0633\u06d5\u0631\u062f\u0627\u0646\u06ce\u06a9\u06cc \u0634\u0627\u06cc\u0633\u062a\u06d5\u062f\u0627 \u0645\u06c6\u0631 \u06a9\u06c6\u0628\u06a9\u06d5\u0631\u06d5\u0648\u06d5.",
    rewardSummary: "\u062e\u06d5\u06b5\u0627\u062a\u06cc \u062a\u06c6",
    termsAndConditions:
      "\u062f\u06cc\u0632\u0627\u06cc\u0646 \u0648 \u062e\u06d5\u06b5\u0627\u062a\u06d5\u06a9\u06d5\u062a \u0644\u06d5 \u062f\u06d5\u0633\u062a\u06a9\u0627\u0631\u06cc\u062f\u0627 \u062f\u06cc\u0627\u0631\u06cc \u0628\u06a9\u06d5.",
  },
  en: {
    programName: "Your loyalty card",
    shortDescription: "Earn a stamp with every qualifying visit.",
    rewardSummary: "Your reward",
    termsAndConditions: "Choose your design and reward in the editor.",
  },
} as const;

function galleryTranslation(template: ProgramTemplateDefinition, locale: string, blank: boolean) {
  if (!blank) return { ar: template.copy.ar }[locale] ?? template.copy.en;
  return (
    blankGalleryTranslations[locale as keyof typeof blankGalleryTranslations] ??
    blankGalleryTranslations.en
  );
}

function galleryOrganizationName(locale: string): string {
  return (
    {
      ar: "\u0646\u0634\u0627\u0637\u0643 \u0627\u0644\u062a\u062c\u0627\u0631\u064a",
      ckb: "\u06a9\u0627\u0641\u06ce \u06af\u06d5\u0644\u06d5\u0631\u06cc",
    }[locale] ?? "Your business"
  );
}

// Gallery definitions are immutable within a running release. Reuse the same
// real Wallet compositor result for repeated gallery reads instead of making a
// second PNG for the same template/profile/locale/presentation. This is kept
// intentionally local to gallery previews; issued pass artwork is never
// cached here.
const walletGalleryPreviewCache = new Map<string, Promise<TemplateGalleryPreview>>();

function walletGalleryPreviewCacheKey(
  template: ProgramTemplateDefinition,
  profile: Exclude<TemplateGalleryPreviewProfile, "CUSTOMER_WEB">,
  locale: string,
  presentation: "TEMPLATE" | "BLANK",
): string {
  return [template.code, template.version, profile, locale, presentation].join(":");
}

function requiredArtwork(template: ProgramTemplateDefinition, role: "filled" | "empty"): string {
  const reference = template.artwork[role];
  const artwork = artworkFor(reference);
  if (!artwork) {
    throw new Error(
      `Built-in ${role} artwork ${reference.code}@${reference.version} is missing for ${template.code}.`,
    );
  }
  return artwork.content;
}

export function renderTemplateGalleryPreview(
  template: ProgramTemplateDefinition,
  profile: "CUSTOMER_WEB",
  locale: string,
  presentation?: "TEMPLATE" | "BLANK",
): TemplateGalleryPreview;
export function renderTemplateGalleryPreview(
  template: ProgramTemplateDefinition,
  profile: Exclude<TemplateGalleryPreviewProfile, "CUSTOMER_WEB">,
  locale: string,
  presentation?: "TEMPLATE" | "BLANK",
): Promise<TemplateGalleryPreview>;
export function renderTemplateGalleryPreview(
  template: ProgramTemplateDefinition,
  profile: TemplateGalleryPreviewProfile,
  locale: string,
  presentation?: "TEMPLATE" | "BLANK",
): TemplateGalleryPreview | Promise<TemplateGalleryPreview>;
export function renderTemplateGalleryPreview(
  template: ProgramTemplateDefinition,
  profile: TemplateGalleryPreviewProfile,
  locale: string,
  presentation: "TEMPLATE" | "BLANK" = "TEMPLATE",
): TemplateGalleryPreview | Promise<TemplateGalleryPreview> {
  const canonicalLocale = cardLocalePresentation({ EN: "en", AR: "ar" }[locale] ?? locale).locale;
  const walletCopy = walletStructuralCopyForLocale(canonicalLocale);
  const blank = presentation === "BLANK";
  const translation = galleryTranslation(template, canonicalLocale, blank);
  const goal = template.recommendedStampGoal;
  const progress = Math.max(1, Math.min(goal - 1, Math.floor(goal / 2)));
  const neutralFilled = artworkFor("NEUTRAL_MARK_FILLED", 2)?.content;
  const neutralEmpty = artworkFor("NEUTRAL_MARK_EMPTY", 2)?.content;
  if (blank && (!neutralFilled || !neutralEmpty)) {
    throw new Error("Neutral Blank Card artwork is missing.");
  }
  const filledArtwork = blank ? (neutralFilled ?? "") : requiredArtwork(template, "filled");
  const emptyArtwork = blank ? (neutralEmpty ?? "") : requiredArtwork(template, "empty");
  const backgroundColor = blank ? "#F7F8F7" : template.colors.background;
  const foregroundColor = blank ? "#2B3430" : template.colors.foreground;
  const accentColor = blank ? "#5D6A64" : template.colors.accent;
  const secondaryColor = blank ? "#C9D0CC" : template.colors.secondary;
  const apple = {
    ...(blank ? {} : template.apple),
    headerLabel: blank ? walletCopy.program : template.apple.headerLabel,
    headerValue: translation.programName,
    secondaryLabel: blank ? walletCopy.reward : template.apple.secondaryLabel,
    barcodeLabel: "Preview barcode",
    showBackContent: true,
  };
  const google = {
    ...(blank ? {} : template.google),
    title: translation.programName,
    subtitle: translation.shortDescription,
    detailsLabel: blank ? walletCopy.stamps : template.google.detailsLabel,
    barcodeLabel: "Preview barcode",
  };
  const stampRenderInput = {
    goal,
    progress,
    layout: blank ? "GRID" : template.layout.type,
    layoutConfiguration: blank ? { columns: 4 } : template.layout.configuration,
    outputProfile: profile,
    filledColor: accentColor,
    emptyColor: profile === "CUSTOMER_WEB" ? backgroundColor : secondaryColor,
    accentColor: profile === "CUSTOMER_WEB" ? foregroundColor : accentColor,
    backgroundColor,
    foregroundColor,
    stampSize: blank ? 44 : template.layout.stampSize,
    spacing: blank ? 10 : template.layout.stampSpacing,
    filledArtwork: {
      kind: "svg",
      content: filledArtwork,
      trusted: true,
    },
    emptyArtwork: {
      kind: "svg",
      content: emptyArtwork,
      trusted: true,
    },
    label: `${progress}/${goal}`,
    rewardLabel: translation.rewardSummary,
    locale: canonicalLocale,
    rewardReady: false,
    progressLabelVisible: profile === "CUSTOMER_WEB",
    rewardLabelVisible: profile === "CUSTOMER_WEB",
  } satisfies StampRenderInput;
  const rendered = renderStampSvg(stampRenderInput);
  const organizationName = galleryOrganizationName(canonicalLocale);
  const compose = (walletArtwork?: DashboardWalletArtwork): TemplateGalleryPreview => {
    const composed = composeProgramPreview({
      profile,
      locale: canonicalLocale,
      organizationName,
      programName: translation.programName,
      shortDescription: translation.shortDescription,
      rewardSummary: translation.rewardSummary,
      terms: translation.termsAndConditions,
      progress,
      goal,
      stampSvg: rendered.svg,
      stampLayout: blank ? "GRID" : template.layout.type,
      backgroundColor,
      foregroundColor,
      accentColor,
      secondaryColor,
      identityDataUri: `data:image/svg+xml;base64,${Buffer.from(filledArtwork, "utf8").toString("base64")}`,
      ...(walletArtwork ? { walletArtwork } : {}),
      customerWebVariant: blank ? "MINIMAL" : template.customerWeb.variant,
      ...(blank
        ? { presentation: blankPresentation }
        : template.presentation
          ? { presentation: template.presentation }
          : {}),
      apple,
      google,
    });
    // Preserve the legacy gallery response token for existing consumers while
    // the SVG itself always declares canonical BCP-47 lang/dir metadata.
    return { ...composed, profile, locale, presentation };
  };
  if (profile === "CUSTOMER_WEB") return compose();
  const cacheKey = walletGalleryPreviewCacheKey(template, profile, canonicalLocale, presentation);
  const cached = walletGalleryPreviewCache.get(cacheKey);
  if (cached) return cached;
  const renderedPreview = composeDashboardWalletArtwork({
    profile,
    locale: canonicalLocale,
    renderedStamp: rendered,
    stampSize: blank ? 44 : template.layout.stampSize,
    organizationName,
    programName: translation.programName,
    rewardSummary: translation.rewardSummary,
    progress,
    goal,
    backgroundColor,
    foregroundColor,
    accentColor,
    secondaryColor,
  }).then(compose);
  walletGalleryPreviewCache.set(cacheKey, renderedPreview);
  void renderedPreview.catch(() => walletGalleryPreviewCache.delete(cacheKey));
  return renderedPreview;
}

export function renderTemplateGalleryThumbnail(
  template: ProgramTemplateDefinition,
  locale: string,
  presentation: "TEMPLATE" | "BLANK" = "TEMPLATE",
): TemplateGalleryPreview {
  return renderTemplateGalleryPreview(template, "CUSTOMER_WEB", locale, presentation);
}

export async function renderTemplateGalleryPreviews(
  template: ProgramTemplateDefinition,
  locale: string,
  presentation: "TEMPLATE" | "BLANK" = "TEMPLATE",
): Promise<Record<TemplateGalleryPreviewProfile, TemplateGalleryPreview>> {
  const [customer, apple, google] = await Promise.all([
    renderTemplateGalleryPreview(template, "CUSTOMER_WEB", locale, presentation),
    renderTemplateGalleryPreview(template, "APPLE_WALLET", locale, presentation),
    renderTemplateGalleryPreview(template, "GOOGLE_WALLET", locale, presentation),
  ]);
  return {
    CUSTOMER_WEB: customer,
    APPLE_WALLET: apple,
    GOOGLE_WALLET: google,
  };
}
