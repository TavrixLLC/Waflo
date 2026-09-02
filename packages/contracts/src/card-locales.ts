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

/**
 * The locale contract consumed by every Wallet surface.  Keep visual direction
 * and font choice here rather than having providers infer them from a language
 * prefix.  A locale's language and its writing direction are independent.
 */
export interface CardLocalePresentation {
  readonly locale: string;
  readonly language: string;
  readonly script: string;
  readonly direction: CardTextDirection;
  readonly isRtl: boolean;
  readonly fontStack: string;
  /** Apple accepts the same BCP-47-style language/script/region identifier in .lproj names. */
  readonly appleLocale: string;
}

export interface WalletStructuralCopy {
  readonly stamps: string;
  readonly member: string;
  readonly status: string;
  readonly reward: string;
  readonly program: string;
  readonly security: string;
  readonly active: string;
  readonly rewardReady: string;
  readonly transferred: string;
  readonly paused: string;
  readonly invalid: string;
  readonly nextReward: string;
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
  return cardLocalePresentation(value).direction;
}

function fontStackForPresentation(locale: string, script: string): string {
  if (locale === "ckb" || locale === "ku-Arab-IQ") {
    return 'var(--font-noto-sans-arabic, "Noto Sans Arabic"), var(--font-cairo, Cairo), system-ui, sans-serif';
  }
  if (script === "Arab") {
    return 'var(--font-cairo, Cairo), "Noto Sans Arabic", system-ui, sans-serif';
  }
  if (["Hans", "Hant", "Jpan", "Kore"].includes(script)) {
    return "system-ui, PingFang SC, Hiragino Sans, Yu Gothic, Malgun Gothic, sans-serif";
  }
  return "var(--font-manrope, Manrope), system-ui, sans-serif";
}

/** Returns a canonical presentation even for a valid BCP-47 value not yet in the picker registry. */
export function cardLocalePresentation(value: string): CardLocalePresentation {
  const locale = canonicalizeCardLocale(value) ?? "en";
  const intl = new Intl.Locale(locale);
  const metadata = cardLocaleMap.get(locale);
  const script = metadata?.script ?? intl.maximize().script ?? "Zyyy";
  const direction = metadata?.direction ?? (rtlScripts.has(script) ? "rtl" : "ltr");
  return Object.freeze({
    locale,
    language: intl.language,
    script,
    direction,
    isRtl: direction === "rtl",
    fontStack: fontStackForPresentation(locale, script),
    appleLocale: locale,
  });
}

export function fontStackForCardLocale(value: string): string {
  return cardLocalePresentation(value).fontStack;
}

const englishWalletStructuralCopy: WalletStructuralCopy = Object.freeze({
  stamps: "STAMPS",
  member: "MEMBER",
  status: "STATUS",
  reward: "REWARD",
  program: "PROGRAM",
  security: "SECURITY",
  active: "Active",
  rewardReady: "Reward ready",
  transferred: "Transferred",
  paused: "Temporarily paused",
  invalid: "No longer valid",
  nextReward: "NEXT REWARD",
});

