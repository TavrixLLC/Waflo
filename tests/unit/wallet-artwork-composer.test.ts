import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  balancedWalletStampDistribution,
  layoutStampPositions,
  type PublishedMembershipStampRenderResult,
  renderPublishedMembershipStampSvg,
  type StampOutputProfile,
} from "@waflo/stamp-engine";
import {
  APPLE_POSTER_LAYOUT,
  composeApplePosterArtwork,
  composeAppleStoreCardStripArtwork,
  composeWalletArtwork,
  GOOGLE_HERO_LAYOUT,
  legacyAppleStampGridRows,
  measureRenderedStampArtwork,
  validateWalletArtworkPng,
  walletArtworkArabicTypeface,
  walletArtworkDimensions,
  walletArtworkIdentityTitleLines,
  walletArtworkInputFromStampRender,
  walletArtworkPanelCorners,
} from "@waflo/wallet-artwork";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  libraryArtworkDigest,
  resolveProductionTemplateStampArtwork,
} from "../../apps/api/src/programs/library-artwork.js";
import {
  type ProgramTemplateDefinition,
  programTemplateCatalog,
} from "../../packages/contracts/src/program-template-catalog.js";
import { decodeQrImage } from "../../packages/qr-core/src/index.js";

function renderTemplate(
  template: ProgramTemplateDefinition,
  options: {
    locale?: "en" | "ar";
    current?: number;
    rewardReady?: boolean;
    outputProfile?: StampOutputProfile;
  } = {},
): PublishedMembershipStampRenderResult {
  const { filled, empty } = resolveProductionTemplateStampArtwork(template);
  const goal = template.recommendedStampGoal;
  const outputProfile = options.outputProfile ?? "CUSTOMER_WEB";
  return renderPublishedMembershipStampSvg({
    organizationId: "baseline-org",
    programId: `baseline-${template.code}`,
    programVersionId: `v${template.version}`,
    membershipId: "baseline-member",
    rendererSchemaVersion: "waflo-stamp-render-v1",
    locale: options.locale ?? "en",
    currentStampCount: options.current ?? Math.max(1, Math.floor(goal * 0.625)),
    requiredStampCount: goal,
    rewardReady: options.rewardReady ?? false,
    layoutType: template.layout.type,
    layoutConfiguration: template.layout.configuration,
    ...(outputProfile === "APPLE_WALLET" || outputProfile === "GOOGLE_WALLET"
      ? { layoutPolicy: "BALANCED_WALLET_ROWS_V1" as const }
      : {}),
    visualTheme: {
      filledColor: template.colors.accent,
      emptyColor: template.colors.secondary,
      accentColor: template.colors.accent,
      backgroundColor: template.colors.background,
      foregroundColor: template.colors.foreground,
      stampSize: template.layout.stampSize,
      spacing: template.layout.stampSpacing,
    },
    filledArtwork: { kind: "svg", content: filled.content, trusted: true },
    emptyArtwork: { kind: "svg", content: empty.content, trusted: true },
    assetDigests: {
      filled: libraryArtworkDigest(filled),
      empty: libraryArtworkDigest(empty),
    },
    outputProfile,
  });
}

function compositionInput(
  template: ProgramTemplateDefinition,
  rendered: PublishedMembershipStampRenderResult,
  options: { locale?: "en" | "ar"; current?: number; rewardReady?: boolean } = {},
) {
  const current = options.current ?? Math.max(1, Math.floor(template.recommendedStampGoal * 0.625));
  return walletArtworkInputFromStampRender(
    {
      organizationName: (options.locale ?? "en") === "ar" ? "محمصة وافلو" : "Waflo Roastery",
      programName:
        (options.locale ?? "en") === "ar"
          ? template.copy.ar.programName
          : template.copy.en.programName,
      memberName: (options.locale ?? "en") === "ar" ? "أمينة حسن" : "Amina Hassan",
      credentialPayload: "waflo.review.cred_safe_visual_proof",
      rewardLabel:
        (options.locale ?? "en") === "ar"
          ? template.copy.ar.rewardSummary
          : template.copy.en.rewardSummary,
      stampRenderInput: {
        layoutType: template.layout.type,
        locale: options.locale ?? "en",
        currentStampCount: current,
        requiredStampCount: template.recommendedStampGoal,
        rewardReady: options.rewardReady ?? false,
        visualTheme: {
          backgroundColor: template.colors.background,
          foregroundColor: template.colors.foreground,
          accentColor: template.colors.accent,
          emptyColor: template.colors.secondary,
          stampSize: template.layout.stampSize,
        },
      },
    },
    rendered,
  );
}

