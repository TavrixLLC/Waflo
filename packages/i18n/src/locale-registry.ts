import type { Locale } from "@waflo/contracts";
import { ar } from "./locales/ar.js";
import { en, type InterfaceMessages } from "./locales/en.js";
import { kuBadini } from "./locales/ku-badini.js";
import { kuSorani } from "./locales/ku-sorani.js";

export type TextDirection = "ltr" | "rtl";
export type InterfaceLocale = "en" | "ar" | "ku-badini" | "ku-sorani";

export interface InterfaceLocaleDefinition {
  readonly id: InterfaceLocale;
  readonly route: InterfaceLocale;
  readonly nativeName: string;
  readonly englishName?: string;
  readonly htmlLang: string;
  readonly direction: TextDirection;
  readonly languageGroup?: "kurdish";
  readonly enabled: true;
  readonly fallback: "en" | "ar";
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
    fallback: "en",
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
    fallback: "en",
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
    fallback: "en",
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
    fallback: "en",
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

export function interfaceLocalePath(locale: InterfaceLocale, path = ""): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${normalizedPath === "/" ? "" : normalizedPath}`;
}

/**
 * Customer-authored, Wallet, and mobile locale fields still intentionally use
 * the two-value API contract. Dashboard interface locale must not widen it.
 */
export function contentLocaleForInterface(locale: InterfaceLocale): Locale {
  return localeRegistry[locale].fallback;
}
