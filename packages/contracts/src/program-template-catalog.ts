export type ProgramTemplateCategory =
  | "food-and-beverage"
  | "automotive"
  | "beauty-and-wellness"
  | "services-and-retail"
  | "general";

export interface ProgramTemplateArtworkReference {
  code: string;
  version: number;
}

export interface ProgramTemplateCopy {
  programName: string;
  shortDescription: string;
  fullDescription: string;
  rewardSummary: string;
  joinInstructions: string;
  termsAndConditions: string;
  completionMessage: string;
  rewardUnlockedMessage: string;
  pausedMessage: string;
}

export interface ProgramTemplateReward {
  thresholdStampCount: number;
  rewardType: "TEXT_REWARD" | "FREE_ITEM" | "DISCOUNT_DESCRIPTION" | "CUSTOM";
  internalName: string;
  requiresManagerApproval: boolean;
  validityDurationDays: number | null;
  maximumRedemptionsPerEarned: number;
  translations: {
    en: { name: string; description: string; redemptionInstructions: string };
    ar: { name: string; description: string; redemptionInstructions: string };
  };
  artwork: ProgramTemplateArtworkReference;
}

export interface ProgramTemplateDefinition {
  code: string;
  version: number;
  category: ProgramTemplateCategory;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  recommendedStampGoal: number;
  earningDescription: string;
  copy: { en: ProgramTemplateCopy; ar: ProgramTemplateCopy };
  finalReward: ProgramTemplateReward;
  milestones: ProgramTemplateReward[];
  colors: {
    background: string;
    foreground: string;
    accent: string;
    secondary: string;
    muted: string;
  };
  artwork: {
    filled: ProgramTemplateArtworkReference;
    empty: ProgramTemplateArtworkReference;
    milestone: ProgramTemplateArtworkReference;
  };
  layout: {
    type: "ROW" | "GRID" | "PATH" | "RING";
    configuration: {
      columns?: number;
      maxPerRow?: number;
      serpentine?: boolean;
      startAngle?: number;
    };
    stampSize: number;
    stampSpacing: number;
  };
  customerWeb: { variant: "CARD" | "MINIMAL" | "HERO" };
  apple: {
    headerLabel: string;
    headerValue: string;
    secondaryLabel: string;
    barcodeLabel: string;
    showBackContent: boolean;
  };
  google: {
    title: string;
    subtitle: string;
    detailsLabel: string;
    barcodeLabel: string;
  };
}

interface TemplateSeed {
  code: string;
  category: ProgramTemplateCategory;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  goal: number;
  rewardEn: string;
  rewardAr: string;
  accent: string;
  secondary: string;
  foreground: string;
  background: string;
  artwork: string;
  milestoneArtwork?: string;
  layout: ProgramTemplateDefinition["layout"]["type"];
  copyEn: string;
  copyAr: string;
}

