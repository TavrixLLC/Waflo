import { z } from "zod";

export type CardTextDirection = "ltr" | "rtl";
export type CardLocaleProviderSupport = "supported" | "normalized" | "limited";

export interface CardLocaleMetadata {
  readonly id: string;
  readonly englishName: string;
  readonly nativeName: string;
  readonly direction: CardTextDirection;
  readonly script: string;
  readonly aliases: readonly string[];
  readonly popular: boolean;
  readonly region?: string;
  readonly parentLocale?: string;
  readonly providers: {
    readonly customerWeb: CardLocaleProviderSupport;
    readonly appleWallet: CardLocaleProviderSupport;
    readonly googleWallet: CardLocaleProviderSupport;
  };
}

// A deliberately curated, practical catalog rather than every technical CLDR
// permutation. Adding an entry is a data change: card storage remains BCP-47
// string based and requires no database migration.
const practicalCardLocaleIds = [
  "af",
  "am",
  "ar",
  "as",
  "az",
  "be",
  "bg",
  "bn",
  "bs",
  "ca",
  "ckb",
  "cs",
  "cy",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "eu",
  "fa",
  "fi",
  "fil",
  "fr",
  "ga",
  "gl",
  "gu",
  "he",
  "hi",
  "hr",
  "hu",
  "hy",
  "id",
  "is",
  "it",
  "ja",
  "ka",
  "kk",
  "km",
  "ku-Arab-IQ",
  "kn",
  "ko",
  "ky",
  "lo",
  "lt",
  "lv",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "mt",
  "my",
  "ne",
  "nl",
  "no",
  "or",
  "pa",
  "pl",
  "ps",
  "pt",
  "pt-BR",
  "pt-PT",
  "ro",
  "ru",
  "si",
  "sk",
  "sl",
  "sq",
  "sr-Cyrl",
  "sr-Latn",
  "sv",
  "sw",
  "ta",
  "te",
  "th",
  "tr",
  "uk",
  "ur",
  "uz-Cyrl",
  "uz-Latn",
  "vi",
  "zh-Hans",
  "zh-Hant",
  "zu",
] as const;

const popularLocales = new Set([
  "en",
  "ar",
  "fr",
  "es",
  "de",
  "pt-BR",
  "zh-Hans",
  "zh-Hant",
  "ja",
  "ko",
  "hi",
  "tr",
  "fa",
  "ur",
  "ckb",
  "ku-Arab-IQ",
]);

const localeOverrides: Readonly<
  Record<
    string,
    Partial<Pick<CardLocaleMetadata, "englishName" | "nativeName" | "aliases" | "parentLocale">>
  >
> = {
  ckb: {
    englishName: "Kurdish (Sorani)",
    nativeName: "کوردی سۆرانی",
    aliases: ["Sorani", "Central Kurdish"],
  },
  "ku-Arab-IQ": {
    englishName: "Kurdish (Badini)",
    nativeName: "کوردی بادینی",
    aliases: ["Badini", "Bahdini", "Kurmanji Arabic"],
    parentLocale: "kmr",
  },
  "pt-BR": {
    englishName: "Portuguese (Brazil)",
    aliases: ["Brazilian Portuguese", "Brasil"],
    parentLocale: "pt",
  },
  "pt-PT": {
    englishName: "Portuguese (Portugal)",
    aliases: ["European Portuguese", "Portugal"],
    parentLocale: "pt",
  },
  "sr-Cyrl": {
    englishName: "Serbian (Cyrillic)",
    aliases: ["Serbian Cyrillic"],
    parentLocale: "sr",
  },
  "sr-Latn": {
    englishName: "Serbian (Latin)",
    aliases: ["Serbian Latin"],
    parentLocale: "sr",
  },
  "uz-Cyrl": {
    englishName: "Uzbek (Cyrillic)",
    aliases: ["Uzbek Cyrillic"],
    parentLocale: "uz",
  },
  "uz-Latn": {
    englishName: "Uzbek (Latin)",
    aliases: ["Uzbek Latin"],
    parentLocale: "uz",
  },
  "zh-Hans": {
    englishName: "Chinese (Simplified)",
    nativeName: "简体中文",
    aliases: ["Simplified Chinese", "Mandarin Simplified"],
    parentLocale: "zh",
  },
  "zh-Hant": {
    englishName: "Chinese (Traditional)",
    nativeName: "繁體中文",
    aliases: ["Traditional Chinese", "Mandarin Traditional"],
    parentLocale: "zh",
  },
};

const rtlScripts = new Set(["Adlm", "Arab", "Hebr", "Nkoo", "Rohg", "Syrc", "Thaa"]);

function displayName(locale: string, displayLocale: string): string {
  return (
    new Intl.DisplayNames([displayLocale], { type: "language", fallback: "code" }).of(locale) ??
    locale
  );
}

