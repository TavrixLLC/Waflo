import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canPersistCatalogSelection } from "../../apps/merchant-dashboard/components/billing-presentation.js";

describe("billing price presentation", () => {
  it("keeps active subscriptions in catalog-preview mode", () => {
    expect(canPersistCatalogSelection("PENDING_ACTIVATION")).toBe(true);
    expect(canPersistCatalogSelection("TRIALING")).toBe(false);
    expect(canPersistCatalogSelection("ACTIVE")).toBe(false);
    expect(canPersistCatalogSelection("PAST_DUE")).toBe(false);
  });

  it("keeps a failed Arabic billing read localized, retryable, and distinct from loading", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/merchant-dashboard/components/dashboard-screens.tsx"),
      "utf8",
    );

    expect(source).toContain(
      'caught instanceof ApiClientError && caught.code === "INTERNAL_ERROR"',
    );
    expect(source).toContain('ar ? "تعذر تحميل الفوترة." : "Unable to load billing."');
    expect(source).toContain('className="billing-load-error"');
    expect(source).toContain("onClick={() => void load()}");
    expect(source).toContain(
      ') : loading ? (\n        <Skeleton height="20rem" />\n      ) : null}',
    );
  });
});
