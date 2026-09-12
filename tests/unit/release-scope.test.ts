import { describe, expect, it } from "vitest";
import { classifyReleaseChanges, classifyReleaseRange } from "../../scripts/release-scope.mjs";

const scope = (files: string[]) => classifyReleaseChanges(files).scope;

describe("release scope classifier", () => {
  it.each([
    ["Marketing page", ["apps/marketing-web/app/[locale]/pricing/page.tsx"], "MARKETING"],
    ["Marketing localization", ["apps/marketing-web/lib/marketing-copy.ts"], "MARKETING"],
    ["Merchant CSS", ["apps/merchant-dashboard/app/globals.css"], "MERCHANT"],
    ["Merchant Stripe onboarding", ["apps/merchant-dashboard/components/onboarding.tsx"], "FULL"],
    ["isolated API", ["apps/api/src/programs/programs.service.ts"], "API"],
    ["billing", ["packages/billing/src/index.ts"], "FULL"],
    ["Prisma schema", ["packages/database/prisma/schema.prisma"], "FULL"],
    ["migration", ["packages/database/prisma/migrations/20260903000000_x/migration.sql"], "FULL"],
    ["lockfile", ["pnpm-lock.yaml"], "FULL"],
    ["workspace manifest", ["apps/marketing-web/package.json"], "FULL"],
    ["Turbo", ["turbo.json"], "FULL"],
    ["workflow", [".github/workflows/ci.yml"], "FULL"],
    ["Docker", ["deploy/vps/Dockerfile"], "FULL"],
    ["Wallet artwork", ["packages/wallet-artwork/src/index.ts"], "FULL"],
    ["shared contract", ["packages/contracts/src/index.ts"], "FULL"],
    ["unknown root file", ["notes.txt"], "FULL"],
    [
      "multiple products",
      ["apps/marketing-web/app/[locale]/page.tsx", "apps/merchant-dashboard/app/globals.css"],
      "FULL",
    ],
  ])("classifies %s conservatively", (_scenario, files, expected) => {
    expect(scope(files)).toBe(expected);
  });

  it("includes workspace dependencies for an isolated scope", () => {
    const result = classifyReleaseChanges(["apps/marketing-web/components/marketing-shell.tsx"]);
    expect(result.affectedWorkspaces).toContain("@waflo/marketing-web");
    expect(result.affectedWorkspaces).toContain("@waflo/i18n");
    expect(result.imageTargets).toEqual(["marketing-staging"]);
  });

  it("fails closed when changed-file parsing or git resolution is ambiguous", () => {
    expect(scope(["../outside.ts"])).toBe("FULL");
    expect(
      classifyReleaseChanges(["apps/marketing-web/app/[locale]/page.tsx"], {
        graph: { byDirectory: new Map(), dependencies: new Map() },
      }).scope,
    ).toBe("FULL");
    const result = classifyReleaseRange({
      baseSha: "0".repeat(40),
      headSha: "a".repeat(40),
      exec: (() => {
        throw new Error("must not execute");
      }) as never,
    });
    expect(result.scope).toBe("FULL");
    expect(result.reason).toContain("untrusted release base");
  });
});
