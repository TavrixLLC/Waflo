import type { Locale, ProgramTemplateDefinition } from "@waflo/contracts";

export const templateGalleryCategories = [
  "all",
  "coffee",
  "bakery",
  "car-wash",
  "salon",
  "barbershop",
  "restaurant",
  "retail",
  "general",
] as const;

export type TemplateGalleryCategory = (typeof templateGalleryCategories)[number];
export type TemplateCategory = Exclude<TemplateGalleryCategory, "all">;

export type TemplateVisualStyle =
  | "classic"
  | "dark"
  | "soft"
  | "minimal"
  | "playful"
  | "heritage"
  | "bold"
  | "clean"
  | "premium"
  | "modern"
  | "warm"
  | "elegant"
  | "friendly"
  | "neutral";

interface TemplatePresentationMetadata {
  category: TemplateCategory;
  style: TemplateVisualStyle;
}

const templatePresentationByCode: Readonly<Record<string, TemplatePresentationMetadata>> = {
  COFFEE: { category: "coffee", style: "classic" },
  COFFEE_DARK_ESPRESSO: { category: "coffee", style: "dark" },
  COFFEE_WARM_LATTE: { category: "coffee", style: "soft" },
  COFFEE_MODERN_CAFE: { category: "coffee", style: "minimal" },
  COOKIES: { category: "bakery", style: "playful" },
  BAKERY_ARTISAN: { category: "bakery", style: "heritage" },
  BAKERY_SWEET_TREAT: { category: "bakery", style: "bold" },
  BAKERY_SOFT_PASTRY: { category: "bakery", style: "soft" },
  CAR_WASH: { category: "car-wash", style: "clean" },
  CAR_WASH_PREMIUM_AUTO: { category: "car-wash", style: "premium" },
  CAR_WASH_DARK_GARAGE: { category: "car-wash", style: "dark" },
  CAR_WASH_SIMPLE: { category: "car-wash", style: "minimal" },
  SALON: { category: "salon", style: "soft" },
  SALON_LUXURY_BEAUTY: { category: "salon", style: "premium" },
  SALON_MODERN_NAILS: { category: "salon", style: "modern" },
  SALON_MINIMAL_SPA: { category: "salon", style: "minimal" },
  BARBERSHOP: { category: "barbershop", style: "classic" },
  BARBERSHOP_DARK_GROOMING: { category: "barbershop", style: "dark" },
  BARBERSHOP_MODERN_CUT: { category: "barbershop", style: "modern" },
  BARBERSHOP_HERITAGE: { category: "barbershop", style: "heritage" },
  RESTAURANT: { category: "restaurant", style: "warm" },
  RESTAURANT_MODERN_BISTRO: { category: "restaurant", style: "elegant" },
  RESTAURANT_CLASSIC_TABLE: { category: "restaurant", style: "classic" },
  RESTAURANT_QUICK_BITES: { category: "restaurant", style: "playful" },
  RETAIL: { category: "retail", style: "clean" },
  RETAIL_BOLD: { category: "retail", style: "bold" },
  RETAIL_PREMIUM_MEMBER: { category: "retail", style: "premium" },
  RETAIL_MINIMAL_STORE: { category: "retail", style: "minimal" },
  GENERAL_VISITS: { category: "general", style: "friendly" },
  GENERAL_MODERN_REWARDS: { category: "general", style: "modern" },
  GENERAL_NEUTRAL_LOYALTY: { category: "general", style: "neutral" },
  GENERAL_EVERYDAY_CLUB: { category: "general", style: "playful" },
};

const categoryLabels: Record<TemplateGalleryCategory, Record<Locale, string>> = {
  all: { en: "All", ar: "الكل" },
  coffee: { en: "Coffee", ar: "القهوة" },
  bakery: { en: "Bakery", ar: "المخبوزات" },
  "car-wash": { en: "Car Wash", ar: "غسيل السيارات" },
  salon: { en: "Salon", ar: "الصالون" },
  barbershop: { en: "Barbershop", ar: "الحلاقة الرجالية" },
  restaurant: { en: "Restaurant", ar: "المطاعم" },
  retail: { en: "Retail", ar: "متاجر التجزئة" },
  general: { en: "General", ar: "عام" },
};

