export type ProgramTemplateCategory =
  | "food-and-beverage"
  | "automotive"
  | "beauty-and-wellness"
  | "services-and-retail"
  | "general";

export type ProgramTemplateVisualRole = "SIGNATURE" | "PREMIUM" | "FRIENDLY" | "MINIMAL";

/**
 * Presentation-only art direction for built-in templates. These values describe how
 * renderer primitives are composed; they do not change Program, reward, or Wallet semantics.
 */
export interface ProgramTemplatePresentation {
  visualRole: ProgramTemplateVisualRole;
  composition:
    | "SPLIT_HERO"
    | "POSTER"
    | "STAMP_STAGE"
    | "EDITORIAL"
    | "LABEL_FRAME"
    | "SIDE_TOTEM"
    | "HEADER_BAND"
    | "DIAGONAL_FIELD";
  motifTreatment: "EDGE_CROP" | "WATERMARK" | "HEADER_MARK" | "CORNER_MARK" | "SIDE_MARK" | "BADGE";
  rewardTreatment: "INLINE" | "FRAMED" | "FOOTER_BAND" | "RULE" | "SIDE_PANEL" | "BADGE";
  density: "EXPRESSIVE" | "BALANCED" | "COMPACT" | "AIRY";
  cornerTreatment: "ROUND" | "SOFT" | "CRISP";
  titleTreatment: "DISPLAY" | "EDITORIAL" | "COMPACT" | "QUIET";
}

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
  /** Absent on historical definitions so their renderer output stays immutable. */
  presentation?: ProgramTemplatePresentation;
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
  version?: number;
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
  layoutConfiguration?: ProgramTemplateDefinition["layout"]["configuration"];
  stampSize?: number;
  stampSpacing?: number;
  customerVariant?: ProgramTemplateDefinition["customerWeb"]["variant"];
  copyEn: string;
  copyAr: string;
}