describe("Wallet artwork composition", () => {
  it("keeps bilingual program phrases intact and orders them for the active language", () => {
    expect(walletArtworkIdentityTitleLines("بطاقة الوفاء / Cedar Circle", "ar")).toEqual([
      "بطاقة الوفاء",
      "Cedar Circle",
    ]);
    expect(walletArtworkIdentityTitleLines("بطاقة الوفاء / Cedar Circle", "en")).toEqual([
      "Cedar Circle",
      "بطاقة الوفاء",
    ]);
    expect(walletArtworkIdentityTitleLines("The Very Long Cedar Circle", "en")).toEqual([
      "The Very Long Cedar Circle",
    ]);
  });

  it("normalizes every built-in template to the shared grid without replacing stamp assets", () => {
    expect(programTemplateCatalog.length).toBeGreaterThan(0);
    for (const template of programTemplateCatalog) {
      const id = `${template.code}-v${template.version}`;
      expect(template.layout.type, id).toBe("GRID");
      expect(template.layout.configuration, id).toEqual({});

      const rendered = renderTemplate(template);
      const expectedRows = balancedWalletStampDistribution(template.recommendedStampGoal).rows;
      const actualRows = [...new Set(rendered.positions.map((position) => position.y))].map(
        (rowY) => rendered.positions.filter((position) => position.y === rowY).length,
      );
      expect(actualRows, id).toEqual(expectedRows);
      expect((rendered.svg.match(/preserveAspectRatio="xMidYMid meet"/g) ?? []).length, id).toBe(
        template.recommendedStampGoal,
      );
      expect(rendered.svg, id).toContain('data-visual-state="FILLED"');
    }
  });

  it("composes every versioned template for every platform without clipping its source artwork", async () => {
    for (const template of programTemplateCatalog) {
      const id = `${template.code}-v${template.version}`;
      const rendered = renderTemplate(template, { outputProfile: "APPLE_WALLET" });
      const input = compositionInput(template, rendered);
      const outputs = await Promise.all([
        composeWalletArtwork(input, "APPLE_POSTER"),
        composeWalletArtwork(input, "APPLE_STORE_CARD_STRIP"),
        composeWalletArtwork(input, "APPLE_GENERIC_STRIP"),
        composeWalletArtwork(input, "APPLE_LEGACY_STRIP"),
        composeWalletArtwork(input, "GOOGLE_HERO"),
      ]);
      for (const output of outputs) {
        const contract = walletArtworkDimensions[output.target];
        expect(output.width, `${id}:${output.target}`).toBe(contract.width);
        expect(output.height, `${id}:${output.target}`).toBe(contract.height);
        expect(output.sourceStampDigest, `${id}:${output.target}`).toBe(rendered.contentDigest);
        expect(output.stampPlacement.left, `${id}:${output.target}`).toBeGreaterThanOrEqual(0);
        expect(output.stampPlacement.top, `${id}:${output.target}`).toBeGreaterThanOrEqual(0);
        expect(
          output.stampPlacement.left,
          `${id}:${output.target}:padded-left`,
        ).toBeGreaterThanOrEqual(output.stampRegion.left);
        expect(
          output.stampPlacement.top,
          `${id}:${output.target}:padded-top`,
        ).toBeGreaterThanOrEqual(output.stampRegion.top);
        expect(
          output.stampPlacement.left + output.stampPlacement.width,
          `${id}:${output.target}`,
        ).toBeLessThanOrEqual(output.width);
        expect(
          output.stampPlacement.top + output.stampPlacement.height,
          `${id}:${output.target}`,
        ).toBeLessThanOrEqual(output.height);
        expect(
          output.stampPlacement.left + output.stampPlacement.width,
          `${id}:${output.target}:padded-right`,
        ).toBeLessThanOrEqual(output.stampRegion.left + output.stampRegion.width);
        expect(
          output.stampPlacement.top + output.stampPlacement.height,
          `${id}:${output.target}:padded-bottom`,
        ).toBeLessThanOrEqual(output.stampRegion.top + output.stampRegion.height);
        expect(
          Math.abs(
            output.stampPlacement.width /
              output.stampPlacement.height /
              output.sourceVisibleRasterAspectRatio -
              1,
          ),
          `${id}:${output.target}`,
        ).toBeLessThan(0.015);
        const centerError = Math.abs(
          output.stampPlacement.left +
            output.stampPlacement.width / 2 -
            (output.stampRegion.left + output.stampRegion.width / 2),
        );
        expect(centerError, `${id}:${output.target}`).toBeLessThanOrEqual(output.width * 0.02);
        const verticalCenterError = Math.abs(
          output.stampPlacement.top +
            output.stampPlacement.height / 2 -
            (output.stampPanelRegion.top + output.stampPanelRegion.height / 2),
        );
        expect(verticalCenterError, `${id}:${output.target}`).toBeLessThanOrEqual(0.5);
        await expect(
          validateWalletArtworkPng({ bytes: output.bytes, target: output.target }),
        ).resolves.toMatchObject({ width: contract.width, height: contract.height });
      }
    }
  }, 60_000);

  it("balances and centers the visible Wallet group from 1 through 10 stamps", async () => {
    const base = programTemplateCatalog.find(
      (candidate) => candidate.code === "COFFEE" && candidate.version === 2,
    );
    if (!base) throw new Error("Coffee v2 template is required.");
    const scenarios = [
      { goal: 1, rows: [1] },
      { goal: 4, rows: [4] },
      { goal: 5, rows: [5] },
      { goal: 6, rows: [3, 3] },
      { goal: 7, rows: [4, 3] },
      { goal: 8, rows: [4, 4] },
      { goal: 9, rows: [5, 4] },
      { goal: 10, rows: [5, 5] },
    ];
    for (const scenario of scenarios) {
      const template: ProgramTemplateDefinition = {
        ...base,
        recommendedStampGoal: scenario.goal,
        layout: {
          ...base.layout,
          type: "GRID",
          configuration: {},
        },
      };
      const rendered = renderTemplate(template, {
        current: Math.floor(scenario.goal / 2),
        outputProfile: "APPLE_WALLET",
      });
      const measured = measureRenderedStampArtwork(rendered, template.layout.stampSize);
      expect(measured.width).toBeLessThanOrEqual(rendered.width);
      expect(measured.height).toBeLessThanOrEqual(rendered.height);
      const rowCounts = [...new Set(rendered.positions.map((position) => position.y))].map(
        (rowY) => rendered.positions.filter((position) => position.y === rowY).length,
      );
      expect(rowCounts).toEqual(scenario.rows);
      const input = compositionInput(template, rendered, {
        current: Math.floor(scenario.goal / 2),
      });
      for (const target of ["APPLE_POSTER", "GOOGLE_HERO"] as const) {
        const output = await composeWalletArtwork(input, target);
        const visualCenter = output.stampPlacement.left + output.stampPlacement.width / 2;
        const visualMiddle = output.stampPlacement.top + output.stampPlacement.height / 2;
        const intendedCenter = output.stampPanelRegion.left + output.stampPanelRegion.width / 2;
        const intendedMiddle = output.stampPanelRegion.top + output.stampPanelRegion.height / 2;
        expect(
          Math.abs(visualCenter - intendedCenter),
          `${scenario.goal}:${target}`,
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(visualMiddle - intendedMiddle),
          `${scenario.goal}:${target}`,
        ).toBeLessThanOrEqual(0.5);
      }
    }
  }, 30_000);

  it("keeps counter, stamp, and reward regions separated in image-first layouts", () => {
    const separated = (
      first: { left: number; top: number; width: number; height: number },
      second: { left: number; top: number; width: number; height: number },
    ) =>
      first.left + first.width <= second.left ||
      second.left + second.width <= first.left ||
      first.top + first.height <= second.top ||
      second.top + second.height <= first.top;
    for (const layout of [APPLE_POSTER_LAYOUT, GOOGLE_HERO_LAYOUT]) {
      if (
        !layout.identityRegion ||
        !layout.counterBadgeRegion ||
        !layout.rewardRegion ||
        !layout.qrRegion
      ) {
        throw new Error("Image-first test layout lacks required regions.");
      }
      expect(separated(layout.counterBadgeRegion, layout.stampRegion)).toBe(true);
      expect(separated(layout.stampRegion, layout.rewardRegion)).toBe(true);
      expect(separated(layout.counterBadgeRegion, layout.rewardRegion)).toBe(true);
      expect(separated(layout.identityRegion, layout.counterBadgeRegion)).toBe(true);
      expect(separated(layout.rewardRegion, layout.qrRegion)).toBe(true);
      expect(separated(layout.stampRegion, layout.qrRegion)).toBe(true);
      if (layout !== APPLE_POSTER_LAYOUT) {
        expect(layout.stampRegion.left + layout.stampRegion.width / 2).toBe(
          layout.stampPanelRegion.left + layout.stampPanelRegion.width / 2,
        );
      }
      expect(layout.stampRegion.top + layout.stampRegion.height / 2).toBe(
        layout.stampPanelRegion.top + layout.stampPanelRegion.height / 2,
      );
    }
    expect(APPLE_POSTER_LAYOUT.stampPanelRegion.width).toBe(330);
    expect(GOOGLE_HERO_LAYOUT.stampPanelRegion.width).toBe(968);
    expect(APPLE_POSTER_LAYOUT.qrRegion?.width).toBeGreaterThan(60);
    expect(GOOGLE_HERO_LAYOUT.qrRegion?.width).toBeGreaterThan(136);
    expect(
      (GOOGLE_HERO_LAYOUT.qrRegion?.top ?? 0) + (GOOGLE_HERO_LAYOUT.qrRegion?.height ?? 0) / 2,
    ).toBeGreaterThan(648);
    expect(
      walletArtworkDimensions.APPLE_POSTER.height -
        ((APPLE_POSTER_LAYOUT.qrRegion?.top ?? 0) + (APPLE_POSTER_LAYOUT.qrRegion?.height ?? 0)),
    ).toBeGreaterThanOrEqual(20);
    expect(
      (APPLE_POSTER_LAYOUT.qrRegion?.top ?? 0) + (APPLE_POSTER_LAYOUT.qrRegion?.height ?? 0),
    ).toBeLessThanOrEqual(305);
    expect(
      (APPLE_POSTER_LAYOUT.rewardRegion?.top ?? 0) +
        (APPLE_POSTER_LAYOUT.rewardRegion?.height ?? 0),
    ).toBeLessThanOrEqual(305);
  });

  it("enforces balanced panel breathing room and mirrored diagonal corners", () => {
    for (const [name, layout, minimumHorizontal, minimumVertical] of [
      ["APPLE_POSTER", APPLE_POSTER_LAYOUT, 14, 8],
      ["GOOGLE_HERO", GOOGLE_HERO_LAYOUT, 60, 36],
    ] as const) {
      const left = layout.stampRegion.left - layout.stampPanelRegion.left;
      const right =
        layout.stampPanelRegion.left +
        layout.stampPanelRegion.width -
        (layout.stampRegion.left + layout.stampRegion.width);
      const top = layout.stampRegion.top - layout.stampPanelRegion.top;
      const bottom =
        layout.stampPanelRegion.top +
        layout.stampPanelRegion.height -
        (layout.stampRegion.top + layout.stampRegion.height);
      expect(left, `${name}:left`).toBeGreaterThanOrEqual(minimumHorizontal);
      expect(right, `${name}:right`).toBeGreaterThanOrEqual(minimumHorizontal);
      expect(top, `${name}:top`).toBeGreaterThanOrEqual(minimumVertical);
      expect(bottom, `${name}:bottom`).toBeGreaterThanOrEqual(minimumVertical);
      if (name !== "APPLE_POSTER") {
        expect(left, `${name}:horizontal-balance`).toBe(right);
      }
      expect(top, `${name}:vertical-balance`).toBe(bottom);
    }
    for (const corners of Object.values(walletArtworkPanelCorners)) {
      expect(corners.topLeft).toBe(corners.bottomRight);
      expect(corners.topRight).toBe(corners.bottomLeft);
      expect(corners.topLeft).toBeGreaterThan(corners.topRight);
    }
  });

  it("renders exact Store Card 1x/2x/3x strip assets and an Arabic reward-ready state", async () => {
    const template = programTemplateCatalog.find(
      (candidate) => candidate.code === "SALON" && candidate.version === 2,
    );
    if (!template) throw new Error("Salon v2 template is required.");
    const rendered = renderTemplate(template, {
      locale: "ar",
      current: template.recommendedStampGoal,
      rewardReady: true,
      outputProfile: "APPLE_WALLET",
    });
    const input = compositionInput(template, rendered, {
      locale: "ar",
      current: template.recommendedStampGoal,
      rewardReady: true,
    });
    const [poster, storeCard] = await Promise.all([
      composeApplePosterArtwork(input),
      composeAppleStoreCardStripArtwork(input),
    ]);
    for (const [variants, base] of [
      [poster, [358, 448]],
      [storeCard, [375, 144]],
    ] as const) {
      expect([variants.times1.width, variants.times1.height]).toEqual(base);
      expect([variants.times2.width, variants.times2.height]).toEqual([base[0] * 2, base[1] * 2]);
      expect([variants.times3.width, variants.times3.height]).toEqual([base[0] * 3, base[1] * 3]);
    }
    const englishRendered = renderTemplate(template, {
      locale: "en",
      current: template.recommendedStampGoal,
      rewardReady: true,
      outputProfile: "APPLE_WALLET",
    });
    const englishPoster = await composeWalletArtwork(
      compositionInput(template, englishRendered, {
        locale: "en",
        current: template.recommendedStampGoal,
        rewardReady: true,
      }),
      "APPLE_POSTER",
    );
    expect(poster.times1.stampPlacement).toEqual(englishPoster.stampPlacement);
    expect(poster.times1.stampPanelRegion).toEqual(englishPoster.stampPanelRegion);
    expect(poster.times1.contentDigest).not.toBe(englishPoster.contentDigest);
  }, 30_000);

  it("derives distinct wide Store Card strips from each selected theme artwork", async () => {
    const templates = ["COFFEE", "SALON", "RETAIL", "RESTAURANT"]
      .map((code) => programTemplateCatalog.find((candidate) => candidate.code === code))
      .filter((template): template is ProgramTemplateDefinition => Boolean(template));
    expect(templates).toHaveLength(4);

    const strips = await Promise.all(
      templates.map(async (template) => {
        const rendered = renderTemplate(template, { outputProfile: "APPLE_WALLET" });
        return composeAppleStoreCardStripArtwork(compositionInput(template, rendered));
      }),
    );

    for (const variants of strips) {
      for (const [index, strip] of Object.values(variants).entries()) {
        const scale = (index + 1) as 1 | 2 | 3;
        const metadata = await sharp(strip.bytes).metadata();
        expect([strip.width, strip.height]).toEqual([375 * scale, 144 * scale]);
        expect([metadata.width, metadata.height]).toEqual([375 * scale, 144 * scale]);
        expect(metadata.format).toBe("png");
        expect(strip.bytes.length).toBeGreaterThan(100);
      }
    }
    expect(new Set(strips.map((variants) => variants.times1.contentDigest)).size).toBe(4);
  }, 30_000);

  it("renders identity on the image-first face and a decodable QR with no caption region", async () => {
    const template = programTemplateCatalog.find(
      (candidate) => candidate.code === "COFFEE" && candidate.version === 2,
    );
    if (!template) throw new Error("Coffee v2 template is required.");
    const rendered = renderTemplate(template, { outputProfile: "APPLE_WALLET" });
    const input = compositionInput(template, rendered);
    for (const target of ["APPLE_POSTER", "GOOGLE_HERO"] as const) {
      const output = await composeWalletArtwork(input, target);
      expect(output.identityRegion).toBeDefined();
      expect(output.qrRegion).toBeDefined();
      const qrRegion = output.qrRegion;
      if (!qrRegion) throw new Error(`${target} QR region is required.`);
      const qr = await sharp(output.bytes).extract(qrRegion).png().toBuffer();
      await expect(decodeQrImage(qr, "image/png")).resolves.toBe(input.credentialPayload);
    }
    const source = readFileSync("packages/wallet-artwork/src/index.ts", "utf8");
    expect(source).not.toMatch(/Scan at checkout|Scan code ending|Present this code/i);
  }, 30_000);

  it("keeps the premium rounded QR decodable and applies a safe optional center logo", async () => {
    const template = programTemplateCatalog.find(
      (candidate) => candidate.code === "COFFEE" && candidate.version === 2,
    );
    if (!template) throw new Error("Coffee v2 template is required.");
    const rendered = renderTemplate(template, { outputProfile: "GOOGLE_WALLET" });
    const centerLogo = await sharp({
      create: { width: 96, height: 96, channels: 4, background: "#E4572E" },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><path d="M20 22l16 52 12-30 12 30 16-52" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
          ),
        },
      ])
      .png()
      .toBuffer();
    const input = {
      ...compositionInput(template, rendered),
      qrCenterLogo: { bytes: centerLogo },
    };
    for (const target of ["APPLE_POSTER", "GOOGLE_HERO"] as const) {
      const output = await composeWalletArtwork(input, target);
      const qrRegion = output.qrRegion;
      if (!qrRegion) throw new Error(`${target} QR region is required.`);
      const qr = await sharp(output.bytes).extract(qrRegion).png().toBuffer();
      await expect(decodeQrImage(qr, "image/png")).resolves.toBe(input.credentialPayload);
      expect(output.qrCenterLogoApplied, target).toBe(true);
    }
  }, 30_000);

  it("keeps native Store Card reward copy out of the strip artwork", async () => {
    const template = programTemplateCatalog.find(
      (candidate) => candidate.code === "SALON" && candidate.version === 2,
    );
    if (!template) throw new Error("Salon v2 template is required.");
    const rendered = renderTemplate(template, { outputProfile: "APPLE_WALLET" });
    const input = compositionInput(template, rendered);
    const changed = { ...input, rewardLabel: "A completely different reward detail" };
    const [storeCard, changedStoreCard] = await Promise.all([
      composeAppleStoreCardStripArtwork(input),
      composeAppleStoreCardStripArtwork(changed),
    ]);
    expect(storeCard.times1.contentDigest).toBe(changedStoreCard.times1.contentDigest);
  }, 30_000);

  it("uses a visual-only Grid for Store Card strips and fails obsolete layouts closed", async () => {
    const template = programTemplateCatalog.find(
      (candidate) => candidate.code === "COFFEE" && candidate.version === 2,
    );
    if (!template) throw new Error("Coffee v2 template is required.");
    const rendered = renderTemplate(template, { outputProfile: "CUSTOMER_WEB" });
    const input = compositionInput(template, rendered);
    const [storeCard, changedText] = await Promise.all([
      composeAppleStoreCardStripArtwork(input),
      composeAppleStoreCardStripArtwork({
        ...input,
        organizationName: "Different merchant",
        programName: "Different program",
        memberName: "Different member",
        rewardLabel: "Different reward",
        credentialPayload: "different-opaque-credential",
      }),
    ]);
    expect(storeCard.times1.stampGridRows).toBeUndefined();
    expect(legacyAppleStampGridRows(8)).toEqual([4, 4]);
    expect(layoutStampPositions(8, "RING").map(({ x, y }) => ({ x, y }))).toEqual(
      layoutStampPositions(8, "GRID").map(({ x, y }) => ({ x, y })),
    );
    expect(storeCard.times1.contentDigest).toBe(changedText.times1.contentDigest);
    const source = readFileSync("packages/wallet-artwork/src/index.ts", "utf8");
    expect(source).toContain('data-text="none"');
    expect(source).toContain("Legacy Apple stamp artwork must not contain text glyphs.");
  }, 30_000);

  it("rasterizes English and shaped Arabic text as the final layer on pale and dark themes", async () => {
    const template = programTemplateCatalog.find(
      (candidate) => candidate.code === "COFFEE" && candidate.version === 2,
    );
    if (!template) throw new Error("Coffee v2 template is required.");
    for (const [locale, theme] of [
      ["en", { backgroundColor: "#FFF8E7", foregroundColor: "#241916" }],
      ["ar", { backgroundColor: "#172233", foregroundColor: "#FFFFFF" }],
    ] as const) {
      const rendered = renderTemplate(template, { locale, outputProfile: "GOOGLE_WALLET" });
      const base = compositionInput(template, rendered, { locale });
      const first = await composeWalletArtwork(
        { ...base, theme: { ...base.theme, ...theme } },
        "GOOGLE_HERO",
      );
      const second = await composeWalletArtwork(
        {
          ...base,
          organizationName: locale === "ar" ? "متجر دجلة" : "Tigris Market",
          programName: locale === "ar" ? "مكافآت الزوار" : "Visitor Rewards",
          theme: { ...base.theme, ...theme },
        },
        "GOOGLE_HERO",
      );
      const region = first.identityRegion;
      if (!region) throw new Error("Google identity region is required.");
      const [firstCrop, secondCrop] = await Promise.all([
        sharp(first.bytes).extract(region).png().toBuffer(),
        sharp(second.bytes).extract(region).png().toBuffer(),
      ]);
      expect(createHash("sha256").update(firstCrop).digest("hex"), locale).not.toBe(
        createHash("sha256").update(secondCrop).digest("hex"),
      );
    }
    const source = readFileSync("packages/wallet-artwork/src/index.ts", "utf8");
    expect(source).toContain("createWalletArtworkRenderPlan(");
    expect(source).toContain("const overlay = plan.overlaySvg;");
    expect(source.indexOf("const overlay = plan.overlaySvg;")).toBeLessThan(
      source.lastIndexOf(".composite(["),
    );
    expect(readFileSync("deploy/vps/Dockerfile", "utf8")).toContain("fonts-noto-core");
  }, 30_000);

  it("ships the Arabic-capable font stack in the API image used by template gallery rasters", () => {
    const dockerfile = readFileSync("deploy/vps/Dockerfile", "utf8");
    expect(dockerfile).toMatch(
      /FROM runtime AS api\s+USER root\s+RUN apt-get update && \\\s+apt-get install --yes --no-install-recommends fontconfig fonts-noto-core/u,
    );
  });

  it("uses shaped RTL text semantics and canonical logical reward geometry", () => {
    const source = readFileSync("packages/wallet-artwork/src/index.ts", "utf8");
    expect(walletArtworkArabicTypeface).toMatch(/Noto Sans Arabic/);
    expect(source).toContain('direction="');
    expect(source).toContain('unicode-bidi="plaintext"');
    expect(source).toContain('xml:lang="');
    expect(source).toContain("? region.left + region.width - horizontalPadding - iconSize");
    expect(source).toContain('const textAnchor = "start"');
    expect(source).toContain("const presentation = cardLocalePresentation(input.locale);");
    expect(source).toContain("const copy = walletStructuralCopyForLocale(presentation.locale);");
    expect(source).not.toContain('input.locale === "ar"');
  });

  it("fails closed if the authoritative renderer output is modified after digesting", async () => {
    const template = programTemplateCatalog[0];
    if (!template) throw new Error("A program template is required.");
    const rendered = renderTemplate(template);
    const input = compositionInput(template, {
      ...rendered,
      svg: rendered.svg.replace("</svg>", "<!-- tampered --></svg>"),
    });
    await expect(composeWalletArtwork(input, "GOOGLE_HERO")).rejects.toThrow("digest mismatch");
  });

  it("contains no second stamp renderer in the composition package", () => {
    const source = readFileSync("packages/wallet-artwork/src/index.ts", "utf8");
    expect(source).not.toContain("renderPublishedMembershipStampSvg");
    expect(source).not.toContain("data-stamp-index");
    expect(source).not.toContain("filledArtwork");
    expect(source).not.toContain("emptyArtwork");
  });
});