const launchSeeds: TemplateSeed[] = [
  {
    code: "COFFEE",
    category: "food-and-beverage",
    name: "Coffee",
    nameAr: "القهوة",
    description: "A warm cup-by-cup ritual.",
    descriptionAr: "رحلة دافئة مع كل كوب.",
    goal: 8,
    rewardEn: "A coffee on us",
    rewardAr: "قهوة علينا",
    accent: "#8B5E3C",
    secondary: "#D6A66C",
    foreground: "#2F1D14",
    background: "#FFF8EE",
    artwork: "COFFEE_CUP",
    milestoneArtwork: "GIFT",
    layout: "GRID",
    copyEn: "Collect a cup stamp with every qualifying coffee.",
    copyAr: "اجمع ختم كوب مع كل طلب قهوة مؤهل.",
  },
  {
    code: "COOKIES",
    category: "food-and-beverage",
    name: "Cookies & bakery",
    nameAr: "الكوكيز والمخبوزات",
    description: "A colorful cookie journey.",
    descriptionAr: "رحلة كوكيز ملونة ولذيذة.",
    goal: 8,
    rewardEn: "Your favorite cookie is free",
    rewardAr: "قطعة الكوكيز المفضلة مجاناً",
    accent: "#D96B2B",
    secondary: "#F2B35D",
    foreground: "#3C2415",
    background: "#FFF8EA",
    artwork: "COOKIE",
    milestoneArtwork: "GIFT",
    layout: "GRID",
    copyEn: "Collect a cookie stamp with every qualifying bakery visit.",
    copyAr: "اجمع ختم كوكيز مع كل زيارة مؤهلة للمخبز.",
  },
  {
    code: "CAR_WASH",
    category: "automotive",
    name: "Car wash",
    nameAr: "غسيل السيارات",
    description: "Every clean car moves you closer.",
    descriptionAr: "كل غسلة تقرّبك من مكافأتك.",
    goal: 6,
    rewardEn: "A premium wash upgrade",
    rewardAr: "ترقية غسيل مميزة",
    accent: "#1976A3",
    secondary: "#62C7E8",
    foreground: "#123348",
    background: "#F0FAFF",
    artwork: "CAR",
    milestoneArtwork: "WATER_DROP",
    layout: "PATH",
    copyEn: "Earn a car stamp with every qualifying wash.",
    copyAr: "اكسب ختم سيارة مع كل غسلة مؤهلة.",
  },
  {
    code: "SALON",
    category: "beauty-and-wellness",
    name: "Salon",
    nameAr: "صالون",
    description: "A polished appointment reward.",
    descriptionAr: "مكافأة أنيقة لمواعيدك.",
    goal: 6,
    rewardEn: "A complimentary treatment",
    rewardAr: "عناية مجانية",
    accent: "#B65D91",
    secondary: "#E9A9C9",
    foreground: "#4A213A",
    background: "#FFF5FA",
    artwork: "FLOWER",
    milestoneArtwork: "HEART",
    layout: "RING",
    copyEn: "Collect a flower stamp at every qualifying appointment.",
    copyAr: "اجمع ختم زهرة في كل موعد مؤهل.",
  },
  {
    code: "BARBERSHOP",
    category: "beauty-and-wellness",
    name: "Barbershop",
    nameAr: "الحلاقة الرجالية",
    description: "Sharp rewards for regular visits.",
    descriptionAr: "مكافآت مميزة لزيارات الحلاقة.",
    goal: 6,
    rewardEn: "A complimentary service",
    rewardAr: "خدمة حلاقة مجانية",
    accent: "#245B73",
    secondary: "#D7A84B",
    foreground: "#172F3B",
    background: "#F4F8FA",
    artwork: "SCISSORS",
    milestoneArtwork: "STAR",
    layout: "ROW",
    copyEn: "Collect a scissors stamp with every qualifying service.",
    copyAr: "اجمع ختم مقص مع كل خدمة مؤهلة.",
  },
  {
    code: "RESTAURANT",
    category: "food-and-beverage",
    name: "Restaurant",
    nameAr: "مطعم",
    description: "Turn favorite meals into rewards.",
    descriptionAr: "حوّل وجباتك المفضلة إلى مكافآت.",
    goal: 10,
    rewardEn: "A house special",
    rewardAr: "طبق مميز من المطعم",
    accent: "#B44332",
    secondary: "#E7A04B",
    foreground: "#401D18",
    background: "#FFF7F2",
    artwork: "DONUT",
    milestoneArtwork: "GIFT",
    layout: "GRID",
    copyEn: "Collect a stamp with every qualifying meal.",
    copyAr: "اجمع ختماً مع كل وجبة مؤهلة.",
  },
  {
    code: "RETAIL",
    category: "services-and-retail",
    name: "Retail",
    nameAr: "متجر",
    description: "Make every shopping visit count.",
    descriptionAr: "اجعل كل زيارة تسوق ذات قيمة.",
    goal: 8,
    rewardEn: "A special shopping reward",
    rewardAr: "مكافأة تسوق خاصة",
    accent: "#5264B8",
    secondary: "#AEB8ED",
    foreground: "#252B57",
    background: "#F7F8FF",
    artwork: "SHOPPING_BAG",
    milestoneArtwork: "GIFT",
    layout: "GRID",
    copyEn: "Collect a shopping-bag stamp with every qualifying visit.",
    copyAr: "اجمع ختم حقيبة تسوق مع كل زيارة مؤهلة.",
  },
  {
    code: "GENERAL_VISITS",
    category: "general",
    name: "General visits",
    nameAr: "الزيارات العامة",
    description: "A flexible reward for any repeat visit.",
    descriptionAr: "مكافأة مرنة لكل زيارة متكررة.",
    goal: 8,
    rewardEn: "Your visit reward",
    rewardAr: "مكافأة زيارتك",
    accent: "#B94D35",
    secondary: "#E7A46E",
    foreground: "#38251F",
    background: "#FFF8F3",
    artwork: "GENERAL_CIRCLE",
    milestoneArtwork: "GIFT",
    layout: "GRID",
    copyEn: "Collect one stamp with every qualifying visit.",
    copyAr: "اجمع ختماً واحداً مع كل زيارة مؤهلة.",
  },
];

function copy(seed: TemplateSeed, locale: "en" | "ar"): ProgramTemplateCopy {
  const isArabic = locale === "ar";
  const name = isArabic ? seed.nameAr : seed.name;
  const description = isArabic ? seed.copyAr : seed.copyEn;
  const reward = isArabic ? seed.rewardAr : seed.rewardEn;
  return {
    programName: isArabic ? `مكافآت ${name}` : `${name} rewards`,
    shortDescription: description,
    fullDescription: description,
    rewardSummary: reward,
    joinInstructions: isArabic
      ? "اطلب من فريق المتجر إضافة ختم تجريبي عند كل زيارة مؤهلة."
      : "Ask the store team to add a stamp for each qualifying visit.",
    termsAndConditions: isArabic
      ? "تطبق شروط المتجر. المكافآت وصفية ضمن المرحلة الثانية."
      : "Merchant terms apply. Rewards remain descriptive in W2.",
    completionMessage: isArabic ? "اكتملت بطاقة الأختام." : "Your stamp card is complete.",
    rewardUnlockedMessage: isArabic ? `أصبحت مكافأتك جاهزة: ${reward}` : `Reward ready: ${reward}`,
    pausedMessage: isArabic ? "هذا البرنامج متوقف مؤقتاً." : "This program is temporarily paused.",
  };
}