const originalLaunchSeeds: TemplateSeed[] = [
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

function originalLaunchSeed(code: string): TemplateSeed {
  const seed = originalLaunchSeeds.find((item) => item.code === code);
  if (!seed) throw new Error(`The ${code} original launch seed is required.`);
  return seed;
}

/**
 * P2.1 immutable launch library. Existing launch codes move to a new version while
 * their v2 definitions remain in the catalog below. New visual concepts begin at
 * v1 because their stable codes did not exist before this library expansion.
 */
const p21LaunchSeeds: TemplateSeed[] = [
  {
    ...originalLaunchSeed("COFFEE"),
    version: 3,
    name: "Classic Roast",
    nameAr: "المحمصة الكلاسيكية",
    description: "Warm café craft with a familiar cup ritual.",
    descriptionAr: "طابع مقهى دافئ مع رحلة أختام مألوفة.",
    rewardEn: "A coffee on us",
    rewardAr: "قهوة مجانية من اختيارك",
    copyEn: "Collect a cup stamp with every qualifying coffee.",
    copyAr: "اجمع ختم كوب مع كل طلب قهوة مؤهل.",
    layoutConfiguration: { columns: 4 },
    customerVariant: "CARD",
  },
  {
    code: "COFFEE_DARK_ESPRESSO",
    version: 1,
    category: "food-and-beverage",
    name: "Dark Espresso",
    nameAr: "إسبريسو داكن",
    description: "A compact, premium card inspired by the espresso bar.",
    descriptionAr: "بطاقة مدمجة بطابع فاخر مستوحى من ركن الإسبريسو.",
    goal: 6,
    rewardEn: "A complimentary espresso drink",
    rewardAr: "مشروب إسبريسو مجاني",
    accent: "#D89A56",
    secondary: "#5B3425",
    foreground: "#FFF5E8",
    background: "#1D1614",
    artwork: "ESPRESSO_SHOT",
    milestoneArtwork: "GIFT",
    layout: "ROW",
    layoutConfiguration: { maxPerRow: 6 },
    stampSize: 46,
    stampSpacing: 9,
    customerVariant: "HERO",
    copyEn: "Earn an espresso stamp with every qualifying drink.",
    copyAr: "اجمع ختم إسبريسو مع كل مشروب مؤهل.",
  },
  {
    code: "COFFEE_WARM_LATTE",
    version: 1,
    category: "food-and-beverage",
    name: "Warm Latte",
    nameAr: "لاتيه دافئ",
    description: "A soft, friendly card built around an everyday latte.",
    descriptionAr: "بطاقة هادئة وودودة تحتفي بكوب اللاتيه اليومي.",
    goal: 8,
    rewardEn: "A latte or size upgrade",
    rewardAr: "لاتيه مجاني أو ترقية للحجم",
    accent: "#B96F45",
    secondary: "#E9C9A6",
    foreground: "#4B3125",
    background: "#FFF4E5",
    artwork: "LATTE_CUP",
    milestoneArtwork: "GIFT",
    layout: "RING",
    layoutConfiguration: { startAngle: -90 },
    stampSize: 42,
    stampSpacing: 10,
    customerVariant: "CARD",
    copyEn: "Collect a latte stamp with every qualifying café visit.",
    copyAr: "اجمع ختم لاتيه مع كل زيارة مؤهلة للمقهى.",
  },
  {
    code: "COFFEE_MODERN_CAFE",
    version: 1,
    category: "food-and-beverage",
    name: "Modern Café",
    nameAr: "مقهى عصري",
    description: "Clean typography and a bean-led path for modern counters.",
    descriptionAr: "تصميم نظيف ومسار حبوب قهوة يناسب المقاهي العصرية.",
    goal: 6,
    rewardEn: "A drink upgrade",
    rewardAr: "ترقية مجانية للمشروب",
    accent: "#39715E",
    secondary: "#A8C8BC",
    foreground: "#1E332D",
    background: "#F4F6F3",
    artwork: "COFFEE_BEAN",
    milestoneArtwork: "GIFT",
    layout: "PATH",
    layoutConfiguration: { columns: 3, serpentine: true },
    stampSize: 44,
    stampSpacing: 12,
    customerVariant: "MINIMAL",
    copyEn: "Earn a coffee-bean stamp with every qualifying order.",
    copyAr: "اجمع ختم حبة قهوة مع كل طلب مؤهل.",
  },

  {
    ...originalLaunchSeed("COOKIES"),
    version: 3,
    name: "Cookie Club",
    nameAr: "نادي الكوكيز",
    description: "A playful cookie card for colorful bakery counters.",
    descriptionAr: "بطاقة مرحة تناسب أركان الكوكيز والمخبوزات الملونة.",
    rewardEn: "Your favorite cookie is free",
    rewardAr: "قطعة الكوكيز المفضلة مجانًا",
    layoutConfiguration: { columns: 4 },
    customerVariant: "CARD",
  },
  {
    code: "BAKERY_ARTISAN",
    version: 1,
    category: "food-and-beverage",
    name: "Artisan Bakery",
    nameAr: "المخبز الحِرفي",
    description: "A crafted bread-card with a warm neighborhood feel.",
    descriptionAr: "بطاقة بطابع حِرفي دافئ للمخابز المحلية.",
    goal: 10,
    rewardEn: "A baked item from the house selection",
    rewardAr: "قطعة مخبوزات من اختيار المخبز",
    accent: "#C47A3D",
    secondary: "#9A5A2D",
    foreground: "#FFF5E6",
    background: "#3A261A",
    artwork: "BREAD_LOAF",
    milestoneArtwork: "GIFT",
    layout: "ROW",
    layoutConfiguration: { maxPerRow: 5 },
    stampSize: 44,
    stampSpacing: 9,
    customerVariant: "HERO",
    copyEn: "Collect a bread stamp with every qualifying bakery purchase.",
    copyAr: "اجمع ختم رغيف مع كل عملية شراء مؤهلة من المخبز.",
  },
  {
    code: "BAKERY_SWEET_TREAT",
    version: 1,
    category: "food-and-beverage",
    name: "Sweet Treat",
    nameAr: "حلوى اليوم",
    description: "A bright celebration for cakes, cupcakes, and small treats.",
    descriptionAr: "تصميم مبهج للكيك والكب كيك والحلويات الصغيرة.",
    goal: 6,
    rewardEn: "A complimentary sweet treat",
    rewardAr: "قطعة حلوى مجانية",
    accent: "#D94E78",
    secondary: "#F5B65D",
    foreground: "#4A2030",
    background: "#FFF3F7",
    artwork: "CUPCAKE",
    milestoneArtwork: "GIFT",
    layout: "RING",
    layoutConfiguration: { startAngle: -60 },
    stampSize: 44,
    stampSpacing: 8,
    customerVariant: "CARD",
    copyEn: "Collect a cupcake stamp with every qualifying treat.",
    copyAr: "اجمع ختم كب كيك مع كل طلب حلوى مؤهل.",
  },
  {
    code: "BAKERY_SOFT_PASTRY",
    version: 1,
    category: "food-and-beverage",
    name: "Soft Pastry",
    nameAr: "معجنات رقيقة",
    description: "A quiet, airy design for pastry and morning bakes.",
    descriptionAr: "تصميم هادئ وخفيف للمعجنات ومخبوزات الصباح.",
    goal: 8,
    rewardEn: "A pastry on your next visit",
    rewardAr: "قطعة معجنات في زيارتك القادمة",
    accent: "#A96F58",
    secondary: "#E8C8B7",
    foreground: "#4A332B",
    background: "#FFF9F5",
    artwork: "CROISSANT",
    milestoneArtwork: "GIFT",
    layout: "PATH",
    layoutConfiguration: { columns: 4, serpentine: true },
    stampSize: 42,
    stampSpacing: 11,
    customerVariant: "MINIMAL",
    copyEn: "Earn a pastry stamp with every qualifying bakery visit.",
    copyAr: "اجمع ختم معجنات مع كل زيارة مؤهلة للمخبز.",
  },

  {
    ...originalLaunchSeed("CAR_WASH"),
    version: 3,
    name: "Clean Blue",
    nameAr: "لمعان أزرق",
    description: "A crisp blue wash path with unmistakable automotive energy.",
    descriptionAr: "مسار أزرق واضح بطابع سيارات ونظافة مباشرة.",
    rewardEn: "A premium wash upgrade",
    rewardAr: "ترقية إلى غسيل مميز",
    layoutConfiguration: { columns: 3, serpentine: true },
    customerVariant: "HERO",
  },
  {
    code: "CAR_WASH_PREMIUM_AUTO",
    version: 1,
    category: "automotive",
    name: "Premium Auto",
    nameAr: "عناية مميزة بالسيارة",
    description: "A polished navy card for detailing and premium care.",
    descriptionAr: "بطاقة كحلية أنيقة لخدمات التلميع والعناية المميزة.",
    goal: 8,
    rewardEn: "A premium detailing add-on",
    rewardAr: "إضافة مجانية من خدمات التلميع",
    accent: "#D0A653",
    secondary: "#274B63",
    foreground: "#F8FBFD",
    background: "#0E2433",
    artwork: "CAR_SPARKLE",
    milestoneArtwork: "GIFT",
    layout: "GRID",
    layoutConfiguration: { columns: 4 },
    stampSize: 44,
    stampSpacing: 9,
    customerVariant: "CARD",
    copyEn: "Collect a polished-car stamp with every qualifying service.",
    copyAr: "اجمع ختم سيارة لامعة مع كل خدمة مؤهلة.",
  },
  {
    code: "CAR_WASH_DARK_GARAGE",
    version: 1,
    category: "automotive",
    name: "Dark Garage",
    nameAr: "المرآب الداكن",
    description: "A compact garage-inspired card with bold foam marks.",
    descriptionAr: "بطاقة مدمجة مستوحاة من المرآب وفقاعات الغسيل.",
    goal: 6,
    rewardEn: "A complimentary wash add-on",
    rewardAr: "إضافة مجانية لخدمة الغسيل",
    accent: "#59C7E8",
    secondary: "#33444D",
    foreground: "#F4F8FA",
    background: "#1D2327",
    artwork: "FOAM_BUBBLES",
    milestoneArtwork: "WATER_DROP",
    layout: "ROW",
    layoutConfiguration: { maxPerRow: 3 },
    stampSize: 48,
    stampSpacing: 12,
    customerVariant: "MINIMAL",
    copyEn: "Earn a foam stamp with every qualifying wash.",
    copyAr: "اجمع ختم رغوة مع كل غسلة مؤهلة.",
  },
  {
    code: "CAR_WASH_SIMPLE",
    version: 1,
    category: "automotive",
    name: "Simple Wash",
    nameAr: "غسيل بسيط",
    description: "A clean aqua card for quick and dependable service.",
    descriptionAr: "بطاقة بلون مائي نظيف لخدمة سريعة وموثوقة.",
    goal: 6,
    rewardEn: "A wash upgrade",
    rewardAr: "ترقية مجانية للغسيل",
    accent: "#2187A5",
    secondary: "#A7E0E7",
    foreground: "#173A44",
    background: "#F2FCFD",
    artwork: "WATER_DROP",
    milestoneArtwork: "GIFT",
    layout: "RING",
    layoutConfiguration: { startAngle: -90 },
    stampSize: 44,
    stampSpacing: 8,
    customerVariant: "CARD",
    copyEn: "Collect a water-drop stamp with every qualifying wash.",
    copyAr: "اجمع ختم قطرة ماء مع كل غسلة مؤهلة.",
  },

  {
    ...originalLaunchSeed("SALON"),
    version: 3,
    name: "Soft Blush",
    nameAr: "لمسة وردية",
    description: "A soft floral card with an elegant appointment rhythm.",
    descriptionAr: "بطاقة زهرية ناعمة بإيقاع أنيق للمواعيد.",
    rewardEn: "A complimentary treatment",
    rewardAr: "جلسة عناية مجانية",
    customerVariant: "CARD",
  },
  {
    code: "SALON_LUXURY_BEAUTY",
    version: 1,
    category: "beauty-and-wellness",
    name: "Luxury Beauty",
    nameAr: "جمال فاخر",
    description: "A dramatic plum card for premium beauty services.",
    descriptionAr: "بطاقة بلون برقوقي غني لخدمات الجمال الراقية.",
    goal: 8,
    rewardEn: "A premium beauty add-on",
    rewardAr: "إضافة مجانية من خدمات الجمال",
    accent: "#D7A6C6",
    secondary: "#6E3A60",
    foreground: "#FFF1F8",
    background: "#2A1424",
    artwork: "BEAUTY_SPARKLE",
    milestoneArtwork: "GIFT",
    layout: "GRID",
    layoutConfiguration: { columns: 4 },
    stampSize: 44,
    stampSpacing: 10,
    customerVariant: "HERO",
    copyEn: "Collect a beauty-sparkle stamp with every qualifying appointment.",
    copyAr: "اجمع ختم لمعة جمال مع كل موعد مؤهل.",
  },
  {
    code: "SALON_MODERN_NAILS",
    version: 1,
    category: "beauty-and-wellness",
    name: "Modern Nails",
    nameAr: "أناقة الأظافر",
    description: "A bold, editorial card made for nail studios.",
    descriptionAr: "بطاقة جريئة وعصرية تناسب استوديوهات الأظافر.",
    goal: 6,
    rewardEn: "A complimentary nail add-on",
    rewardAr: "إضافة مجانية لخدمة الأظافر",
    accent: "#E15170",
    secondary: "#FFB7A7",
    foreground: "#4C1D2A",
    background: "#FFF5F3",
    artwork: "NAIL_POLISH",
    milestoneArtwork: "GIFT",
    layout: "ROW",
    layoutConfiguration: { maxPerRow: 3 },
    stampSize: 48,
    stampSpacing: 11,
    customerVariant: "CARD",
    copyEn: "Earn a polish stamp with every qualifying nail appointment.",
    copyAr: "اجمع ختم طلاء أظافر مع كل موعد مؤهل.",
  },
  {
    code: "SALON_MINIMAL_SPA",
    version: 1,
    category: "beauty-and-wellness",
    name: "Minimal Spa",
    nameAr: "سبا هادئ",
    description: "A calm, spacious card for wellness and spa visits.",
    descriptionAr: "بطاقة هادئة ومتوازنة لزيارات السبا والعناية.",
    goal: 8,
    rewardEn: "A wellness add-on",
    rewardAr: "إضافة مجانية لجلسة العناية",
    accent: "#668A78",
    secondary: "#BED0C5",
    foreground: "#263C32",
    background: "#F5F8F5",
    artwork: "LOTUS",
    milestoneArtwork: "GIFT",
    layout: "PATH",
    layoutConfiguration: { columns: 4, serpentine: false },
    stampSize: 42,
    stampSpacing: 12,
    customerVariant: "MINIMAL",
    copyEn: "Collect a lotus stamp with every qualifying wellness visit.",
    copyAr: "اجمع ختم زهرة لوتس مع كل زيارة عناية مؤهلة.",
  },

  {
    ...originalLaunchSeed("BARBERSHOP"),
    version: 3,
    name: "Classic Barber",
    nameAr: "الحلاقة الكلاسيكية",
    description: "A familiar scissors card with traditional shop character.",
    descriptionAr: "بطاقة مقص بطابع مألوف يعكس روح محال الحلاقة التقليدية.",
    rewardEn: "A complimentary service",
    rewardAr: "خدمة حلاقة مجانية",
    customerVariant: "CARD",
  },
  {
    code: "BARBERSHOP_DARK_GROOMING",
    version: 1,
    category: "beauty-and-wellness",
    name: "Dark Grooming",
    nameAr: "أناقة داكنة",
    description: "A dark, precise card for grooming and shave services.",
    descriptionAr: "بطاقة داكنة ودقيقة لخدمات الحلاقة والعناية.",
    goal: 8,
    rewardEn: "A grooming add-on",
    rewardAr: "إضافة مجانية لخدمة العناية",
    accent: "#C49B56",
    secondary: "#365563",
    foreground: "#F4F0E8",
    background: "#14232A",
    artwork: "RAZOR",
    milestoneArtwork: "GIFT",
    layout: "GRID",
    layoutConfiguration: { columns: 4 },
    stampSize: 44,
    stampSpacing: 9,
    customerVariant: "HERO",
    copyEn: "Collect a razor stamp with every qualifying grooming service.",
    copyAr: "اجمع ختم شفرة مع كل خدمة عناية مؤهلة.",
  },
  {
    code: "BARBERSHOP_MODERN_CUT",
    version: 1,
    category: "beauty-and-wellness",
    name: "Modern Cut",
    nameAr: "قَصّة عصرية",
    description: "A clean linear card for contemporary barber studios.",
    descriptionAr: "بطاقة بخطوط نظيفة لمحال الحلاقة العصرية.",
    goal: 6,
    rewardEn: "A complimentary styling add-on",
    rewardAr: "إضافة مجانية لخدمة التصفيف",
    accent: "#28708B",
    secondary: "#A7CFDA",
    foreground: "#173746",
    background: "#F2F8FA",
    artwork: "COMB",
    milestoneArtwork: "GIFT",
    layout: "PATH",
    layoutConfiguration: { columns: 3, serpentine: true },
    stampSize: 44,
    stampSpacing: 12,
    customerVariant: "MINIMAL",
    copyEn: "Earn a comb stamp with every qualifying cut.",
    copyAr: "اجمع ختم مشط مع كل قَصّة مؤهلة.",
  },
  {
    code: "BARBERSHOP_HERITAGE",
    version: 1,
    category: "beauty-and-wellness",
    name: "Heritage Barber",
    nameAr: "حلاقة عريقة",
    description: "A heritage pole design with a classic neighborhood feel.",
    descriptionAr: "تصميم مستوحى من عمود الحلاق بطابع محلي عريق.",
    goal: 8,
    rewardEn: "A classic grooming service",
    rewardAr: "خدمة عناية كلاسيكية مجانية",
    accent: "#A53A35",
    secondary: "#315A70",
    foreground: "#392724",
    background: "#FFF8ED",
    artwork: "BARBER_POLE",
    milestoneArtwork: "GIFT",
    layout: "RING",
    layoutConfiguration: { startAngle: -90 },
    stampSize: 42,
    stampSpacing: 8,
    customerVariant: "CARD",
    copyEn: "Collect a barber-pole stamp with every qualifying visit.",
    copyAr: "اجمع ختم عمود الحلاق مع كل زيارة مؤهلة.",
  },

  {
    ...originalLaunchSeed("RESTAURANT"),
    version: 3,
    name: "Warm Dining",
    nameAr: "مائدة دافئة",
    description: "A welcoming dining card centered on the shared table.",
    descriptionAr: "بطاقة ترحيبية تتمحور حول المائدة وتجربة الطعام.",
    rewardEn: "A house special",
    rewardAr: "طبق مميز من المطعم",
    artwork: "DINNER_PLATE",
    layoutConfiguration: { columns: 5 },
    customerVariant: "CARD",
  },
  {
    code: "RESTAURANT_MODERN_BISTRO",
    version: 1,
    category: "food-and-beverage",
    name: "Modern Bistro",
    nameAr: "مطعم عصري",
    description: "A refined cloche-led card for modern dining rooms.",
    descriptionAr: "بطاقة راقية برمز طبق التقديم للمطاعم العصرية.",
    goal: 8,
    rewardEn: "A complimentary house item",
    rewardAr: "صنف مجاني من اختيارات المطعم",
    accent: "#D4AA64",
    secondary: "#315849",
    foreground: "#FFF7E8",
    background: "#17352E",
    artwork: "CLOCHE",
    milestoneArtwork: "GIFT",
    layout: "RING",
    layoutConfiguration: { startAngle: -90 },
    stampSize: 42,
    stampSpacing: 9,
    customerVariant: "HERO",
    copyEn: "Collect a cloche stamp with every qualifying meal.",
    copyAr: "اجمع ختم طبق تقديم مع كل وجبة مؤهلة.",
  },
  {
    code: "RESTAURANT_CLASSIC_TABLE",
    version: 1,
    category: "food-and-beverage",
    name: "Classic Table",
    nameAr: "المائدة الكلاسيكية",
    description: "A structured table-service card with timeless cutlery marks.",
    descriptionAr: "بطاقة منظمة لخدمة المائدة برمز أدوات الطعام الكلاسيكي.",
    goal: 8,
    rewardEn: "A complimentary dessert",
    rewardAr: "حلوى مجانية",
    accent: "#A64539",
    secondary: "#D8B47A",
    foreground: "#3F2923",
    background: "#FFF9F0",
    artwork: "FORK_KNIFE",
    milestoneArtwork: "GIFT",
    layout: "ROW",
    layoutConfiguration: { maxPerRow: 4 },
    stampSize: 44,
    stampSpacing: 10,
    customerVariant: "CARD",
    copyEn: "Earn a table stamp with every qualifying dining visit.",
    copyAr: "اجمع ختم مائدة مع كل زيارة طعام مؤهلة.",
  },
  {
    code: "RESTAURANT_QUICK_BITES",
    version: 1,
    category: "food-and-beverage",
    name: "Quick Bites",
    nameAr: "لقيمات سريعة",
    description: "A lively, compact card for quick-service counters.",
    descriptionAr: "بطاقة حيوية ومدمجة لمطاعم الخدمة السريعة.",
    goal: 6,
    rewardEn: "A complimentary menu item",
    rewardAr: "صنف مجاني من القائمة",
    accent: "#E35A35",
    secondary: "#F4C44D",
    foreground: "#3E241C",
    background: "#FFF7E6",
    artwork: "BURGER",
    milestoneArtwork: "GIFT",
    layout: "PATH",
    layoutConfiguration: { columns: 3, serpentine: true },
    stampSize: 46,
    stampSpacing: 11,
    customerVariant: "MINIMAL",
    copyEn: "Collect a bite stamp with every qualifying order.",
    copyAr: "اجمع ختم وجبة مع كل طلب مؤهل.",
  },

  {
    ...originalLaunchSeed("RETAIL"),
    version: 3,
    name: "Clean Shop",
    nameAr: "متجر أنيق",
    description: "A clear shopping card with a familiar bag motif.",
    descriptionAr: "بطاقة تسوق واضحة برمز حقيبة مألوف.",
    rewardEn: "A special shopping reward",
    rewardAr: "مكافأة تسوق خاصة",
    layoutConfiguration: { columns: 4 },
    customerVariant: "CARD",
  },
  {
    code: "RETAIL_BOLD",
    version: 1,
    category: "services-and-retail",
    name: "Bold Retail",
    nameAr: "تسوّق جريء",
    description: "A high-energy tag card for colorful retail brands.",
    descriptionAr: "بطاقة حيوية برمز بطاقة السعر للمتاجر الجريئة.",
    goal: 6,
    rewardEn: "A member shopping reward",
    rewardAr: "مكافأة تسوق للأعضاء",
    accent: "#8B4CC2",
    secondary: "#F06E73",
    foreground: "#2E173D",
    background: "#FCF4FF",
    artwork: "PRICE_TAG",
    milestoneArtwork: "GIFT",
    layout: "ROW",
    layoutConfiguration: { maxPerRow: 3 },
    stampSize: 48,
    stampSpacing: 11,
    customerVariant: "HERO",
    copyEn: "Collect a price-tag stamp with every qualifying purchase.",
    copyAr: "اجمع ختم بطاقة سعر مع كل عملية شراء مؤهلة.",
  },
  {
    code: "RETAIL_PREMIUM_MEMBER",
    version: 1,
    category: "services-and-retail",
    name: "Premium Member",
    nameAr: "عضوية مميزة",
    description: "A dark member-card treatment for premium retail service.",
    descriptionAr: "بطاقة عضوية داكنة لخدمات التجزئة المميزة.",
    goal: 8,
    rewardEn: "An exclusive member reward",
    rewardAr: "مكافأة حصرية للأعضاء",
    accent: "#D6B35F",
    secondary: "#554A62",
    foreground: "#FFF8E7",
    background: "#201C26",
    artwork: "MEMBER_BADGE",
    milestoneArtwork: "GIFT",
    layout: "RING",
    layoutConfiguration: { startAngle: -90 },
    stampSize: 42,
    stampSpacing: 8,
    customerVariant: "CARD",
    copyEn: "Collect a member badge with every qualifying purchase.",
    copyAr: "اجمع شارة عضو مع كل عملية شراء مؤهلة.",
  },
  {
    code: "RETAIL_MINIMAL_STORE",
    version: 1,
    category: "services-and-retail",
    name: "Minimal Store",
    nameAr: "متجر بسيط",
    description: "A quiet modular card for modern shops and services.",
    descriptionAr: "بطاقة هادئة ومنظمة للمتاجر والخدمات العصرية.",
    goal: 6,
    rewardEn: "A special store reward",
    rewardAr: "مكافأة خاصة من المتجر",
    accent: "#4E7392",
    secondary: "#BED1DF",
    foreground: "#263946",
    background: "#F5F8FA",
    artwork: "PACKAGE_BOX",
    milestoneArtwork: "GIFT",
    layout: "PATH",
    layoutConfiguration: { columns: 3, serpentine: false },
    stampSize: 44,
    stampSpacing: 12,
    customerVariant: "MINIMAL",
    copyEn: "Earn a package stamp with every qualifying visit.",
    copyAr: "اجمع ختم طرد مع كل زيارة مؤهلة.",
  },

  {
    ...originalLaunchSeed("GENERAL_VISITS"),
    version: 3,
    name: "Simple Visits",
    nameAr: "زيارات بسيطة",
    description: "A flexible visit card with a clear, familiar rhythm.",
    descriptionAr: "بطاقة مرنة للزيارات بإيقاع واضح ومألوف.",
    rewardEn: "Your visit reward",
    rewardAr: "مكافأة زيارتك",
    layoutConfiguration: { columns: 4 },
    customerVariant: "CARD",
  },
  {
    code: "GENERAL_MODERN_REWARDS",
    version: 1,
    category: "general",
    name: "Modern Rewards",
    nameAr: "مكافآت عصرية",
    description: "A bold loop motif for flexible modern reward programs.",
    descriptionAr: "رمز دائري جريء لبرامج المكافآت المرنة والعصرية.",
    goal: 8,
    rewardEn: "A reward from the business",
    rewardAr: "مكافأة مقدمة من النشاط التجاري",
    accent: "#A892FF",
    secondary: "#514981",
    foreground: "#F8F6FF",
    background: "#2B2550",
    artwork: "REWARD_LOOP",
    milestoneArtwork: "GIFT",
    layout: "RING",
    layoutConfiguration: { startAngle: -90 },
    stampSize: 42,
    stampSpacing: 9,
    customerVariant: "HERO",
    copyEn: "Collect a reward-loop stamp with every qualifying visit.",
    copyAr: "اجمع ختم دائرة مكافأة مع كل زيارة مؤهلة.",
  },
  {
    code: "GENERAL_NEUTRAL_LOYALTY",
    version: 1,
    category: "general",
    name: "Neutral Loyalty",
    nameAr: "ولاء مرن",
    description: "A restrained, neutral card that adapts to any service.",
    descriptionAr: "بطاقة محايدة وهادئة تتكيف مع مختلف الخدمات.",
    goal: 6,
    rewardEn: "Your loyalty reward",
    rewardAr: "مكافأة ولائك",
    accent: "#5D6A64",
    secondary: "#C9D0CC",
    foreground: "#2B3430",
    background: "#F7F8F7",
    artwork: "NEUTRAL_MARK",
    milestoneArtwork: "GIFT",
    layout: "ROW",
    layoutConfiguration: { maxPerRow: 6 },
    stampSize: 44,
    stampSpacing: 10,
    customerVariant: "MINIMAL",
    copyEn: "Earn a neutral mark with every qualifying visit.",
    copyAr: "اجمع علامة ولاء مع كل زيارة مؤهلة.",
  },
  {
    code: "GENERAL_EVERYDAY_CLUB",
    version: 1,
    category: "general",
    name: "Everyday Club",
    nameAr: "نادي كل يوم",
    description: "A friendly badge path for frequent everyday visits.",
    descriptionAr: "مسار شارات ودود للزيارات اليومية المتكررة.",
    goal: 10,
    rewardEn: "An everyday member reward",
    rewardAr: "مكافأة لأعضاء النادي",
    accent: "#C65F45",
    secondary: "#EABF74",
    foreground: "#3E2A24",
    background: "#FFF8EF",
    artwork: "VISIT_BADGE",
    milestoneArtwork: "GIFT",
    layout: "PATH",
    layoutConfiguration: { columns: 5, serpentine: true },
    stampSize: 42,
    stampSpacing: 9,
    customerVariant: "CARD",
    copyEn: "Collect a club badge with every qualifying visit.",
    copyAr: "اجمع شارة النادي مع كل زيارة مؤهلة.",
  },
];

const refinedPresentationByCode: Record<string, ProgramTemplatePresentation> = {
  COFFEE: {
    visualRole: "SIGNATURE",
    composition: "SPLIT_HERO",
    motifTreatment: "EDGE_CROP",
    rewardTreatment: "INLINE",
    density: "EXPRESSIVE",
    cornerTreatment: "CRISP",
    titleTreatment: "DISPLAY",
  },
  COFFEE_DARK_ESPRESSO: {
    visualRole: "PREMIUM",
    composition: "HEADER_BAND",
    motifTreatment: "HEADER_MARK",
    rewardTreatment: "FRAMED",
    density: "COMPACT",
    cornerTreatment: "ROUND",
    titleTreatment: "COMPACT",
  },
  COFFEE_WARM_LATTE: {
    visualRole: "FRIENDLY",
    composition: "STAMP_STAGE",
    motifTreatment: "BADGE",
    rewardTreatment: "FOOTER_BAND",
    density: "BALANCED",
    cornerTreatment: "ROUND",
    titleTreatment: "QUIET",
  },
  COFFEE_MODERN_CAFE: {
    visualRole: "MINIMAL",
    composition: "EDITORIAL",
    motifTreatment: "WATERMARK",
    rewardTreatment: "RULE",
    density: "AIRY",
    cornerTreatment: "CRISP",
    titleTreatment: "EDITORIAL",
  },
  COOKIES: {
    visualRole: "SIGNATURE",
    composition: "DIAGONAL_FIELD",
    motifTreatment: "EDGE_CROP",
    rewardTreatment: "BADGE",
    density: "EXPRESSIVE",
    cornerTreatment: "ROUND",
    titleTreatment: "DISPLAY",
  },
  BAKERY_ARTISAN: {
    visualRole: "PREMIUM",
    composition: "LABEL_FRAME",
    motifTreatment: "SIDE_MARK",
    rewardTreatment: "FRAMED",
    density: "COMPACT",
    cornerTreatment: "CRISP",
    titleTreatment: "EDITORIAL",
  },
  BAKERY_SWEET_TREAT: {
    visualRole: "FRIENDLY",
    composition: "POSTER",
    motifTreatment: "CORNER_MARK",
    rewardTreatment: "FOOTER_BAND",
    density: "BALANCED",
    cornerTreatment: "ROUND",
    titleTreatment: "QUIET",
  },
  BAKERY_SOFT_PASTRY: {
    visualRole: "MINIMAL",
    composition: "SIDE_TOTEM",
    motifTreatment: "SIDE_MARK",
    rewardTreatment: "SIDE_PANEL",
    density: "AIRY",
    cornerTreatment: "SOFT",
    titleTreatment: "QUIET",
  },
  CAR_WASH: {
    visualRole: "SIGNATURE",
    composition: "SPLIT_HERO",
    motifTreatment: "EDGE_CROP",
    rewardTreatment: "INLINE",
    density: "EXPRESSIVE",
    cornerTreatment: "CRISP",
    titleTreatment: "DISPLAY",
  },
  CAR_WASH_PREMIUM_AUTO: {
    visualRole: "PREMIUM",
    composition: "HEADER_BAND",
    motifTreatment: "HEADER_MARK",
    rewardTreatment: "FRAMED",
    density: "COMPACT",
    cornerTreatment: "ROUND",
    titleTreatment: "COMPACT",
  },
  CAR_WASH_DARK_GARAGE: {
    visualRole: "MINIMAL",
    composition: "SIDE_TOTEM",
    motifTreatment: "SIDE_MARK",
    rewardTreatment: "SIDE_PANEL",
    density: "AIRY",
    cornerTreatment: "CRISP",
    titleTreatment: "QUIET",
  },
  CAR_WASH_SIMPLE: {
    visualRole: "FRIENDLY",
    composition: "STAMP_STAGE",
    motifTreatment: "BADGE",
    rewardTreatment: "FOOTER_BAND",
    density: "BALANCED",
    cornerTreatment: "ROUND",
    titleTreatment: "QUIET",
  },
  SALON: {
    visualRole: "FRIENDLY",
    composition: "DIAGONAL_FIELD",
    motifTreatment: "CORNER_MARK",
    rewardTreatment: "FOOTER_BAND",
    density: "BALANCED",
    cornerTreatment: "ROUND",
    titleTreatment: "QUIET",
  },
  SALON_LUXURY_BEAUTY: {
    visualRole: "PREMIUM",
    composition: "LABEL_FRAME",
    motifTreatment: "HEADER_MARK",
    rewardTreatment: "FRAMED",
    density: "COMPACT",
    cornerTreatment: "ROUND",
    titleTreatment: "COMPACT",
  },
  SALON_MODERN_NAILS: {
    visualRole: "SIGNATURE",
    composition: "POSTER",
    motifTreatment: "EDGE_CROP",
    rewardTreatment: "BADGE",
    density: "EXPRESSIVE",
    cornerTreatment: "CRISP",
    titleTreatment: "DISPLAY",
  },
  SALON_MINIMAL_SPA: {
    visualRole: "MINIMAL",
    composition: "EDITORIAL",
    motifTreatment: "WATERMARK",
    rewardTreatment: "RULE",
    density: "AIRY",
    cornerTreatment: "SOFT",
    titleTreatment: "EDITORIAL",
  },
  BARBERSHOP: {
    visualRole: "SIGNATURE",
    composition: "SPLIT_HERO",
    motifTreatment: "EDGE_CROP",
    rewardTreatment: "INLINE",
    density: "EXPRESSIVE",
    cornerTreatment: "CRISP",
    titleTreatment: "DISPLAY",
  },
  BARBERSHOP_DARK_GROOMING: {
    visualRole: "PREMIUM",
    composition: "HEADER_BAND",
    motifTreatment: "HEADER_MARK",
    rewardTreatment: "FRAMED",
    density: "COMPACT",
    cornerTreatment: "ROUND",
    titleTreatment: "COMPACT",
  },
  BARBERSHOP_MODERN_CUT: {
    visualRole: "MINIMAL",
    composition: "EDITORIAL",
    motifTreatment: "WATERMARK",
    rewardTreatment: "RULE",
    density: "AIRY",
    cornerTreatment: "CRISP",
    titleTreatment: "EDITORIAL",
  },
  BARBERSHOP_HERITAGE: {
    visualRole: "FRIENDLY",
    composition: "LABEL_FRAME",
    motifTreatment: "SIDE_MARK",
    rewardTreatment: "FOOTER_BAND",
    density: "BALANCED",
    cornerTreatment: "SOFT",
    titleTreatment: "EDITORIAL",
  },
  RESTAURANT: {
    visualRole: "FRIENDLY",
    composition: "STAMP_STAGE",
    motifTreatment: "BADGE",
    rewardTreatment: "FOOTER_BAND",
    density: "BALANCED",
    cornerTreatment: "ROUND",
    titleTreatment: "QUIET",
  },
  RESTAURANT_MODERN_BISTRO: {
    visualRole: "PREMIUM",
    composition: "HEADER_BAND",
    motifTreatment: "HEADER_MARK",
    rewardTreatment: "FRAMED",
    density: "COMPACT",
    cornerTreatment: "ROUND",
    titleTreatment: "COMPACT",
  },
  RESTAURANT_CLASSIC_TABLE: {
    visualRole: "MINIMAL",
    composition: "EDITORIAL",
    motifTreatment: "WATERMARK",
    rewardTreatment: "RULE",
    density: "AIRY",
    cornerTreatment: "CRISP",
    titleTreatment: "EDITORIAL",
  },
  RESTAURANT_QUICK_BITES: {
    visualRole: "SIGNATURE",
    composition: "POSTER",
    motifTreatment: "EDGE_CROP",
    rewardTreatment: "BADGE",
    density: "EXPRESSIVE",
    cornerTreatment: "ROUND",
    titleTreatment: "DISPLAY",
  },
  RETAIL: {
    visualRole: "FRIENDLY",
    composition: "STAMP_STAGE",
    motifTreatment: "BADGE",
    rewardTreatment: "FOOTER_BAND",
    density: "BALANCED",
    cornerTreatment: "ROUND",
    titleTreatment: "QUIET",
  },
  RETAIL_BOLD: {
    visualRole: "SIGNATURE",
    composition: "DIAGONAL_FIELD",
    motifTreatment: "EDGE_CROP",
    rewardTreatment: "INLINE",
    density: "EXPRESSIVE",
    cornerTreatment: "CRISP",
    titleTreatment: "DISPLAY",
  },
  RETAIL_PREMIUM_MEMBER: {
    visualRole: "PREMIUM",
    composition: "LABEL_FRAME",
    motifTreatment: "HEADER_MARK",
    rewardTreatment: "FRAMED",
    density: "COMPACT",
    cornerTreatment: "ROUND",
    titleTreatment: "COMPACT",
  },
  RETAIL_MINIMAL_STORE: {
    visualRole: "MINIMAL",
    composition: "SIDE_TOTEM",
    motifTreatment: "SIDE_MARK",
    rewardTreatment: "SIDE_PANEL",
    density: "AIRY",
    cornerTreatment: "CRISP",
    titleTreatment: "QUIET",
  },
  GENERAL_VISITS: {
    visualRole: "FRIENDLY",
    composition: "DIAGONAL_FIELD",
    motifTreatment: "CORNER_MARK",
    rewardTreatment: "FOOTER_BAND",
    density: "BALANCED",
    cornerTreatment: "SOFT",
    titleTreatment: "QUIET",
  },
  GENERAL_MODERN_REWARDS: {
    visualRole: "PREMIUM",
    composition: "SPLIT_HERO",
    motifTreatment: "WATERMARK",
    rewardTreatment: "FRAMED",
    density: "COMPACT",
    cornerTreatment: "ROUND",
    titleTreatment: "COMPACT",
  },
  GENERAL_NEUTRAL_LOYALTY: {
    visualRole: "MINIMAL",
    composition: "SIDE_TOTEM",
    motifTreatment: "SIDE_MARK",
    rewardTreatment: "SIDE_PANEL",
    density: "AIRY",
    cornerTreatment: "CRISP",
    titleTreatment: "EDITORIAL",
  },
  GENERAL_EVERYDAY_CLUB: {
    visualRole: "SIGNATURE",
    composition: "POSTER",
    motifTreatment: "EDGE_CROP",
    rewardTreatment: "BADGE",
    density: "EXPRESSIVE",
    cornerTreatment: "ROUND",
    titleTreatment: "DISPLAY",
  },
};

function refinedPresentation(code: string): ProgramTemplatePresentation {
  const presentation = refinedPresentationByCode[code];
  if (!presentation) throw new Error(`The ${code} refined presentation is required.`);
  return presentation;
}

/**
 * P2.1R keeps every prior immutable definition and advances only the latest
 * presentation-bearing definitions. Domain defaults and reward economics are unchanged.
 */
const launchSeeds: TemplateSeed[] = p21LaunchSeeds.map((seed) => ({
  ...seed,
  version: (seed.version ?? 2) + 1,
}));

function copy(
  seed: TemplateSeed,
  locale: "en" | "ar",
  historicalW2Copy = false,
): ProgramTemplateCopy {
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
    termsAndConditions: historicalW2Copy
      ? isArabic
        ? "تطبق شروط المتجر. المكافآت وصفية ضمن المرحلة الثانية."
        : "Merchant terms apply. Rewards remain descriptive in W2."
      : isArabic
        ? "تطبق شروط النشاط التجاري على الزيارات والمكافآت المؤهلة."
        : "Merchant terms apply to qualifying visits and rewards.",
    completionMessage: isArabic ? "اكتملت بطاقة الأختام." : "Your stamp card is complete.",
    rewardUnlockedMessage: isArabic ? `أصبحت مكافأتك جاهزة: ${reward}` : `Reward ready: ${reward}`,
    pausedMessage: historicalW2Copy
      ? isArabic
        ? "هذا البرنامج متوقف مؤقتاً."
        : "This program is temporarily paused."
      : isArabic
        ? "بطاقة الولاء متوقفة مؤقتًا."
        : "This loyalty card is temporarily paused.",
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
    validityDurationDays: milestone ? 30 : null,
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

function launchTemplate(
  seed: TemplateSeed,
  options: {
    version?: number;
    historicalW2Copy?: boolean;
    presentation?: ProgramTemplatePresentation;
  } = {},
): ProgramTemplateDefinition {
  const version = options.version ?? seed.version ?? 2;
  return {
    code: seed.code,
    version,
    category: seed.category,
    name: seed.name,
    nameAr: seed.nameAr,
    description: seed.description,
    descriptionAr: seed.descriptionAr,
    recommendedStampGoal: seed.goal,
    earningDescription: seed.copyEn,
    copy: {
      en: copy(seed, "en", options.historicalW2Copy),
      ar: copy(seed, "ar", options.historicalW2Copy),
    },
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
        seed.layoutConfiguration ??
        (seed.layout === "GRID"
          ? { columns: seed.goal > 8 ? 5 : 4 }
          : seed.layout === "ROW"
            ? { maxPerRow: 6 }
            : seed.layout === "PATH"
              ? { maxPerRow: 4, serpentine: true }
              : { startAngle: -90 }),
      stampSize: seed.stampSize ?? 48,
      stampSpacing: seed.stampSpacing ?? 8,
    },
    customerWeb: {
      variant: seed.customerVariant ?? (seed.code === "CAR_WASH" ? "HERO" : "CARD"),
    },
    ...(options.presentation ? { presentation: options.presentation } : {}),
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
  const original =
    originalLaunchSeeds.find((seed) => seed.code === code) ??
    originalLaunchSeeds.find((seed) => seed.code === "GENERAL_VISITS");
  if (!original) throw new Error("The General visits template seed is required.");
  const seed: TemplateSeed = { ...original, code, name: code, nameAr: code };
  const definition = launchTemplate(seed, { version: 1, historicalW2Copy: true });
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
  ...originalLaunchSeeds.map((seed) =>
    launchTemplate(seed, { version: 2, historicalW2Copy: true }),
  ),
  ...p21LaunchSeeds.map((seed) => launchTemplate(seed)),
  ...launchSeeds.map((seed) =>
    launchTemplate(seed, { presentation: refinedPresentation(seed.code) }),
  ),
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
