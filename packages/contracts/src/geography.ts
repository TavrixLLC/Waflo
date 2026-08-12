import countries from "i18n-iso-countries";
import arLocale from "i18n-iso-countries/langs/ar.json" with { type: "json" };
import enLocale from "i18n-iso-countries/langs/en.json" with { type: "json" };
import { z } from "zod";

countries.registerLocale(enLocale);
countries.registerLocale(arLocale);

/** ISO 3166-1 alpha-2 identifiers, sourced from i18n-iso-countries. */
export const countryCodes = Object.freeze(
  Object.keys(countries.getAlpha2Codes())
    // The library also exposes XK as a user-assigned Kosovo convenience code;
    // it is not an ISO 3166-1 assignment, so canonical storage stays at 249.
    .filter((code) => code !== "XK")
    .sort((left, right) => left.localeCompare(right)),
);

const countryCodeSet = new Set(countryCodes);

export function isCountryCode(value: string): boolean {
  return countryCodeSet.has(value.trim().toLocaleUpperCase("en-US"));
}

export const countryCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toLocaleUpperCase("en-US"))
  .refine(isCountryCode, { message: "Invalid ISO 3166-1 country code." });

export function countryOptions(locale: "en" | "ar") {
  const names = countries.getNames(locale, { select: "official" });
  const collator = new Intl.Collator(locale === "ar" ? "ar-IQ" : "en-US", {
    sensitivity: "base",
  });
  return countryCodes
    .map((code) => ({ code, name: names[code] ?? code }))
    .sort((left, right) => collator.compare(left.name, right.name));
}

function runtimeTimeZones(): readonly string[] {
  const supportedValuesOf = Intl.supportedValuesOf;
  const supported = supportedValuesOf ? supportedValuesOf("timeZone") : [];
  return Object.freeze(
    Array.from(new Set(["UTC", ...supported])).sort((left, right) => left.localeCompare(right)),
  );
}

/** Canonical IANA identifiers exposed by the current JavaScript runtime, plus UTC. */
export const timeZoneIds = runtimeTimeZones();
const timeZoneIdSet = new Set(timeZoneIds);

export function isCanonicalTimeZone(value: string): boolean {
  return timeZoneIdSet.has(value.trim());
}

export const canonicalTimeZoneSchema = z
  .string()
  .trim()
  .refine(isCanonicalTimeZone, { message: "Invalid canonical IANA timezone." });

export function timeZoneOptions(locale: "en" | "ar", at = new Date()) {
  const formatterLocale = locale === "ar" ? "ar-IQ" : "en-US";
  return timeZoneIds.map((id) => {
    const offset = new Intl.DateTimeFormat(formatterLocale, {
      timeZone: id,
      timeZoneName: "shortOffset",
    })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value;
    const city = id === "UTC" ? "UTC" : (id.split("/").at(-1)?.replaceAll("_", " ") ?? id);
    const group = id === "UTC" ? "UTC" : (id.split("/")[0] ?? "Other");
    return {
      id,
      group,
      label: offset ? `${city} (${offset})` : city,
    };
  });
}
