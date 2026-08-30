import { describe, expect, it } from "vitest";
import { canPersistCatalogSelection } from "../../apps/merchant-dashboard/components/billing-presentation.js";

describe("billing price presentation", () => {
  it("keeps active subscriptions in catalog-preview mode", () => {
    expect(canPersistCatalogSelection("PENDING_ACTIVATION")).toBe(true);
    expect(canPersistCatalogSelection("TRIALING")).toBe(false);
    expect(canPersistCatalogSelection("ACTIVE")).toBe(false);
    expect(canPersistCatalogSelection("PAST_DUE")).toBe(false);
  });
});