function reward(
  seed: TemplateSeed,
  thresholdStampCount: number,
  milestone = false,
): ProgramTemplateReward {
  const en = milestone ? "A little thank-you" : seed.rewardEn;
  const ar = milestone ? "هدية شكر صغيرة" : seed.rewardAr;
  return {
    thresholdStampCount,
    rewardType: "TEXT_REWARD",
    internalName: milestone ? "Milestone reward" : "Final reward",
    requiresManagerApproval: false,
    validityDurationDays: 30,
    maximumRedemptionsPerEarned: 1,
    translations: {
      en: {
        name: en,
        description: en,
        redemptionInstructions: "Show the unlocked reward to staff.",
      },
      ar: {
        name: ar,
        description: ar,
        redemptionInstructions: "أظهر المكافأة المفتوحة لفريق المتجر.",
      },
    },
    artwork: {
      code: `${seed.milestoneArtwork ?? seed.artwork}_MILESTONE`,
      version: 2,
    },
  };
}

function launchTemplate(seed: TemplateSeed): ProgramTemplateDefinition {
  return {
    code: seed.code,
    version: 2,
    category: seed.category,
    name: seed.name,
    nameAr: seed.nameAr,
    description: seed.description,
    descriptionAr: seed.descriptionAr,
    recommendedStampGoal: seed.goal,
    earningDescription: seed.copyEn,
    copy: { en: copy(seed, "en"), ar: copy(seed, "ar") },
    finalReward: reward(seed, seed.goal),
    milestones: seed.goal >= 8 ? [reward(seed, Math.floor(seed.goal / 2), true)] : [],
    colors: {
      background: seed.background,
      foreground: seed.foreground,
      accent: seed.accent,
      secondary: seed.secondary,
      muted: "#6B7280",
    },
    artwork: {
      filled: { code: `${seed.artwork}_FILLED`, version: 2 },
      empty: { code: `${seed.artwork}_EMPTY`, version: 2 },
      milestone: {
        code: `${seed.milestoneArtwork ?? seed.artwork}_MILESTONE`,
        version: 2,
      },
    },
    layout: {
      type: seed.layout,
      configuration:
        seed.layout === "GRID"
          ? { columns: seed.goal > 8 ? 5 : 4 }
          : seed.layout === "ROW"
            ? { maxPerRow: 6 }
            : seed.layout === "PATH"
              ? { maxPerRow: 4, serpentine: true }
              : { startAngle: -90 },
      stampSize: 48,
      stampSpacing: 8,
    },
    customerWeb: { variant: seed.code === "CAR_WASH" ? "HERO" : "CARD" },
    apple: {
      headerLabel: "REWARDS",
      headerValue: seed.name,
      secondaryLabel: "NEXT REWARD",
      barcodeLabel: "Preview barcode",
      showBackContent: true,
    },
    google: {
      title: `${seed.name} rewards`,
      subtitle: seed.description,
      detailsLabel: "Reward progress",
      barcodeLabel: "Preview barcode",
    },
  };
}

const legacyCodes = [
  "COOKIES",
  "COFFEE",
  "BAKERY",
  "PIZZA",
  "SMOOTHIE",
  "SALON",
  "FITNESS",
  "RETAIL",
  "FLOWERS",
  "BOOKS",
  "JUICE",
  "PETCARE",
] as const;

function legacyTemplate(code: (typeof legacyCodes)[number]): ProgramTemplateDefinition {
  const latest =
    launchSeeds.find((seed) => seed.code === code) ??
    launchSeeds.find((seed) => seed.code === "GENERAL_VISITS");
  if (!latest) throw new Error("The General visits template seed is required.");
  const seed: TemplateSeed = { ...latest, code, name: code, nameAr: code };
  const definition = launchTemplate(seed);
  return {
    ...definition,
    version: 1,
    artwork: {
      filled: { code: `${code}_FILLED`, version: 1 },
      empty: { code: `${code}_EMPTY`, version: 1 },
      milestone: { code: `${code}_MILESTONE`, version: 1 },
    },
  };
}

export const programTemplateCatalog: readonly ProgramTemplateDefinition[] = [
  ...legacyCodes.map(legacyTemplate),
  ...launchSeeds.map(launchTemplate),
];

export function findProgramTemplate(
  code: string,
  version?: number,
): ProgramTemplateDefinition | undefined {
  const matches = programTemplateCatalog.filter((template) => template.code === code);
  if (version !== undefined) return matches.find((template) => template.version === version);
  return matches.toSorted((left, right) => right.version - left.version)[0];
}

export function latestProgramTemplates(): ProgramTemplateDefinition[] {
  return launchSeeds.map((seed) => {
    const versions = programTemplateCatalog.filter((template) => template.code === seed.code);
    const latest = versions.toSorted((left, right) => right.version - left.version)[0];
    if (!latest) throw new Error(`The ${seed.code} launch template is required.`);
    return latest;
  });
}
