import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("onboarding payment resume regressions", () => {
  const onboarding = source("apps/merchant-dashboard/components/onboarding.tsx");

  it("hydrates canonical billing data before recovering a Checkout Session without sessionStorage", () => {
    expect(onboarding).toContain("interface BillingReadModel");
    expect(onboarding).toContain("billingIdentityFromServer(model)");
    expect(onboarding).toContain("/billing`");
    expect(onboarding).toContain("await loadBillingIdentity(currentOrganizationId)");
    expect(onboarding).not.toContain("draft.billingIdentity && (draft.step ?? 2) >= 4");
    expect(onboarding).not.toContain("loading || !setup || !billingIdentity || !stripePromise");
    expect(onboarding).toContain("<CheckoutElementsProvider");
    expect(onboarding).toContain('<PaymentElement options={{ layout: "tabs" }} />');
  });

  it("exposes bounded, retryable Stripe and Checkout Elements initialization states", () => {
    expect(onboarding).toContain('setStripeScriptState("error")');
    expect(onboarding).toContain("copy.payment.stripeLoadFailed");
    expect(onboarding).toContain('checkoutState.type === "error"');
    expect(onboarding).toContain("copy.payment.providerInitializationFailed");
    expect(onboarding).toContain("onRetry={() => {");
    expect(onboarding).toContain("onboarding-payment-diagnostics");
    expect(onboarding).not.toContain("clientSecret}</dd>");
    expect(onboarding).not.toContain("publishableKey}</dd>");
  });
});

describe("merchant logo upload regressions", () => {
  const uploader = source("apps/merchant-dashboard/components/program-asset-uploader.tsx");
  const css = source("apps/merchant-dashboard/app/globals.css");
  const app = source("apps/api/src/app.ts");
  const assets = source("apps/api/src/programs/assets.service.ts");

  it("keeps Wallet logo crop selection square in source pixels and labels source dimensions", () => {
    expect(uploader).toContain(
      'if (category === "LOGO") return squareCropForZoom(current, nextZoom, naturalSize);',
    );
    expect(uploader).toContain(
      "const side = Math.min(naturalSize.width, naturalSize.height) / zoom;",
    );
    expect(uploader).toContain("width: side / naturalSize.width");
    expect(uploader).toContain("height: side / naturalSize.height");
    expect(uploader).toContain("copy.sourceDimensions");
    expect(uploader).toContain("naturalSize.width * crop.width");
    expect(uploader).toContain("naturalSize.height * crop.height");
    expect(css).toContain(".studio-crop-preview--logo");
    expect(css).toContain(".studio-crop-dialog .wf-dialog__body");
    expect(css).toContain("overflow-x: clip");
    expect(css).not.toContain(".studio-crop-preview img {\n  object-fit: fill;");
  });

  it("permits only the onboarding branding upload and selection path before activation", () => {
    const organizations = source("apps/api/src/organizations/organizations.service.ts");
    const tenant = source("apps/api/src/tenancy/tenant.service.ts");

    expect(assets).toContain('metadata.category === "LOGO"');
    expect(assets).toContain("requireOnboardingBrandingMembership(");
    expect(assets).toContain('"programs.edit"');
    expect(organizations).toContain("const brandingOnly =");
    expect(organizations).toContain(
      'requireOnboardingBrandingMembership(\n        userId,\n        organizationId,\n        "organization.manage",',
    );
    expect(tenant).toContain('account?.access === "onboarding_only" || account?.access === "full"');
    expect(tenant).toContain('"BILLING_ACTION_REQUIRED"');
  });

  it("aligns the transport limit with the advertised two MiB image maximum and maps storage failures", () => {
    expect(app).toContain("bodyLimit: MAX_ASSET_FILE_BYTES + MAX_ASSET_MULTIPART_OVERHEAD_BYTES");
    expect(app).toContain("fileSize: MAX_ASSET_FILE_BYTES");
    expect(assets).toContain('"ASSET_STORAGE_UNAVAILABLE"');
    expect(assets).toContain("HttpStatus.SERVICE_UNAVAILABLE");
  });
});