function metadataFor(id: string): CardLocaleMetadata {
  const locale = new Intl.Locale(id);
  const maximized = locale.maximize();
  const script = maximized.script ?? "Zyyy";
  const override = localeOverrides[id];
  return Object.freeze({
    id,
    englishName: override?.englishName ?? displayName(id, "en"),
    nativeName: override?.nativeName ?? displayName(id, id),
    direction: rtlScripts.has(script) ? "rtl" : "ltr",
    script,
    aliases: Object.freeze(override?.aliases ?? []),
    popular: popularLocales.has(id),
    ...(locale.region ? { region: locale.region } : {}),
    ...(override?.parentLocale
      ? { parentLocale: override.parentLocale }
      : locale.language !== id
        ? { parentLocale: locale.language }
        : {}),
    providers: Object.freeze({
      customerWeb: "supported" as const,
      appleWallet: "normalized" as const,
      googleWallet: "limited" as const,
    }),
  });
}

export const cardLocaleRegistry: readonly CardLocaleMetadata[] = Object.freeze(
  practicalCardLocaleIds
    .map(metadataFor)
    .toSorted((left, right) =>
      left.englishName.localeCompare(right.englishName, "en", { sensitivity: "base" }),
    ),
);

const cardLocaleMap = new Map(cardLocaleRegistry.map((locale) => [locale.id, locale]));

export function canonicalizeCardLocale(value: string): string | null {
  const candidate = value.trim();
  if (!candidate || candidate.length > 35 || candidate.includes("_")) return null;
  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? null;
  } catch {
    return null;
  }
}

export function isSupportedCardLocale(value: string): boolean {
  const canonical = canonicalizeCardLocale(value);
  return canonical !== null && cardLocaleMap.has(canonical);
}

export function cardLocaleMetadata(value: string): CardLocaleMetadata | null {
  const canonical = canonicalizeCardLocale(value);
  return canonical ? (cardLocaleMap.get(canonical) ?? null) : null;
}

export function directionForCardLocale(value: string): CardTextDirection {
  return cardLocaleMetadata(value)?.direction ?? "ltr";
}

export function fontStackForCardLocale(value: string): string {
  const metadata = cardLocaleMetadata(value);
  if (!metadata) return "var(--font-manrope, Manrope), system-ui, sans-serif";
  if (metadata.id === "ckb" || metadata.id === "ku-Arab-IQ") {
    return 'var(--font-noto-sans-arabic, "Noto Sans Arabic"), var(--font-cairo, Cairo), system-ui, sans-serif';
  }
  if (metadata.script === "Arab") {
    return 'var(--font-cairo, Cairo), "Noto Sans Arabic", system-ui, sans-serif';
  }
  if (["Hans", "Hant", "Jpan", "Kore"].includes(metadata.script)) {
    return "system-ui, PingFang SC, Hiragino Sans, Yu Gothic, Malgun Gothic, sans-serif";
  }
  return "var(--font-manrope, Manrope), system-ui, sans-serif";
}

export const cardLocaleSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .transform((value, context) => {
    const canonical = canonicalizeCardLocale(value);
    if (!canonical || !cardLocaleMap.has(canonical)) {
      context.addIssue({ code: "custom", message: "Choose a supported BCP-47 card locale." });
      return z.NEVER;
    }
    return canonical;
  });

export interface CardLocaleConfiguration {
  readonly defaultLocale: string;
  readonly enabledLocales: readonly string[];
}

export function normalizeCardLocaleConfiguration(
  defaultLocale: string,
  enabledLocales: readonly string[],
): CardLocaleConfiguration | null {
  const canonicalDefault = canonicalizeCardLocale(defaultLocale);
  if (!canonicalDefault || !cardLocaleMap.has(canonicalDefault)) return null;
  const normalized: string[] = [];
  for (const value of enabledLocales) {
    const canonical = canonicalizeCardLocale(value);
    if (!canonical || !cardLocaleMap.has(canonical) || normalized.includes(canonical)) return null;
    normalized.push(canonical);
  }
  if (!normalized.length || !normalized.includes(canonicalDefault)) return null;
  return {
    defaultLocale: canonicalDefault,
    enabledLocales: [canonicalDefault, ...normalized.filter((item) => item !== canonicalDefault)],
  };
}

export function enableCardLocale(
  configuration: CardLocaleConfiguration,
  locale: string,
): CardLocaleConfiguration | null {
  const canonical = canonicalizeCardLocale(locale);
  if (!canonical || !cardLocaleMap.has(canonical)) return null;
  return normalizeCardLocaleConfiguration(configuration.defaultLocale, [
    ...configuration.enabledLocales,
    ...(!configuration.enabledLocales.includes(canonical) ? [canonical] : []),
  ]);
}

