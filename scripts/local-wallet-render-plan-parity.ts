/** Local-only canonical-plan identity evidence for Dashboard and backend consumers. */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderStampSvg } from "../packages/stamp-engine/src/index.js";
import { createDashboardWalletPreviewArtworkPlan } from "../packages/wallet-artwork/src/dashboard-preview.js";
import { createWalletArtworkCompositionPlan } from "../packages/wallet-artwork/src/index.js";
import {
  applePosterGoogleMasterRenderInput,
  createWalletArtworkApplePosterRenderPlan,
} from "../packages/wallet-artwork/src/render-plan.js";

const outputDirectory =
  "C:/Users/Alhamza Nazhan/Desktop/TestRES/wallet-preview-frontend-parity/iteration-03-shared-rasterizer";
const base = {
  organizationName: "Waflo Coffee",
  programName: "Eight visits earn a coffee",
  rewardSummary: "A free house coffee",
  progress: 4,
  goal: 8,
  backgroundColor: "#F5E5D2",
  foregroundColor: "#2A1710",
  accentColor: "#6B3F2A",
  secondaryColor: "#E7B56B",
};

function localized(locale: string) {
  if (locale === "ar")
    return {
      ...base,
      organizationName: "مقهى وافلو",
      programName: "ثماني زيارات تكسبك قهوة",
      rewardSummary: "قهوة منزلية مجانية",
    };
  if (locale === "ckb")
    return {
      ...base,
      organizationName: "کافێی وافلۆ",
      programName: "هەشت سەردان قاوەیەکت پێدەدات",
      rewardSummary: "قاوەی ماڵی بەخۆڕایی",
    };
  if (locale === "ku-Arab-IQ")
    return {
      ...base,
      organizationName: "قهوه‌خانه‌ی وافلو",
      programName: "هەشت سەردان قاوەیەک دەدەت",
      rewardSummary: "قاوەی ماڵی بەخۆڕایی",
    };
  return base;
}

const fixtures = [
  ["english", "en", "APPLE_LEGACY", {}],
  ["arabic", "ar", "APPLE_IOS27", {}],
  ["sorani", "ckb", "GOOGLE_WALLET", {}],
  ["badini", "ku-Arab-IQ", "GOOGLE_WALLET", {}],
  [
    "long",
    "en",
    "GOOGLE_WALLET",
    {
      programName: "Eight qualifying visits unlock a carefully prepared seasonal coffee reward",
      rewardSummary:
        "A complimentary hand-crafted house coffee is ready after the final qualifying visit.",
    },
  ],
  [
    "colors",
    "en",
    "GOOGLE_WALLET",
    {
      backgroundColor: "#D8EEF7",
      foregroundColor: "#103A4C",
      accentColor: "#146C94",
      secondaryColor: "#8FC8DC",
    },
  ],
  ["logo-default-crop", "en", "GOOGLE_WALLET", {}],
] as const;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function main(): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  const records: Record<string, unknown> = {};
  for (const [name, locale, profile, overrides] of fixtures) {
    const content = { ...localized(locale), ...overrides };
    const outputProfile = profile === "GOOGLE_WALLET" ? "GOOGLE_WALLET" : "APPLE_WALLET";
    const stamp = renderStampSvg({
      goal: content.goal,
      progress: content.progress,
      layout: "GRID",
      outputProfile,
      filledColor: content.accentColor,
      emptyColor: content.secondaryColor,
      accentColor: content.accentColor,
      backgroundColor: content.backgroundColor,
      foregroundColor: content.foregroundColor,
      stampSize: 24,
      spacing: 12,
      locale,
    });
    const dashboardInput = {
      profile,
      locale,
      stampSvg: stamp.svg,
      stampArtwork: {
        width: stamp.width,
        height: stamp.height,
        contentDigest: stamp.digest,
        positions: stamp.positions,
        stampSize: 24,
      },
      ...content,
    } as const;
    const dashboard = createDashboardWalletPreviewArtworkPlan(dashboardInput);
    const backendInput = {
      stampArtwork: { svg: stamp.svg, ...dashboardInput.stampArtwork },
      stampSize: 24,
      layoutType: "GRID" as const,
      theme: {
        backgroundColor: content.backgroundColor,
        foregroundColor: content.foregroundColor,
        accentColor: content.accentColor,
        secondaryColor: content.secondaryColor,
      },
      currentStampCount: content.progress,
      requiredStampCount: content.goal,
      rewardReady: content.progress >= content.goal,
      rewardLabel: content.rewardSummary,
      organizationName: content.organizationName,
      programName: content.programName,
      memberName: "Preview member",
      credentialPayload: "waflo-wallet-preview-only",
      locale,
    };
    const serverInput =
      profile === "APPLE_IOS27" ? applePosterGoogleMasterRenderInput(backendInput) : backendInput;
    const target = profile === "APPLE_LEGACY" ? "APPLE_LEGACY_STRIP" : "GOOGLE_HERO";
    const server = createWalletArtworkCompositionPlan(serverInput, target);
    const inputJson = JSON.stringify(dashboard.planInput);
    const planJson = JSON.stringify(dashboard.plan);
    const serverInputJson = JSON.stringify(serverInput);
    const serverPlanJson = JSON.stringify(server);
    const dashboardPosterJson = dashboard.posterPlan
      ? JSON.stringify(dashboard.posterPlan)
      : undefined;
    const serverPosterJson =
      profile === "APPLE_IOS27"
        ? JSON.stringify(createWalletArtworkApplePosterRenderPlan(backendInput))
        : undefined;
    const inputEqual = inputJson === serverInputJson;
    const planEqual = planJson === serverPlanJson;
    const posterEqual = dashboardPosterJson === serverPosterJson;
    if (!inputEqual || !planEqual || !posterEqual) {
      throw new Error(`Canonical render plan mismatch for ${name}.`);
    }
    records[name] = {
      inputEqual,
      planEqual,
      posterEqual,
      dashboardInputSha256: digest(inputJson),
      serverInputSha256: digest(serverInputJson),
      dashboardPlanSha256: digest(planJson),
      serverPlanSha256: digest(serverPlanJson),
      ...(dashboardPosterJson
        ? {
            dashboardPosterPlanSha256: digest(dashboardPosterJson),
            serverPosterPlanSha256: digest(serverPosterJson ?? ""),
          }
        : {}),
    };
  }
  await writeFile(
    path.join(outputDirectory, "plan-parity.json"),
    `${JSON.stringify({ result: "RENDER PLAN PARITY = 100%", fixtures: records }, null, 2)}\n`,
    "utf8",
  );
  console.log("RENDER PLAN PARITY = 100%");
}

void main();
