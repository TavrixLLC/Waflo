import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatCurrencyMinor } from "../../packages/billing/src/index.js";
import { interfaceLocales, localeRegistry } from "../../packages/i18n/src/index.js";
import { marketingCopy } from "../../apps/marketing-web/lib/marketing-copy.js";
import { marketingDocuments } from "../../apps/marketing-web/lib/marketing-documents.js";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, shape(child)]),
    );
  }
  return typeof value;
}

const marketingPricing = source("apps/marketing-web/components/pricing-explorer.tsx");
const marketingPricingPage = source("apps/marketing-web/app/[locale]/pricing/page.tsx");
const marketingShell = source("apps/marketing-web/components/marketing-shell.tsx");
const marketingStyles = source("apps/marketing-web/app/globals.css");
const onboarding = source("apps/merchant-dashboard/components/onboarding.tsx");
const onboardingStyles = source("apps/merchant-dashboard/app/globals.css");

describe("Marketing locale closure", () => {
  it("keeps every declared Marketing locale structurally complete against English", () => {
    const expected = shape(marketingCopy.en);
    for (const locale of interfaceLocales) {
      expect(shape(marketingCopy[locale.id])).toEqual(expected);
    }
  });

  it("keeps public Marketing documents complete for every supported locale", () => {
    const expected = shape(marketingDocuments.en);
    for (const locale of interfaceLocales) {
      expect(shape(marketingDocuments[locale.id])).toEqual(expected);
    }
  });

  it("uses Kurdish Sorani copy and RTL presentation instead of an English or Arabic shortcut", () => {
    const ckb = marketingCopy["ku-sorani"];
    expect(localeRegistry["ku-sorani"]).toMatchObject({
      htmlLang: "ckb-Arab-IQ",
      direction: "rtl",
    });
    expect(ckb.pricing.title).toMatch(/[\u0600-\u06ff]/u);
    expect(ckb.pricing.title).not.toBe(marketingCopy.en.pricing.title);
    expect(ckb.pricing.title).not.toBe(marketingCopy.ar.pricing.title);
    expect(marketingPricing).not.toContain('locale === "ar"');
    expect(marketingPricingPage).toContain("isInterfaceLocale(locale)");
    expect(marketingShell).not.toContain('locale === "en" || locale === "ar"');
  });
});

describe("Pricing layout and bidi contracts", () => {
  it("uses a non-wrapping three-column cadence grid with token-based selected contrast", () => {
    const selector = marketingStyles;
    expect(selector).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(selector).toContain("--marketing-cadence-foreground: var(--waflo-white)");
    expect(selector).toContain("label:focus-within");
  });

  it("keeps calculated discounts and isolates dynamic RTL price tokens", () => {
    expect(marketingPricing).toContain("publishedCadenceDiscountPercent");
    expect(marketingPricing).not.toMatch(/(?:7\.48|16\.66|8\.33|16\.67)%/u);
    expect(marketingPricing).toContain('<bdi dir="ltr">{localizedAmount(term)}</bdi>');
    expect(marketingPricing).toContain('<bdi dir="ltr">{discount}</bdi>');
  });

  it.each([
    ["en-US", "USD", "$"],
    ["ar-IQ-u-nu-latn", "USD", "$"],
    ["ckb-IQ-u-nu-latn", "USD", "$"],
    ["en-US", "TRY", "₺"],
    ["ar-IQ-u-nu-latn", "TRY", "₺"],
    ["ckb-IQ-u-nu-latn", "TRY", "₺"],
    ["en-US", "SAR", "⃁"],
    ["ar-IQ-u-nu-latn", "SAR", "⃁"],
    ["ckb-IQ-u-nu-latn", "SAR", "⃁"],
  ])("formats %s %s with primary symbol %s", (locale, currency, symbol) => {
    const formatted = formatCurrencyMinor(2_900n, currency, locale);
    expect(formatted).toContain(symbol);
    expect(formatted).not.toContain("US$");
    expect(formatted).not.toContain("$US");
    expect(formatted).not.toMatch(/\b(?:USD|TRY|SAR)\b/u);
  });
});

describe("Account setup plan layout", () => {
  it("uses registry-driven number formatting and never reintroduces an Arabic-only layout branch", () => {
    const planStep = onboarding.slice(
      onboarding.indexOf("function PlanStep"),
      onboarding.indexOf("function SecurePaymentForm"),
    );
    expect(onboarding).toContain("localeRegistry[locale].numberFormattingLocale");
    expect(planStep).not.toContain('locale === "ar"');
    expect(planStep).toContain("localeRegistry[locale].numberFormattingLocale");
    expect(planStep).toContain('<bdi dir="ltr">');
  });

  it("stacks cards at phone widths, preserves a three-column cadence control, and has no carousel contract", () => {
    expect(onboardingStyles).toContain(".onboarding-plan-step");
    const mobileOnboarding = onboardingStyles.slice(
      onboardingStyles.indexOf("@media (max-width: 620px)"),
      onboardingStyles.indexOf(
        ".dashboard-topbar",
        onboardingStyles.indexOf("@media (max-width: 620px)"),
      ),
    );
    expect(mobileOnboarding).not.toContain("grid-auto-flow: column");
    expect(mobileOnboarding).not.toContain("scroll-snap-type");
    const stackingRule = onboardingStyles.slice(
      onboardingStyles.indexOf("@media (max-width: 47.5rem)"),
      onboardingStyles.indexOf("@media (max-width: 25rem)"),
    );
    expect(stackingRule).toContain(".onboarding-plan-grid");
    expect(stackingRule).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(onboardingStyles).toMatch(
      /\.onboarding-cadence\s*\{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/u,
    );
    expect(onboardingStyles).toContain(".onboarding-actions .wf-button");
  });
});
