import type { ProgramTemplateDefinition } from "@waflo/contracts";
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

// Gallery definitions are immutable within a running release. Reuse the same
// real Wallet compositor result for repeated gallery reads instead of making a
// second PNG for the same template/profile/locale/presentation. This is kept
// intentionally local to gallery previews; issued pass artwork is never
// cached here.
const walletGalleryPreviewCache = new Map<string, Promise<TemplateGalleryPreview>>();

function walletGalleryPreviewCacheKey(
  template: ProgramTemplateDefinition,
  profile: Exclude<TemplateGalleryPreviewProfile, "CUSTOMER_WEB">,
  locale: "EN" | "AR",
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
  locale: "EN" | "AR",
  presentation?: "TEMPLATE" | "BLANK",
): TemplateGalleryPreview;
export function renderTemplateGalleryPreview(
  template: ProgramTemplateDefinition,
  profile: Exclude<TemplateGalleryPreviewProfile, "CUSTOMER_WEB">,
  locale: "EN" | "AR",
  presentation?: "TEMPLATE" | "BLANK",
): Promise<TemplateGalleryPreview>;
export function renderTemplateGalleryPreview(
  template: ProgramTemplateDefinition,
  profile: TemplateGalleryPreviewProfile,
  locale: "EN" | "AR",
  presentation?: "TEMPLATE" | "BLANK",
): TemplateGalleryPreview | Promise<TemplateGalleryPreview>;
export function renderTemplateGalleryPreview(
  template: ProgramTemplateDefinition,
  profile: TemplateGalleryPreviewProfile,
  locale: "EN" | "AR",
  presentation: "TEMPLATE" | "BLANK" = "TEMPLATE",
): TemplateGalleryPreview | Promise<TemplateGalleryPreview> {
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
    locale: locale === "AR" ? "ar" : "en",
    rewardReady: false,
    progressLabelVisible: profile === "CUSTOMER_WEB",
    rewardLabelVisible: profile === "CUSTOMER_WEB",
  } satisfies StampRenderInput;
  const rendered = renderStampSvg(stampRenderInput);
  const compose = (walletArtwork?: DashboardWalletArtwork): TemplateGalleryPreview => {
    const composed = composeProgramPreview({
      profile,
      locale,
      organizationName: locale === "AR" ? "Ù†Ø´Ø§Ø·Ùƒ Ø§Ù„ØªØ¬Ø§Ø±ÙŠ" : "Your business",
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
    return { ...composed, profile, locale, presentation };
  };

  if (profile === "CUSTOMER_WEB") return compose();
  const cacheKey = walletGalleryPreviewCacheKey(template, profile, locale, presentation);
  const cached = walletGalleryPreviewCache.get(cacheKey);
  if (cached) return cached;
  const renderedPreview = composeDashboardWalletArtwork({
    profile,
    locale: locale === "AR" ? "ar" : "en",
    renderedStamp: rendered,
    stampSize: blank ? 44 : template.layout.stampSize,
    organizationName: locale === "AR" ? "Ù†Ø´Ø§Ø·Ùƒ Ø§Ù„ØªØ¬Ø§Ø±ÙŠ" : "Your business",
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
  locale: "EN" | "AR",
  presentation: "TEMPLATE" | "BLANK" = "TEMPLATE",
): TemplateGalleryPreview {
  return renderTemplateGalleryPreview(template, "CUSTOMER_WEB", locale, presentation);
}

export async function renderTemplateGalleryPreviews(
  template: ProgramTemplateDefinition,
  locale: "EN" | "AR",
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
