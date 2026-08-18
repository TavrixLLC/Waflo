import type { Locale } from "@waflo/contracts";
export type { InterfaceMessages } from "./locales/en.js";
export {
  contentLocaleForInterface,
  directionForInterface,
  interfaceLocaleFor,
  interfaceLocalePath,
  interfaceLocales,
  isInterfaceLocale,
  localeRegistry,
  type InterfaceLocale,
  type InterfaceLocaleDefinition,
  type TextDirection,
} from "./locale-registry.js";
import { localeRegistry } from "./locale-registry.js";

/** Business-content locale guard retained for existing API contracts. */
export function isLocale(value: string): value is Locale {
  return value === "en" || value === "ar";
}

/** Direction is metadata-driven even for the legacy content-locale contract. */
export function directionFor(locale: Locale): "ltr" | "rtl" {
  return localeRegistry[locale].direction;
}

export function localePath(locale: Locale, path = ""): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${normalizedPath === "/" ? "" : normalizedPath}`;
}

export const messages = Object.freeze(
  Object.fromEntries(
    Object.entries(localeRegistry).map(([id, definition]) => [id, definition.messages]),
  ),
) as Readonly<Record<keyof typeof localeRegistry, (typeof localeRegistry)["en"]["messages"]>>;

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US-u-nu-latn", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(value: Date | string, locale: Locale): string {
  return new Intl.DateTimeFormat(localeRegistry[locale].dateFormattingLocale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
