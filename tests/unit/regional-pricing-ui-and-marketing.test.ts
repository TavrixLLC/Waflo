import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { publishedCadenceDiscountPercent } from "../../packages/billing/src/index.js";

const onboarding = readFileSync(
  resolve(process.cwd(), "apps/merchant-dashboard/components/onboarding.tsx"),
  "utf8",
);
const marketingPage = readFileSync(
  resolve(process.cwd(), "apps/marketing-web/app/[locale]/pricing/page.tsx"),
  "utf8",
);
const marketingConfig = readFileSync(
  resolve(process.cwd(), "apps/marketing-web/next.config.ts"),
  "utf8",
);
const publicController = readFileSync(
  resolve(process.cwd(), "apps/api/src/public/public.controller.ts"),
  "utf8",
);
const adminPricing = readFileSync(
  resolve(process.cwd(), "apps/admin-dashboard/components/admin-pricing-dashboard.tsx"),
  "utf8",
);

describe("regional pricing presentation and trusted marketing reads", () => {
  it("keeps market codes out of cadence controls and uses the shared formatter", () => {
    const planSection = onboarding.slice(
      onboarding.indexOf("function PlanStep"),
      onboarding.indexOf("function SecurePaymentForm"),
    );
    expect(planSection).toContain("formatCurrencyMinor");
    expect(planSection).not.toContain("marketCode");
    expect(planSection).not.toContain("currency.toUpperCase()");
    expect(planSection).not.toContain("cadencePrice(");
    expect(onboarding).toContain(
      "copy.onboarding.progress.billing,\n    copy.onboarding.progress.plan",
    );
  });

  it("calculates discounts from same-market same-currency terms only", () => {
    const monthly = {
      plan: "starter" as const,
      cadence: "monthly" as const,
      amountMinor: "109900",
      currency: "TRY",
    };
    const quarterly = {
      plan: "starter" as const,
      cadence: "quarterly" as const,
      amountMinor: "299700",
      currency: "TRY",
    };
    expect(publishedCadenceDiscountPercent(monthly, quarterly)).toBe("9.09%");
    expect(publishedCadenceDiscountPercent(monthly, { ...quarterly, currency: "USD" })).toBeNull();
    expect(publishedCadenceDiscountPercent(monthly, { ...quarterly, plan: "growth" })).toBeNull();
  });

  it("renders pricing dynamically, forwards only the edge country signal, and disables response caching", () => {
    expect(marketingPage).toContain('dynamic = "force-dynamic"');
    expect(marketingPage).toContain("trustedCloudflareCountry(await headers())");
    expect(marketingConfig).toContain("private, no-store, max-age=0");
    expect(publicController).toContain('@Headers("cf-ipcountry")');
    expect(publicController).toContain("normalizeCloudflareCountry(edgeCountry)");
    expect(publicController).not.toContain('@Query("country")');
  });

  it("uses the canonical searchable currency dropdown in Admin", () => {
    expect(adminPricing).toContain("pricingCurrencyOptions()");
    expect(adminPricing).toContain("<SearchableSelect");
    expect(adminPricing).not.toMatch(/name=["']currency["'][\s\S]{0,200}type=["']text/u);
  });
});