export function disableCardLocale(
  configuration: CardLocaleConfiguration,
  locale: string,
): CardLocaleConfiguration | null {
  const canonical = canonicalizeCardLocale(locale);
  if (!canonical || canonical === configuration.defaultLocale) return null;
  return normalizeCardLocaleConfiguration(
    configuration.defaultLocale,
    configuration.enabledLocales.filter((item) => item !== canonical),
  );
}

export function changeDefaultCardLocale(
  configuration: CardLocaleConfiguration,
  locale: string,
): CardLocaleConfiguration | null {
  const canonical = canonicalizeCardLocale(locale);
  if (!canonical || !configuration.enabledLocales.includes(canonical)) return null;
  return normalizeCardLocaleConfiguration(canonical, configuration.enabledLocales);
}

export const cardLocaleConfigurationSchema = z
  .object({
    defaultLocale: cardLocaleSchema,
    enabledLocales: z.array(cardLocaleSchema).min(1).max(cardLocaleRegistry.length),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.enabledLocales).size !== value.enabledLocales.length) {
      context.addIssue({
        code: "custom",
        path: ["enabledLocales"],
        message: "Enabled card locales must be unique.",
      });
    }
    if (!value.enabledLocales.includes(value.defaultLocale)) {
      context.addIssue({
        code: "custom",
        path: ["defaultLocale"],
        message: "The default card locale must be enabled.",
      });
    }
  });

function parseLanguagePriority(value: string): string[] {
  return value
    .split(",")
    .map((part, index) => {
      const [tag = "", ...parameters] = part.trim().split(";");
      const qualityText = parameters
        .map((parameter) => /^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i.exec(parameter.trim()))
        .find(Boolean)?.[1];
      return { tag, quality: qualityText === undefined ? 1 : Number(qualityText), index };
    })
    .filter((item) => item.tag !== "*" && item.quality > 0)
    .toSorted((left, right) => right.quality - left.quality || left.index - right.index)
    .map((item) => item.tag);
}

function scriptFor(value: string): string | undefined {
  try {
    return new Intl.Locale(value).maximize().script;
  } catch {
    return undefined;
  }
}

function compatibleEnabledLocale(requested: string, enabled: readonly string[]): string | null {
  const exact = enabled.find((locale) => locale === requested);
  if (exact) return exact;
  const requestedLocale = new Intl.Locale(requested);
  const base = enabled.find((locale) => locale === requestedLocale.language);
  if (base) return base;

  const requestedScript = scriptFor(requested);
  const compatibleVariants = enabled.filter((candidate) => {
    const locale = new Intl.Locale(candidate);
    if (locale.language !== requestedLocale.language || scriptFor(candidate) !== requestedScript) {
      return false;
    }
    // Region-specific variants are not interchangeable unless the merchant
    // enabled a neutral language parent (handled above).
    if (requestedLocale.region && locale.region && requestedLocale.region !== locale.region) {
      return false;
    }
    return true;
  });
  return compatibleVariants.length === 1 ? (compatibleVariants[0] ?? null) : null;
}

export function resolveCardLocale(input: {
  readonly enabledLocales: readonly string[];
  readonly defaultLocale: string;
  readonly explicitLocale?: string | null;
  readonly acceptedLanguages?: string | readonly string[] | null;
}): string {
  const configuration = normalizeCardLocaleConfiguration(input.defaultLocale, input.enabledLocales);
  if (!configuration) throw new Error("Card locale configuration is invalid.");
  const enabled = configuration.enabledLocales;
  if (input.explicitLocale) {
    const explicit = canonicalizeCardLocale(input.explicitLocale);
    if (explicit && enabled.includes(explicit)) return explicit;
  }
  const requested = Array.isArray(input.acceptedLanguages)
    ? input.acceptedLanguages
    : typeof input.acceptedLanguages === "string"
      ? parseLanguagePriority(input.acceptedLanguages)
      : [];
  for (const value of requested) {
    const canonical = canonicalizeCardLocale(value);
    if (!canonical) continue;
    const match = compatibleEnabledLocale(canonical, enabled);
    if (match) return match;
  }
  return configuration.defaultLocale;
}

export const cardLocaleProviderCapabilities = Object.freeze({
  customerWeb: {
    support: "supported" as const,
    localizedFields: "all Waflo customer-card text fields",
  },
  appleWallet: {
    support: "normalized" as const,
    localizedFields: "pass.strings-backed labels and merchant card copy",
    limitation: "Wallet controls layout, font selection, and some system labels.",
  },
  googleWallet: {
    support: "limited" as const,
    localizedFields: "LocalizedString-capable class/object fields",
    limitation: "Plain text module fields and provider-owned labels are not uniformly localizable.",
  },
});
