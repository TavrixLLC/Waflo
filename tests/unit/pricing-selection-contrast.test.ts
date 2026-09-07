import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("pricing selection contrast", () => {
  const sharedPlans = source("packages/ui/src/styles.css");
  const dashboard = source("apps/merchant-dashboard/app/globals.css");
  const marketing = source("apps/marketing-web/app/globals.css");

  it("uses explicit foreground, muted, surface, and border tokens for selected shared plans", () => {
    const selected = sharedPlans.slice(
      sharedPlans.indexOf(".wf-plan-card--selected"),
      sharedPlans.indexOf(".wf-plan-card__heading"),
    );

    expect(selected).toContain("--wf-plan-card-foreground: var(--waflo-ink);");
    expect(selected).toContain("--wf-plan-card-muted:");
    expect(selected).toContain("--wf-plan-card-surface: #fff7f3;");
    expect(selected).toContain("--wf-plan-card-border: var(--waflo-brick);");
  });

  it("keeps cadence and plan copy readable in selected Dashboard and onboarding states", () => {
    expect(dashboard).toContain("--billing-cadence-foreground: var(--waflo-ink);");
    expect(dashboard).toContain("--billing-cadence-muted:");
    expect(dashboard).toContain("--onboarding-cadence-foreground: var(--waflo-ink);");
    expect(dashboard).toContain("--onboarding-plan-foreground: var(--waflo-ink);");
    expect(dashboard).toContain("--onboarding-plan-muted:");
  });

  it("keeps the active Marketing cadence's foreground and badge foreground explicit", () => {
    const selected = marketing.slice(
      marketing.lastIndexOf(
        ".marketing-cadence-selector .marketing-cadence-selector__option--active",
      ),
      marketing.indexOf(
        ".marketing-cadence-selector label:focus-within",
        marketing.lastIndexOf(
          ".marketing-cadence-selector .marketing-cadence-selector__option--active",
        ),
      ),
    );

    expect(selected).toContain("--marketing-cadence-foreground: var(--waflo-white);");
    expect(selected).toContain("--marketing-cadence-badge-foreground: var(--waflo-ink);");
    expect(selected).toContain("--marketing-cadence-badge-background: var(--waflo-coral);");
    expect(selected).toContain("color: var(--marketing-cadence-foreground) !important;");
    expect(selected).toContain("background: var(--waflo-ink) !important;");
  });
});