const walletStructuralCopies: Readonly<Record<string, WalletStructuralCopy>> = Object.freeze({
  ar: {
    stamps: "\u0627\u0644\u0623\u062e\u062a\u0627\u0645",
    member: "\u0627\u0644\u0639\u0636\u0648",
    status: "\u0627\u0644\u062d\u0627\u0644\u0629",
    reward: "\u0627\u0644\u0645\u0643\u0627\u0641\u0623\u0629",
    program: "\u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062c",
    security: "\u0627\u0644\u0623\u0645\u0627\u0646",
    active: "\u0646\u0634\u0637\u0629",
    rewardReady: "\u0627\u0644\u0645\u0643\u0627\u0641\u0623\u0629 \u062c\u0627\u0647\u0632\u0629",
    transferred: "\u062a\u0645 \u0627\u0644\u0646\u0642\u0644",
    paused: "\u0645\u062a\u0648\u0642\u0641\u0629 \u0645\u0624\u0642\u062a\u064b\u0627",
    invalid: "\u0644\u0645 \u062a\u0639\u062f \u0635\u0627\u0644\u062d\u0629",
    nextReward:
      "\u0627\u0644\u0645\u0643\u0627\u0641\u0623\u0629 \u0627\u0644\u062a\u0627\u0644\u064a\u0629",
  },
  ckb: {
    stamps: "\u0645\u06c6\u0631",
    member: "\u0626\u06d5\u0646\u062f\u0627\u0645",
    status: "\u062f\u06c6\u062e",
    reward: "\u062e\u06d5\u06b5\u0627\u062a",
    program: "\u0628\u06d5\u0631\u0646\u0627\u0645\u06d5",
    security: "\u067e\u0627\u0631\u0627\u0633\u062a\u0646",
    active: "\u0686\u0627\u0644\u0627\u06a9",
    rewardReady: "\u062e\u06d5\u06b5\u0627\u062a \u0626\u0627\u0645\u0627\u062f\u06d5\u06cc\u06d5",
    transferred: "\u06af\u0648\u0627\u0632\u0631\u0627\u0648\u06d5\u062a\u06d5\u0648\u06d5",
    paused:
      "\u06a9\u0627\u062a\u06cc\u06cc \u0648\u06d5\u0633\u062a\u06ce\u0646\u0631\u0627\u0648\u06d5",
    invalid: "\u0686\u06cc\u062a\u0631 \u062f\u0631\u0648\u0633\u062a \u0646\u06cc\u06cc\u06d5",
    nextReward: "\u062e\u06d5\u06b5\u0627\u062a\u06cc \u062f\u0627\u0647\u0627\u062a\u0648\u0648",
  },
  "ku-Arab-IQ": {
    stamps: "\u0645\u06c6\u0631",
    member: "\u0626\u06d5\u0646\u062f\u0627\u0645",
    status: "\u0628\u0627\u0631\u0648\u062f\u06c6\u062e",
    reward: "\u062e\u06d5\u0644\u0627\u062a",
    program: "\u0628\u06d5\u0631\u0646\u0627\u0645\u06d5",
    security: "\u067e\u0627\u0631\u0627\u0633\u062a\u0646",
    active: "\u0686\u0627\u0644\u0627\u06a9",
    rewardReady: "\u062e\u06d5\u0644\u0627\u062a \u0626\u0627\u0645\u0627\u062f\u06d5\u06cc\u06d5",
    transferred: "\u0647\u0627\u062a\u06d5 \u06af\u06c6\u0695\u0648\u0647\u0627\u0633\u062a\u0646",
    paused:
      "\u0628\u06c6 \u06a9\u0627\u062a\u06ce\u06a9\u06cc \u0648\u06d5\u0633\u062a\u06cc\u0627",
    invalid: "\u0626\u06cc\u062f\u06cc \u0646\u06d5 \u062f\u0631\u0648\u0633\u062a\u06d5",
    nextReward: "\u062e\u06d5\u0644\u0627\u062a\u0627 \u062f\u0627\u0647\u0627\u062a\u0648\u0648",
  },
  fa: {
    stamps: "\u0645\u0647\u0631\u0647\u0627",
    member: "\u0639\u0636\u0648",
    status: "\u0648\u0636\u0639\u06cc\u062a",
    reward: "\u067e\u0627\u062f\u0627\u0634",
    program: "\u0628\u0631\u0646\u0627\u0645\u0647",
    security: "\u0627\u0645\u0646\u06cc\u062a",
    active: "\u0641\u0639\u0627\u0644",
    rewardReady: "\u067e\u0627\u062f\u0627\u0634 \u0622\u0645\u0627\u062f\u0647 \u0627\u0633\u062a",
    transferred: "\u0645\u0646\u062a\u0642\u0644 \u0634\u062f",
    paused: "\u0645\u0648\u0642\u062a\u0627\u064b \u0645\u062a\u0648\u0642\u0641",
    invalid: "\u062f\u06cc\u06af\u0631 \u0645\u0639\u062a\u0628\u0631 \u0646\u06cc\u0633\u062a",
    nextReward: "\u067e\u0627\u062f\u0627\u0634 \u0628\u0639\u062f\u06cc",
  },
  ur: {
    stamps: "\u0645\u06c1\u0631\u06cc\u06ba",
    member: "\u0631\u06a9\u0646",
    status: "\u062d\u0627\u0644\u062a",
    reward: "\u0627\u0646\u0639\u0627\u0645",
    program: "\u067e\u0631\u0648\u06af\u0631\u0627\u0645",
    security: "\u0633\u06cc\u06a9\u06cc\u0648\u0631\u0679\u06cc",
    active: "\u0641\u0639\u0627\u0644",
    rewardReady: "\u0627\u0646\u0639\u0627\u0645 \u062a\u06cc\u0627\u0631 \u06c1\u06d2",
    transferred: "\u0645\u0646\u062a\u0642\u0644 \u06a9\u06cc\u0627 \u06af\u06cc\u0627",
    paused:
      "\u0639\u0627\u0631\u0636\u06cc \u0637\u0648\u0631 \u067e\u0631 \u0631\u06a9\u0627 \u06c1\u0648\u0627",
    invalid: "\u0627\u0628 \u0645\u0624\u062b\u0631 \u0646\u06c1\u06cc\u06ba",
    nextReward: "\u0627\u06af\u0644\u0627 \u0627\u0646\u0639\u0627\u0645",
  },
  ps: {
    stamps: "\u067c\u0627\u067e\u06d0",
    member: "\u063a\u0693\u06d3",
    status: "\u062d\u0627\u0644\u062a",
    reward: "\u0627\u0646\u0639\u0627\u0645",
    program: "\u067e\u0631\u0648\u06ab\u0631\u0627\u0645",
    security: "\u0627\u0645\u0646\u06cc\u062a",
    active: "\u0641\u0639\u0627\u0644",
    rewardReady: "\u0627\u0646\u0639\u0627\u0645 \u0686\u0645\u062a\u0648 \u062f\u06cc",
    transferred: "\u0644\u06d0\u0696\u062f\u0648\u0644 \u0634\u0648",
    paused: "\u0645\u0648\u0642\u062a\u064a \u062f\u0631\u06d0\u062f\u0644\u06cc",
    invalid: "\u0646\u0648\u0631 \u0645\u0639\u062a\u0628\u0631 \u0646\u0647 \u062f\u06cc",
    nextReward: "\u0631\u0627\u062a\u0644\u0648\u0646\u06a9\u06cc \u0627\u0646\u0639\u0627\u0645",
  },
  he: {
    stamps: "\u05d7\u05d5\u05ea\u05de\u05d5\u05ea",
    member: "\u05d7\u05d1\u05e8",
    status: "\u05e1\u05d8\u05d8\u05d5\u05e1",
    reward: "\u05d4\u05d8\u05d1\u05d4",
    program: "\u05ea\u05d5\u05db\u05e0\u05d9\u05ea",
    security: "\u05d0\u05d1\u05d8\u05d7\u05d4",
    active: "\u05e4\u05e2\u05d9\u05dc",
    rewardReady: "\u05d4\u05d4\u05d8\u05d1\u05d4 \u05de\u05d5\u05db\u05e0\u05d4",
    transferred: "\u05d4\u05d5\u05e2\u05d1\u05e8",
    paused: "\u05de\u05d5\u05e9\u05d4\u05d4 \u05d6\u05de\u05e0\u05d9\u05ea",
    invalid: "\u05db\u05d1\u05e8 \u05dc\u05d0 \u05d1\u05ea\u05d5\u05e7\u05e3",
    nextReward: "\u05d4\u05d4\u05d8\u05d1\u05d4 \u05d4\u05d1\u05d0\u05d4",
  },
});

