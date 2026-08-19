import type { Locale } from "@waflo/contracts";
import { ar } from "./locales/ar.js";
import { en, type InterfaceMessages } from "./locales/en.js";
import { kuBadini } from "./locales/ku-badini.js";
import { kuSorani } from "./locales/ku-sorani.js";

export type TextDirection = "ltr" | "rtl";
export type InterfaceLocale = "en" | "ar" | "ku-badini" | "ku-sorani";
export type InterfaceLanguageGroup = "kurdish";

/**
 * Presentation metadata for grouped language choices. Keeping this alongside
 * locale metadata prevents applications from inventing a generic Kurdish
 * locale or duplicating labels for its two distinct interface locales.
 */
export const interfaceLanguageGroups: Readonly<
  Record<InterfaceLanguageGroup, { readonly englishName: string; readonly nativeName: string }>
> = {
  kurdish: {
    englishName: "Kurdish",
    nativeName: "کوردی",
  },
};

export interface InterfaceLocaleDefinition {
  readonly id: InterfaceLocale;
  readonly route: InterfaceLocale;
  readonly nativeName: string;
  readonly englishName?: string;
  readonly htmlLang: string;
  readonly direction: TextDirection;
  readonly languageGroup?: InterfaceLanguageGroup;
  readonly enabled: true;
  /** Fallback for customer-authored and Wallet content constrained to the existing API locale union. */
  readonly contentFallback: Locale;
  /** Transitional text catalog for legacy UI components while they move to locale messages directly. */
  readonly interfaceTextLocale: Locale;
  readonly dateFormattingLocale: string;
  readonly numberFormattingLocale: string;
  readonly messages: InterfaceMessages;
}

export const localeRegistry: Readonly<Record<InterfaceLocale, InterfaceLocaleDefinition>> = {
  en: {
    id: "en",
    route: "en",
    nativeName: "English",
    htmlLang: "en",
    direction: "ltr",
    enabled: true,
    contentFallback: "en",
    interfaceTextLocale: "en",
    dateFormattingLocale: "en-US-u-nu-latn",
    numberFormattingLocale: "en-US-u-nu-latn",
    messages: en,
  },
  ar: {
    id: "ar",
    route: "ar",
    nativeName: "العربية",
    englishName: "Arabic",
    htmlLang: "ar",
    direction: "rtl",
    enabled: true,
    contentFallback: "en",
    interfaceTextLocale: "ar",
    dateFormattingLocale: "ar-IQ-u-nu-latn",
    numberFormattingLocale: "ar-IQ-u-nu-latn",
    messages: ar,
  },
  "ku-badini": {
    id: "ku-badini",
    route: "ku-badini",
    nativeName: "کوردی بادینی",
    englishName: "Kurdish Badini",
    htmlLang: "kmr-Arab-IQ",
    direction: "rtl",
    languageGroup: "kurdish",
    enabled: true,
    contentFallback: "en",
    interfaceTextLocale: "en",
    dateFormattingLocale: "ckb-IQ-u-nu-latn",
    numberFormattingLocale: "ckb-IQ-u-nu-latn",
    messages: kuBadini,
  },
  "ku-sorani": {
    id: "ku-sorani",
    route: "ku-sorani",
    nativeName: "کوردی سۆرانی",
    englishName: "Kurdish Sorani",
    htmlLang: "ckb-Arab-IQ",
    direction: "rtl",
    languageGroup: "kurdish",
    enabled: true,
    contentFallback: "en",
    interfaceTextLocale: "en",
    dateFormattingLocale: "ckb-IQ-u-nu-latn",
    numberFormattingLocale: "ckb-IQ-u-nu-latn",
    messages: kuSorani,
  },
};

export const interfaceLocales = Object.freeze(
  Object.values(localeRegistry).filter((locale) => locale.enabled),
) as readonly InterfaceLocaleDefinition[];

export function isInterfaceLocale(value: string): value is InterfaceLocale {
  return Object.hasOwn(localeRegistry, value);
}

export function interfaceLocaleFor(value: string): InterfaceLocaleDefinition | undefined {
  return isInterfaceLocale(value) ? localeRegistry[value] : undefined;
}

export function directionForInterface(locale: InterfaceLocale): TextDirection {
  return localeRegistry[locale].direction;
}

/**
 * The dashboard still has a small two-language component copy surface. This
 * resolves that surface without changing the customer-content fallback.
 */
export function interfaceTextLocaleFor(locale: InterfaceLocale): Locale {
  return localeRegistry[locale].interfaceTextLocale;
}

export function interfaceLocalePath(locale: InterfaceLocale, path = ""): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${normalizedPath === "/" ? "" : normalizedPath}`;
}

/**
 * Customer-authored, Wallet, and mobile locale fields still intentionally use
 * the two-value API contract. Dashboard interface locale must not widen it.
 */
export function contentLocaleForInterface(locale: InterfaceLocale): Locale {
  return localeRegistry[locale].contentFallback;
}
