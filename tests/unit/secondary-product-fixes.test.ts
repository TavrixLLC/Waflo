import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("secondary product corrections", () => {
  it("renders each loyalty-list thumbnail from its selected logo with an organization fallback", () => {
    const programs = source("apps/merchant-dashboard/components/programs-screen.tsx");
    const preview = source("apps/merchant-dashboard/components/loyalty-card-real-preview.tsx");
    const brandMark = source("apps/merchant-dashboard/components/merchant-brand-mark.tsx");
    expect(programs.match(/apiFetch<OrganizationPresentationView>/gu)).toHaveLength(1);
    expect(programs).toContain('brandLogoAsset: Pick<AssetItem, "contentUrl"> | null');
    expect(programs).toContain("const logoUrl = theme?.logoAssetId");
    expect(programs).toContain(": brandLogoUrl;");
    expect(programs).toContain("brandLogoUrl={logoUrl}");
    expect(preview).toContain("brandLogoUrl?: string | null | undefined");
    expect(preview).toContain("<MerchantBrandMark");
    expect(brandMark).toContain('credentials: "include"');
    expect(brandMark).toContain("privateImageCache");
  });

  it("offers organization branding without adding a required onboarding step", () => {
    const onboarding = source("apps/merchant-dashboard/components/onboarding.tsx");
    expect(onboarding).toContain('category="LOGO"');
    expect(onboarding).toContain("brandLogoAssetId: assetId");
    expect(onboarding).toContain("copy.logo.optional");
    expect(onboarding).toContain("copy.logo.skip");
    expect(onboarding).not.toMatch(/brandLogoAssetId[^\n]+required/u);
    expect(onboarding).toContain("writeWizard({ organizationId, plan, cadence, step: 3 })");
  });

  it("refreshes Overview from authoritative program state after in-app card creation", () => {
    const overview = source("apps/merchant-dashboard/components/dashboard-screens.tsx");
    const programs = source("apps/merchant-dashboard/components/programs-screen.tsx");
    expect(overview).toContain("deriveOverviewNextStep(programs)");
    expect(overview).toContain('window.addEventListener("waflo:programs-changed"');
    expect(programs).toContain('window.dispatchEvent(new Event("waflo:programs-changed"))');
  });
});