/** Structural Wallet labels follow the canonical presentation; untranslated locales use the English fallback. */
export function walletStructuralCopyForLocale(value: string): WalletStructuralCopy {
  const presentation = cardLocalePresentation(value);
  return walletStructuralCopies[presentation.locale] ?? englishWalletStructuralCopy;
}

const walletNearbyCopy: Readonly<
  Record<string, { readonly message: string; readonly business: string }>
> = {
  ar: {
    message:
      "\u0623\u0646\u062a \u0628\u0627\u0644\u0642\u0631\u0628 \u0645\u0646 {merchant}. \u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u0648\u0644\u0627\u0621 \u062c\u0627\u0647\u0632\u0629 \u0644\u0632\u064a\u0627\u0631\u062a\u0643 \u0627\u0644\u0642\u0627\u062f\u0645\u0629.",
    business: "\u0647\u0630\u0627 \u0627\u0644\u0646\u0634\u0627\u0637",
  },
  ckb: {
    message:
      "\u062a\u06c6 \u0644\u06d5 \u0646\u0632\u06cc\u06a9 {merchant}\u06cc\u062a. \u06a9\u0627\u0631\u062a\u06cc \u0648\u06d5\u0641\u0627\u062f\u0627\u0631\u06cc\u062a \u0628\u06c6 \u0633\u06d5\u0631\u062f\u0627\u0646\u06ce\u06a9\u06cc \u062f\u0627\u0647\u0627\u062a\u0648\u0648\u062a \u0622\u0645\u0627\u062f\u06d5\u06cc\u06d5.",
    business: "\u0626\u06d5\u0645 \u0628\u0627\u0632\u0631\u06af\u0627\u0646\u06cc\u06cc\u06d5",
  },
  "ku-Arab-IQ": {
    message:
      "\u062a\u0648 \u0644\u06d5 \u0646\u0632\u06cc\u06a9 {merchant}\u06cc. \u06a9\u0627\u0631\u062a\u06ce \u0648\u06d5\u0641\u0627\u062f\u0627\u0631\u06cc\u062a\u06ce \u0628\u06c6 \u0633\u06d5\u0631\u062f\u0627\u0646\u0627 \u062f\u0627\u0647\u0627\u062a\u0648\u0648 \u0622\u0645\u0627\u062f\u06d5\u06cc\u06d5.",
    business: "\u0626\u06d5\u0645 \u0628\u0627\u0632\u0631\u06af\u0627\u0646\u06cc\u06cc\u06d5",
  },
  fa: {
    message:
      "\u0634\u0645\u0627 \u0646\u0632\u062f\u06cc\u06a9 {merchant} \u0647\u0633\u062a\u06cc\u062f. \u06a9\u0627\u0631\u062a \u0648\u0641\u0627\u062f\u0627\u0631\u06cc \u0634\u0645\u0627 \u0628\u0631\u0627\u06cc \u0628\u0627\u0632\u062f\u06cc\u062f \u0628\u0639\u062f\u06cc \u0622\u0645\u0627\u062f\u0647 \u0627\u0633\u062a.",
    business: "\u0627\u06cc\u0646 \u06a9\u0633\u0628\u200c\u0648\u06a9\u0627\u0631",
  },
  ur: {
    message:
      "\u0622\u067e {merchant} \u06a9\u06d2 \u0642\u0631\u06cc\u0628 \u06c1\u06cc\u06ba\u06d4 \u0622\u067e \u06a9\u0627 \u0648\u0641\u0627\u062f\u0627\u0631\u06cc \u06a9\u0627\u0631\u0688 \u0627\u06af\u0644\u06d2 \u062f\u0648\u0631\u06d2 \u06a9\u06d2 \u0644\u06cc\u06d2 \u0622\u0645\u0627\u062f\u06c1 \u06c1\u06d2\u06d4",
    business: "\u06cc\u06c1 \u06a9\u0627\u0631\u0648\u0628\u0627\u0631",
  },
  ps: {
    message:
      "\u062a\u0627\u0633\u0648 \u062f {merchant} \u067e\u0647 \u0646\u0696\u062f\u06d0 \u06cc\u0627\u0633\u062a. \u062f \u0648\u0641\u0627\u062f\u0627\u0631\u06cd \u06a9\u0627\u0631\u067c \u0645\u0648 \u062f \u0631\u0627\u062a\u0644\u0648\u0646\u06a9\u064a \u0644\u06cc\u062f\u0646\u06d0 \u0644\u067e\u0627\u0631\u0647 \u0686\u0645\u062a\u0648 \u062f\u06cc.",
    business: "\u062f\u0627 \u0633\u0648\u062f\u0627\u06ab\u0631\u064a",
  },
  he: {
    message:
      "\u05d0\u05ea\u05dd \u05dc\u05d9\u05d3 {merchant}. \u05db\u05e8\u05d8\u05d9\u05e1 \u05d4\u05e0\u05d0\u05de\u05e0\u05d5\u05ea \u05e9\u05dc\u05db\u05dd \u05de\u05d5\u05db\u05df \u05dc\u05d1\u05d9\u05e7\u05d5\u05e8 \u05d4\u05d1\u05d0.",
    business: "\u05d4\u05e2\u05e1\u05e7 \u05d4\u05d6\u05d4",
  },
};