const styleLabels: Record<TemplateVisualStyle, Record<Locale, string>> = {
  classic: { en: "Classic", ar: "كلاسيكي" },
  dark: { en: "Dark", ar: "داكن" },
  soft: { en: "Soft", ar: "ناعم" },
  minimal: { en: "Minimal", ar: "بسيط" },
  playful: { en: "Playful", ar: "مرح" },
  heritage: { en: "Heritage", ar: "عريق" },
  bold: { en: "Bold", ar: "جريء" },
  clean: { en: "Clean", ar: "نظيف" },
  premium: { en: "Premium", ar: "فاخر" },
  modern: { en: "Modern", ar: "عصري" },
  warm: { en: "Warm", ar: "دافئ" },
  elegant: { en: "Elegant", ar: "أنيق" },
  friendly: { en: "Friendly", ar: "ودود" },
  neutral: { en: "Neutral", ar: "محايد" },
};

const businessCategoryMatchers: readonly [TemplateCategory, readonly RegExp[]][] = [
  ["barbershop", [/barber/i, /groom/i, /حلاق/u]],
  ["car-wash", [/car\s*wash/i, /auto/i, /سيار/u]],
  ["bakery", [/bakery/i, /bake/i, /bread/i, /cookie/i, /مخبز/u, /حلويات/u]],
  ["coffee", [/coffee/i, /cafe/i, /café/i, /قهو/u, /مقهى/u]],
  ["salon", [/salon/i, /beauty/i, /nail/i, /spa/i, /صالون/u, /تجميل/u]],
  ["restaurant", [/restaurant/i, /dining/i, /bistro/i, /food/i, /مطعم/u]],
  ["retail", [/retail/i, /shop/i, /store/i, /متجر/u, /تجزئة/u]],
  ["general", [/general/i, /visit/i, /service/i, /عام/u, /خدم/u]],
];

function normalizeSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0640\u064b-\u065f\u0670]/gu, "")
    .toLocaleLowerCase("en-US")
    .trim();
}

export function templateCategory(
  template: Pick<ProgramTemplateDefinition, "code">,
): TemplateCategory {
  return templatePresentationByCode[template.code]?.category ?? "general";
}

export function templateCategoryLabel(category: TemplateGalleryCategory, locale: Locale): string {
  return categoryLabels[category][locale];
}

export function templateDisplayName(
  template: Pick<ProgramTemplateDefinition, "name" | "nameAr">,
  locale: Locale,
): string {
  return locale === "ar" ? template.nameAr : template.name;
}

export function templateStyleLabel(
  template: Pick<ProgramTemplateDefinition, "code">,
  locale: Locale,
): string {
  const style = templatePresentationByCode[template.code]?.style ?? "neutral";
  return styleLabels[style][locale];
}

export function hasTemplatePresentationMetadata(
  template: Pick<ProgramTemplateDefinition, "code">,
): boolean {
  return template.code in templatePresentationByCode;
}

export function businessRecommendationCategory(businessCategory: string | null | undefined): {
  category: TemplateCategory;
  matchedBusiness: boolean;
} {
  const normalized = normalizeSearch(businessCategory ?? "");
  if (!normalized) return { category: "general", matchedBusiness: false };

  for (const [category, patterns] of businessCategoryMatchers) {
    if (patterns.some((pattern) => pattern.test(normalized))) {
      return { category, matchedBusiness: category !== "general" };
    }
  }
  return { category: "general", matchedBusiness: false };
}

export function recommendedTemplates<T extends Pick<ProgramTemplateDefinition, "code">>(
  templates: readonly T[],
  businessCategory: string | null | undefined,
): T[] {
  const recommendation = businessRecommendationCategory(businessCategory);
  return templates
    .filter((template) => templateCategory(template) === recommendation.category)
    .slice(0, 3);
}

export function filterTemplates<T extends ProgramTemplateDefinition>(
  templates: readonly T[],
  category: TemplateGalleryCategory,
  query: string,
): T[] {
  const normalizedQuery = normalizeSearch(query);
  return templates.filter((template) => {
    if (category !== "all" && templateCategory(template) !== category) return false;
    if (!normalizedQuery) return true;

    const merchantCategory = templateCategory(template);
    const searchable = [
      template.name,
      template.nameAr,
      categoryLabels[merchantCategory].en,
      categoryLabels[merchantCategory].ar,
      templateStyleLabel(template, "en"),
      templateStyleLabel(template, "ar"),
    ]
      .map(normalizeSearch)
      .join(" ");
    return searchable.includes(normalizedQuery);
  });
}
