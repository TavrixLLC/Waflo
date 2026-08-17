import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  merchantProgramLifecycleLabel,
  merchantProgramStatus,
} from "../../apps/merchant-dashboard/components/loyalty-card-presentation.js";
import { planCatalog } from "../../packages/billing/src/index.js";
import { programOperationalStatuses } from "../../packages/contracts/src/index.js";

describe("merchant loyalty-card presentation boundary", () => {
  it("maps every Program status to readable English without changing the enum", () => {
    expect(programOperationalStatuses).toEqual([
      "DRAFT",
      "VALIDATED",
      "TEST",
      "SCHEDULED",
      "PUBLISHED",
      "PAUSED",
      "ARCHIVED",
      "SUSPENDED",
    ]);
    expect(
      programOperationalStatuses.map((status) => merchantProgramStatus(status, "en").label),
    ).toEqual([
      "Draft",
      "Ready to publish",
      "Ready to publish",
      "Scheduled",
      "Live",
      "Paused",
      "Archived",
      "Suspended",
    ]);
  });

  it("provides complete Arabic labels and keeps suspension distinct from pause", () => {
    expect(
      programOperationalStatuses.map((status) => merchantProgramStatus(status, "ar").label),
    ).toEqual([
      "مسودة",
      "جاهزة للنشر",
      "جاهزة للنشر",
      "مجدولة",
      "مباشرة",
      "متوقفة مؤقتًا",
      "مؤرشفة",
      "موقوفة",
    ]);
    expect(merchantProgramStatus("SUSPENDED", "en")).toEqual({
      label: "Suspended",
      tone: "danger",
    });
    expect(merchantProgramStatus("SUSPENDED", "en")).not.toEqual(
      merchantProgramStatus("PAUSED", "en"),
    );
  });

  it("uses the existing plan catalog as the card-capacity source", () => {
    expect(planCatalog.starter.limits.programs).toBe(1);
    expect(planCatalog.growth.limits.programs).toBeNull();
    expect(planCatalog.scale.limits.programs).toBeNull();
  });

  it("centralizes merchant-safe lifecycle labels in both locales", () => {
    expect(merchantProgramLifecycleLabel("pause", "en")).toBe("Pause card");
    expect(merchantProgramLifecycleLabel("resume", "en")).toBe("Resume card");
    expect(merchantProgramLifecycleLabel("archive", "ar")).toBe("أرشفة البطاقة");
    expect(merchantProgramLifecycleLabel("restore", "ar")).toBe("استعادة البطاقة");
  });

  it("keeps the Programs route and API lifecycle boundary unchanged", () => {
    const dashboardSource = readFileSync(
      "apps/merchant-dashboard/components/dashboard.tsx",
      "utf8",
    );
    const listSource = readFileSync(
      "apps/merchant-dashboard/components/programs-screen.tsx",
      "utf8",
    );
    const studioSource = readFileSync(
      "apps/merchant-dashboard/components/program-studio-editor.tsx",
      "utf8",
    );

    expect(dashboardSource).toContain('programs: "Loyalty Cards"');
    expect(listSource).toContain(`/v1/organizations/\${organizationId}/programs?limit=20`);
    expect(listSource).toContain(
      `/v1/organizations/\${organizationId}/programs/\${lifecycleConfirmation.programId}/\${lifecycleConfirmation.action}`,
    );
    expect(studioSource).toContain(
      `/v1/organizations/\${organizationId}/programs/\${programId}/\${action}`,
    );
    expect(`${listSource}\n${studioSource}`).not.toContain("/v1/loyalty-cards");
  });
});