export function walletNearbyCopyForLocale(value: string): {
  readonly message: string;
  readonly business: string;
} {
  const locale = cardLocalePresentation(value).locale;
  return (
    walletNearbyCopy[locale] ?? {
      message: "You\u2019re near {merchant}. Your loyalty card is ready for your next visit.",
      business: "this business",
    }
  );
}

/**
 * Nearby wording is provider text, but it still derives locale from the same
 * canonical Wallet presentation contract. `vertical` remains a content cue;
 * it must never be used to infer writing direction.
 */
export function walletNearbyMessageForLocale(value: string, vertical: string): string {
  const locale = cardLocalePresentation(value).locale;
  const verticalOverrides: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    en: {
      COFFEE: "You\u2019re near {merchant}. Your loyalty card is ready for your next coffee visit.",
      BARBER: "You\u2019re near {merchant}. Your loyalty card is ready when you are.",
      BAKERY: "You\u2019re near {merchant}. Your loyalty card is ready for your next bakery visit.",
      GYM: "You\u2019re near {merchant}. Your membership card is ready for your next check-in.",
    },
    ar: {
      GYM: "\u0623\u0646\u062a \u0628\u0627\u0644\u0642\u0631\u0628 \u0645\u0646 {merchant}. \u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u0639\u0636\u0648\u064a\u0629 \u062c\u0627\u0647\u0632\u0629 \u0644\u0632\u064a\u0627\u0631\u062a\u0643 \u0627\u0644\u0642\u0627\u062f\u0645\u0629.",
    },
  };
  return verticalOverrides[locale]?.[vertical] ?? walletNearbyCopyForLocale(locale).message;
}

export function walletOpenLinkCopyForLocale(value: string): string {
  const locale = cardLocalePresentation(value).locale;
  return (
    {
      ar: "\u0641\u062a\u062d \u0627\u0644\u0631\u0627\u0628\u0637",
      ckb: "\u06a9\u0631\u062f\u0646\u06d5\u0648\u06d5\u06cc \u0628\u06d5\u0633\u062a\u06d5\u0631",
      "ku-Arab-IQ": "\u06a9\u0631\u0646\u0627 \u0628\u06d5\u0633\u062a\u06d5\u0631\u06cc",
      fa: "\u0628\u0627\u0632 \u06a9\u0631\u062f\u0646 \u067e\u06cc\u0648\u0646\u062f",
      ur: "\u0644\u0646\u06a9 \u06a9\u06be\u0648\u0644\u06cc\u06ba",
      ps: "\u0644\u06cc\u0646\u06a9 \u067e\u0631\u0627\u0646\u06cc\u0632\u0626",
      he: "\u05e4\u05ea\u05d7 \u05e7\u05d9\u05e9\u05d5\u05e8",
    }[locale] ?? "Open link"
  );
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
