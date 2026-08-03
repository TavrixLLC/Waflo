import type { ProgramTemplateDefinition } from "@waflo/contracts";
import { renderStampSvg, type StampOutputProfile } from "@waflo/stamp-engine";
import { artworkFor } from "./library-artwork.js";
import { composeProgramPreview, type ProgramPreviewComposition } from "./preview-composer.js";

export type TemplateGalleryPreviewProfile = Exclude<StampOutputProfile, "JOIN_PREVIEW">;

export interface TemplateGalleryPreview extends ProgramPreviewComposition {
  profile: TemplateGalleryPreviewProfile;
  locale: "EN" | "AR";
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
  profile: TemplateGalleryPreviewProfile,
  locale: "EN" | "AR",
  presentation: "TEMPLATE" | "BLANK" = "TEMPLATE",
): TemplateGalleryPreview {
  const blank = presentation === "BLANK";
  const translation = blank
    ? locale === "AR"
      ? {
          programName: "بطاقة ولائك",
          shortDescription: "اجمع ختمًا مع كل زيارة مؤهلة.",
          rewardSummary: "مكافأتك",
          termsAndConditions: "خصّص التصميم والمكافأة داخل المحرر.",
        }
      : {
          programName: "Your loyalty card",
          shortDescription: "Earn a stamp with every qualifying visit.",
          rewardSummary: "Your reward",
          termsAndConditions: "Choose your design and reward in the editor.",
        }
    : locale === "AR"
      ? template.copy.ar
      : template.copy.en;
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
  const apple = blank
    ? {
        headerLabel: locale === "AR" ? "بطاقة الولاء" : "LOYALTY CARD",
        headerValue: translation.programName,
        secondaryLabel: locale === "AR" ? "المكافأة" : "YOUR REWARD",
        barcodeLabel: locale === "AR" ? "رمز للمعاينة" : "Preview barcode",
        showBackContent: true,
      }
    : locale === "AR"
      ? {
          ...template.apple,
          headerLabel: "بطاقة الولاء",
          headerValue: translation.programName,
          secondaryLabel: "المكافأة التالية",
          barcodeLabel: "رمز للمعاينة",
        }
      : template.apple;
  const google = blank
    ? {
        title: translation.programName,
        subtitle: translation.shortDescription,
        detailsLabel: locale === "AR" ? "تقدم البطاقة" : "Card progress",
        barcodeLabel: locale === "AR" ? "رمز للمعاينة" : "Preview barcode",
      }
    : locale === "AR"
      ? {
          ...template.google,
          title: translation.programName,
          subtitle: translation.shortDescription,
          detailsLabel: "تقدم المكافأة",
          barcodeLabel: "رمز للمعاينة",
        }
      : template.google;
  const rendered = renderStampSvg({
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
    rewardReady: false,
    progressLabelVisible: profile === "CUSTOMER_WEB",
    rewardLabelVisible: profile === "CUSTOMER_WEB",
  });
  const composed = composeProgramPreview({
    profile,
    locale,
    organizationName: locale === "AR" ? "نشاطك التجاري" : "Your business",
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
    customerWebVariant: blank ? "MINIMAL" : template.customerWeb.variant,
    ...(blank
      ? { presentation: blankPresentation }
      : template.presentation
        ? { presentation: template.presentation }
        : {}),
    apple,
    google,
  });

  return { ...composed, profile, locale, presentation };
}

export function renderTemplateGalleryThumbnail(
  template: ProgramTemplateDefinition,
  locale: "EN" | "AR",
  presentation: "TEMPLATE" | "BLANK" = "TEMPLATE",
): TemplateGalleryPreview {
  return renderTemplateGalleryPreview(template, "CUSTOMER_WEB", locale, presentation);
}

export function renderTemplateGalleryPreviews(
  template: ProgramTemplateDefinition,
  locale: "EN" | "AR",
  presentation: "TEMPLATE" | "BLANK" = "TEMPLATE",
): Record<TemplateGalleryPreviewProfile, TemplateGalleryPreview> {
  return {
    CUSTOMER_WEB: renderTemplateGalleryPreview(template, "CUSTOMER_WEB", locale, presentation),
    APPLE_WALLET: renderTemplateGalleryPreview(template, "APPLE_WALLET", locale, presentation),
    GOOGLE_WALLET: renderTemplateGalleryPreview(template, "GOOGLE_WALLET", locale, presentation),
  };
}
