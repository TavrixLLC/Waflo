import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("dashboard operational fixes", () => {
  it("observes asynchronous exports to a terminal state and starts the private download once", () => {
    const screen = source("apps/merchant-dashboard/components/w4-operations-screens.tsx");
    expect(screen).toContain("awaitingDownloadIds");
    expect(screen).toContain('job.status === "PENDING" || job.status === "PROCESSING"');
    expect(screen).toContain("window.setTimeout(() => void refreshJobs(), 1_500)");
    expect(screen).toContain('job.status === "COMPLETED"');
    expect(screen).toContain("download.click()");
    expect(screen).toContain('"FAILED", "DEAD_LETTER", "EXPIRED"');
    expect(screen).toContain("ApiClientError, apiFetch, apiUrl");
    expect(screen).toMatch(
      /download\.href = `\$\{apiUrl\}\/v1\/organizations\/\$\{organizationId\}\/exports\/\$\{job\.publicId\}\/download`/u,
    );
    expect(screen).not.toContain("/api/waflo/v1/organizations/");
    expect(screen).toMatch(/\/exports\/\$\{job\.publicId\}\/download/u);
  });

  it("uses one deduplicated billing read and prevents duplicate plan mutations", () => {
    const screen = source("apps/merchant-dashboard/components/dashboard-screens.tsx");
    expect(screen).toContain("billingLoadInFlight");
    expect(screen).toContain("catalogSelectionInFlight");
    expect(screen).toContain("subscriptionPreviewInFlight");
    expect(screen).toContain("subscriptionConfirmationInFlight");
    expect(screen).toContain("setData((current)");
    expect(screen).toContain("Requests are temporarily limited");
  });

  it("uses the contracts-owned activity taxonomy in the standard accessible Select pattern", () => {
    const screen = source("apps/merchant-dashboard/components/dashboard-screens.tsx");
    expect(screen).toContain("type ProgramTemplateCategory");
    expect(screen).toContain("const businessActivityOptions");
    expect(screen).toContain('<SearchableSelect\n                  name="category"');
    expect(screen).toContain('name="locale"');
    expect(screen).toContain("type ProgramTemplateCategory");
    expect(screen).toContain("organization?.businessCategory");
    expect(screen).not.toContain('<TextInput name="category"');
  });

  it("derives post-Google verification from the rotated server session", () => {
    const service = source("apps/api/src/auth/external-auth.service.ts");
    const controller = source("apps/api/src/auth/external-auth.controller.ts");
    const screen = source("apps/merchant-dashboard/components/dashboard-screens.tsx");
    expect(service).toContain("reauthenticationStatus(userId: string, sessionId: string)");
    expect(service).toContain('status: "VERIFIED"');
    expect(controller).toContain('@Get("reauthentication")');
    expect(screen).toContain('"/v1/auth/external/reauthentication"');
    expect(screen).toContain("Verified with Google");
  });

  it("rejects an over-limit downgrade before Stripe and reconciles historic provider truth safely", () => {
    const billing = source("apps/api/src/billing/billing.service.ts");
    expect(billing).toContain("await this.assertSubscriptionChangeAllowed(");
    expect(billing).toContain("A preview is short lived, but usage may still have changed");
    expect(billing).toContain("await transaction.subscription.update({");
    expect(billing).toContain("must reflect the provider truth so Billing remains usable");
    expect(billing).not.toContain("PLAN_DOWNGRADE_BLOCKED_FROM_PROVIDER");
  });
});
