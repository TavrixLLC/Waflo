import { describe, expect, it } from "vitest";
import {
  cardLocaleMetadata,
  cardLocaleRegistry,
  canonicalizeCardLocale,
  changeDefaultCardLocale,
  directionForCardLocale,
  disableCardLocale,
  enableCardLocale,
  fontStackForCardLocale,
  normalizeCardLocaleConfiguration,
  resolveCardLocale,
} from "../../packages/contracts/src/index.js";

describe("global card-content locale registry", () => {
  it("is a deterministic, canonical practical-world catalog", () => {
    const ids = cardLocaleRegistry.map((locale) => locale.id);
    expect(cardLocaleRegistry.length).toBeGreaterThanOrEqual(80);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.map((id) => Intl.getCanonicalLocales(id)[0])).toEqual(ids);
    expect(cardLocaleRegistry.map((locale) => locale.englishName)).toEqual(
      cardLocaleRegistry
        .map((locale) => locale.englishName)
        .toSorted((left, right) => left.localeCompare(right, "en", { sensitivity: "base" })),
    );
    for (const locale of cardLocaleRegistry) {
      expect(locale.englishName.trim()).not.toBe("");
      expect(locale.nativeName.trim()).not.toBe("");
      expect(["ltr", "rtl"]).toContain(locale.direction);
      expect(locale.script).toMatch(/^[A-Z][a-z]{3}$/u);
      expect(locale.providers).toEqual({
        customerWeb: "supported",
        appleWallet: "normalized",
        googleWallet: "limited",
      });
    }
  });

  it("covers representative scripts and intentional language variants", () => {
    for (const id of [
      "en",
      "ar",
      "ru",
      "el",
      "he",
      "hi",
      "ja",
      "ko",
      "zh-Hans",
      "zh-Hant",
      "pt-BR",
      "pt-PT",
      "ckb",
      "ku-Arab-IQ",
    ]) {
      expect(cardLocaleMetadata(id), id).not.toBeNull();
    }
    expect(directionForCardLocale("ar")).toBe("rtl");
    expect(directionForCardLocale("fa")).toBe("rtl");
    expect(directionForCardLocale("ur")).toBe("rtl");
    expect(directionForCardLocale("he")).toBe("rtl");
    expect(directionForCardLocale("ckb")).toBe("rtl");
    expect(directionForCardLocale("ku-Arab-IQ")).toBe("rtl");
    expect(directionForCardLocale("fr")).toBe("ltr");
  });

  it("uses script-aware card stacks without bundling a font per language", () => {
    expect(fontStackForCardLocale("fr")).toContain("--font-manrope");
    expect(fontStackForCardLocale("ar")).toContain("--font-cairo");
    expect(fontStackForCardLocale("ckb")).toContain("--font-kurdistan-24");
    expect(fontStackForCardLocale("ja")).toContain("Yu Gothic");
  });

  it("canonicalizes supported tags and rejects malformed or unregistered input", () => {
    expect(canonicalizeCardLocale("pt-br")).toBe("pt-BR");
    expect(canonicalizeCardLocale("zh-hant")).toBe("zh-Hant");
    expect(canonicalizeCardLocale("en_US")).toBeNull();
    expect(canonicalizeCardLocale("not a locale")).toBeNull();
    expect(normalizeCardLocaleConfiguration("en", ["en", "xx-ZZ"])).toBeNull();
    expect(normalizeCardLocaleConfiguration("en", ["en", "en"])).toBeNull();
    expect(normalizeCardLocaleConfiguration("en", [])).toBeNull();
    expect(normalizeCardLocaleConfiguration("fr", ["en", "ar"])).toBeNull();
  });
});

describe("card locale configuration and resolution", () => {
  const initial = { defaultLocale: "en", enabledLocales: ["en", "ar", "fr"] } as const;

  it("adds, disables, re-enables, and changes default without owning translation data", () => {
    const added = enableCardLocale(initial, "ja");
    expect(added?.enabledLocales).toEqual(["en", "ar", "fr", "ja"]);
    if (!added) throw new Error("Japanese locale should be enabled.");
    expect(enableCardLocale(added, "ja")).toEqual(added);
    expect(disableCardLocale(added, "en")).toBeNull();
    const disabled = disableCardLocale(added, "ar");
    expect(disabled?.enabledLocales).toEqual(["en", "fr", "ja"]);
    if (!disabled) throw new Error("Arabic locale should be disabled.");
    expect(enableCardLocale(disabled, "ar")?.enabledLocales).toEqual(["en", "fr", "ja", "ar"]);
    expect(changeDefaultCardLocale(initial, "fr")).toEqual({
      defaultLocale: "fr",
      enabledLocales: ["fr", "en", "ar"],
    });
    expect(changeDefaultCardLocale(initial, "de")).toBeNull();
  });

  it("matches exact, parent, and same-script variants before the card default", () => {
    expect(
      resolveCardLocale({
        ...initial,
        acceptedLanguages: "fr-CA,fr;q=0.9,en;q=0.8",
      }),
    ).toBe("fr");
    expect(resolveCardLocale({ ...initial, acceptedLanguages: "de-DE,de;q=0.9" })).toBe("en");
    expect(resolveCardLocale({ ...initial, explicitLocale: "ar", acceptedLanguages: "fr" })).toBe(
      "ar",
    );
    expect(
      resolveCardLocale({
        defaultLocale: "en",
        enabledLocales: ["en", "pt-PT"],
        acceptedLanguages: "pt-BR",
      }),
    ).toBe("en");
    expect(
      resolveCardLocale({
        defaultLocale: "en",
        enabledLocales: ["en", "zh-Hans"],
        acceptedLanguages: "zh-Hant",
      }),
    ).toBe("en");
  });
});
