import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { composeProgramPreview } from "../../apps/api/src/programs/preview-composer.js";
import { composeDashboardWalletArtwork } from "../../apps/api/src/programs/wallet-preview-artwork.js";
import { createQrPng } from "../../packages/qr-core/src/index.js";
import {
  createQrPreviewPngDataUri,
  createQrPreviewRasterMarkup,
} from "../../packages/qr-core/src/preview.js";
import { renderStampSvg } from "../../packages/stamp-engine/src/index.js";
import {
  createDashboardWalletPreviewArtworkPlan,
  dashboardWalletPreviewQrRasterRequest,
  renderDashboardWalletPreviewSvg,
} from "../../packages/wallet-artwork/src/dashboard-preview.js";
import { createWalletArtworkCompositionPlan } from "../../packages/wallet-artwork/src/index.js";
import {
  applePosterGoogleMasterRenderInput,
  createWalletArtworkApplePosterRenderPlan,
  createWalletArtworkRenderPlan,
  renderWalletArtworkPlanSvg,
  walletArtworkContrastRatio,
} from "../../packages/wallet-artwork/src/render-plan.js";

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

function field(svg: string, name: string): string | undefined {
  return new RegExp(`${name}="([^"]+)"`, "u").exec(svg)?.[1];
}

function productionArtworkBounds(svg: string, target: string): string | undefined {
  return new RegExp(
    `data-production-wallet-artwork="${target}"[^>]+x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`,
    "u",
  )
    .exec(svg)
    ?.slice(1)
    .join(",");
}

async function renderPair(
  locale: string,
  profile: "APPLE_LEGACY" | "APPLE_IOS27" | "GOOGLE_WALLET",
) {
  const serverProfile = profile === "GOOGLE_WALLET" ? "GOOGLE_WALLET" : "APPLE_WALLET";
  const stamp = renderStampSvg({
    goal: base.goal,
    progress: base.progress,
    layout: "GRID",
    outputProfile: serverProfile,
    filledColor: base.accentColor,
    emptyColor: base.secondaryColor,
    accentColor: base.accentColor,
    backgroundColor: base.backgroundColor,
    foregroundColor: base.foregroundColor,
    stampSize: 24,
    spacing: 12,
    locale,
  });
  const artwork = await composeDashboardWalletArtwork({
    profile: serverProfile,
    ...(profile === "APPLE_IOS27" ? { appleWalletVariant: "POSTER" as const } : {}),
    locale,
    renderedStamp: stamp,
    stampSize: 24,
    ...base,
  });
  const server = composeProgramPreview({
    profile: serverProfile,
    ...(profile === "APPLE_IOS27" ? { appleWalletVariant: "POSTER" as const } : {}),
    locale,
    shortDescription: "Earn rewards with every visit.",
    terms: "One stamp per visit.",
    stampSvg: stamp.svg,
    stampLayout: "GRID",
    customerWebVariant: "CARD",
    apple: {
      headerLabel: "Stamps",
      headerValue: "4/8",
      secondaryLabel: "Reward",
      barcodeLabel: "Membership",
      showBackContent: true,
    },
    google: {
      title: base.programName,
      subtitle: base.organizationName,
      detailsLabel: "Reward",
      barcodeLabel: "Membership",
    },
    ...base,
    walletArtwork: artwork,
  });
  const browserInput = {
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
    ...base,
  } as const;
  const browser = renderDashboardWalletPreviewSvg(browserInput);
  return { browser, browserInput, server, stamp };
}

describe("Dashboard Wallet shared preview shell", () => {
  it.each([
    ["english", "en", "APPLE_LEGACY", {}],
    ["arabic", "ar", "APPLE_IOS27", {}],
    ["sorani", "ckb", "GOOGLE_WALLET", {}],
    ["badini", "ku-Arab-IQ", "GOOGLE_WALLET", {}],
    [
      "long-content",
      "en",
      "GOOGLE_WALLET",
      {
        programName: "Eight qualifying visits unlock a carefully prepared seasonal coffee reward",
        rewardSummary:
          "A complimentary hand-crafted house coffee is ready after the final qualifying visit.",
      },
    ],
    [
      "custom-colors",
      "en",
      "GOOGLE_WALLET",
      {
        backgroundColor: "#D8EEF7",
        foregroundColor: "#103A4C",
        accentColor: "#146C94",
        secondaryColor: "#8FC8DC",
      },
    ],
    ["logo/default-crop", "en", "GOOGLE_WALLET", {}],
  ] as const)(
    "serializes the exact same canonical plan for backend and Dashboard: %s",
    async (_scenario, locale, profile, overrides) => {
      const { browserInput } = await renderPair(locale, profile);
      const input = { ...browserInput, ...overrides };
      const dashboardPlan = createDashboardWalletPreviewArtworkPlan(input);
      const backendInput = {
        stampArtwork: { svg: input.stampSvg, ...input.stampArtwork },
        stampSize: input.stampArtwork.stampSize,
        layoutType: "GRID" as const,
        theme: {
          backgroundColor: input.backgroundColor,
          foregroundColor: input.foregroundColor,
          accentColor: input.accentColor,
          secondaryColor: input.secondaryColor,
        },
        currentStampCount: input.progress,
        requiredStampCount: input.goal,
        rewardReady: input.progress >= input.goal,
        rewardLabel: input.rewardSummary,
        organizationName: input.organizationName,
        programName: input.programName,
        memberName: "Preview member",
        credentialPayload: "waflo-wallet-preview-only",
        locale: input.locale,
      };
      const serverInput =
        profile === "APPLE_IOS27" ? applePosterGoogleMasterRenderInput(backendInput) : backendInput;
      const target = profile === "APPLE_LEGACY" ? "APPLE_LEGACY_STRIP" : "GOOGLE_HERO";
      const serverPlan = createWalletArtworkCompositionPlan(serverInput, target);

      // JSON guards worker serialization; strict equality guards all nested
      // coordinates, color, text, QR and crop fields in the shared plan.
      expect(JSON.stringify(dashboardPlan.planInput)).toBe(JSON.stringify(serverInput));
      expect(dashboardPlan.plan).toStrictEqual(serverPlan);
      expect(JSON.stringify(dashboardPlan.plan)).toBe(JSON.stringify(serverPlan));
      if (profile === "APPLE_IOS27") {
        expect(dashboardPlan.posterPlan).toStrictEqual(
          createWalletArtworkApplePosterRenderPlan(backendInput),
        );
      }
    },
  );

  it.each([
    ["en", "APPLE_LEGACY"],
    ["ar", "APPLE_LEGACY"],
    ["ckb", "APPLE_IOS27"],
    ["ku-Arab-IQ", "GOOGLE_WALLET"],
  ] as const)(
    "keeps %s %s geometry and locale semantics identical to the API preview shell",
    async (locale, profile) => {
      const { browser, server } = await renderPair(locale, profile);
      const target =
        profile === "APPLE_LEGACY"
          ? "APPLE_LEGACY_STRIP"
          : profile === "APPLE_IOS27"
            ? "APPLE_POSTER"
            : "GOOGLE_HERO";

      expect(browser.width).toBe(server.width);
      expect(browser.height).toBe(server.height);
      expect(field(browser.svg, "viewBox")).toBe(field(server.svg, "viewBox"));
      expect(field(browser.svg, "direction")).toBe(field(server.svg, "direction"));
      expect(field(browser.svg, "lang")).toBe(field(server.svg, "lang"));
      expect(field(browser.svg, "data-barcode-format")).toBe(
        field(server.svg, "data-barcode-format"),
      );
      expect(productionArtworkBounds(browser.svg, target)).toBe(
        productionArtworkBounds(server.svg, target),
      );
      expect(browser.svg).toContain(`data-production-wallet-artwork="${target}"`);
      expect(server.svg).toContain(`data-production-wallet-artwork="${target}"`);
    },
  );

  it("keeps long text line breaking deterministic across the API and browser renderers", async () => {
    const { browser, server } = await renderPair("ar", "GOOGLE_WALLET");
    expect(browser.svg).toContain('direction="rtl"');
    expect(server.svg).toContain('direction="rtl"');
    expect(browser.svg.match(/data-google-native-title="true"/u)).toHaveLength(1);
    expect(server.svg.match(/data-google-native-title="true"/u)).toHaveLength(1);
  });

  it("uses shaped Arabic provider chrome and logical start anchors without changing English", async () => {
    const [{ browser: arabicGoogle }, { browser: arabicPoster }] = await Promise.all([
      renderPair("ar", "GOOGLE_WALLET"),
      renderPair("ar", "APPLE_IOS27"),
    ]);
    expect(arabicGoogle.svg).toContain('x="364" y="67" text-anchor="start"');
    expect(arabicGoogle.svg).toContain('x="418" y="143" text-anchor="start"');
    expect(arabicGoogle.svg).toContain("font-family=\"'Noto Sans Arabic'");
    expect(arabicPoster.svg).toContain('x="358" y="58" text-anchor="start"');
    expect(arabicPoster.svg).toContain("font-family=\"'Noto Sans Arabic'");
    const [arabicGoogleRaster, arabicPosterRaster] = await Promise.all([
      sharp(Buffer.from(arabicGoogle.svg)).png().metadata(),
      sharp(Buffer.from(arabicPoster.svg)).png().metadata(),
    ]);
    expect([arabicGoogleRaster.width, arabicGoogleRaster.height]).toEqual([460, 564]);
    expect([arabicPosterRaster.width, arabicPosterRaster.height]).toEqual([460, 532]);

    const [{ browser: englishGoogle }, { browser: englishPoster }] = await Promise.all([
      renderPair("en", "GOOGLE_WALLET"),
      renderPair("en", "APPLE_IOS27"),
    ]);
    expect(englishGoogle.svg).toContain('font-family="Google Sans,Roboto,Arial,sans-serif"');
    expect(englishPoster.svg).toContain(
      'font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif"',
    );

    const dashboardStyles = readFileSync("apps/merchant-dashboard/app/globals.css", "utf8");
    expect(dashboardStyles).toContain(
      ':is([data-wallet-artwork-render-plan], [data-wallet-provider])[lang="ar"]',
    );
  });

  it("shows Legacy back fields separately while preserving the compact Apple front", async () => {
    const { browserInput } = await renderPair("en", "APPLE_LEGACY");
    const preview = renderDashboardWalletPreviewSvg({
      ...browserInput,
      memberName: "Amina Hassan",
      status: "Active",
    });

    expect([preview.width, preview.height]).toEqual([460, 760]);
    expect(preview.svg).toContain('data-apple-front-surface="true" x="24" y="20"');
    expect(preview.svg).toContain('data-apple-back-details-preview="true"');
    expect(preview.svg).toContain('data-apple-pass-face="back"');
    expect(preview.svg).toContain('data-apple-back-field="program"');
    expect(preview.svg).toContain('data-apple-back-field="member"');
    expect(preview.svg).toContain('data-apple-back-field="status"');
    expect(preview.svg).toContain("Amina Hassan");
    expect(preview.svg).toContain("Active");
    expect(preview.svg).toContain('y="633" width="412" height="107"');
  });

  it("uses a deterministic readable Google native foreground on dark and light surfaces", async () => {
    const { browserInput } = await renderPair("en", "GOOGLE_WALLET");
    const dark = renderDashboardWalletPreviewSvg({
      ...browserInput,
      backgroundColor: "#171A20",
      foregroundColor: "#202124",
    });
    const light = renderDashboardWalletPreviewSvg({
      ...browserInput,
      backgroundColor: "#F5E5D2",
      foregroundColor: "#2A1710",
    });
    expect(dark.svg).toContain('data-google-native-identity="true"');
    expect(dark.svg).toContain('fill="#FFFFFF"');
    expect(light.svg).toContain('fill="#2A1710"');
    expect(walletArtworkContrastRatio("#FFFFFF", "#171B22")).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    [
      "en",
      "An intentionally long English merchant and reward description that must remain inside the Apple poster",
    ],
    [
      "ar",
      "وصف عربي طويل جداً للتاجر والبرنامج والمكافأة يجب أن يبقى ضمن حدود بطاقة آبل دون أن يخرج منها",
    ],
  ] as const)(
    "bounds long %s iOS 27+ text inside the canonical Poster viewport",
    async (locale, longText) => {
      const { browserInput } = await renderPair(locale, "APPLE_IOS27");
      const plan = createDashboardWalletPreviewArtworkPlan({
        ...browserInput,
        organizationName: longText,
        programName: longText,
        rewardSummary: longText,
      });
      const preview = renderDashboardWalletPreviewSvg({
        ...browserInput,
        organizationName: longText,
        programName: longText,
        rewardSummary: longText,
      });
      expect(plan.posterPlan).toBeDefined();
      const poster = plan.posterPlan;
      if (!poster) throw new Error("Apple Poster plan is required for iOS 27+.");
      expect(poster.master.destination.width / poster.master.sourceBounds.width).toBeCloseTo(
        poster.master.destination.height / poster.master.sourceBounds.height,
        12,
      );
      expect(preview.svg).toContain('clip-path="url(#apple-poster-card-clip)"');
      expect(preview.svg).not.toMatch(/<text[^>]+x="-/u);
      if (locale === "ar") expect(preview.svg).toContain('text-anchor="end"');
    },
  );

  it("uses the one shared artwork plan rather than a Dashboard-local compositor", async () => {
    const { browser, browserInput, stamp } = await renderPair("ar", "GOOGLE_WALLET");
    const planInput = {
      stampArtwork: { svg: stamp.svg, ...browserInput.stampArtwork },
      stampSize: browserInput.stampArtwork.stampSize,
      layoutType: "GRID" as const,
      theme: {
        backgroundColor: browserInput.backgroundColor,
        foregroundColor: browserInput.foregroundColor,
        accentColor: browserInput.accentColor,
        secondaryColor: browserInput.secondaryColor,
      },
      currentStampCount: browserInput.progress,
      requiredStampCount: browserInput.goal,
      rewardReady: false,
      rewardLabel: browserInput.rewardSummary,
      organizationName: browserInput.organizationName,
      programName: browserInput.programName,
      memberName: "Preview member",
      credentialPayload: "waflo-wallet-preview-only",
      locale: browserInput.locale,
    };
    const plan = createWalletArtworkRenderPlan(planInput, "GOOGLE_HERO");
    const artwork = renderWalletArtworkPlanSvg(plan, planInput);

    expect(plan.width).toBe(1032);
    expect(plan.height).toBe(812);
    expect(plan.qr?.payload).toEqual({ left: 799, top: 570, width: 169, height: 169 });
    expect(artwork).toContain('data-wallet-artwork-render-plan="v1"');
    expect(artwork).toContain('data-wallet-plan-layer="stamp"');
    expect(artwork).toContain('data-wallet-plan-layer="qr"');
    expect(browser.svg).toContain('data-production-wallet-artwork="GOOGLE_HERO"');

    const dashboardSource = readFileSync(
      "apps/merchant-dashboard/components/dashboard-wallet-preview.tsx",
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//gu, "");
    expect(dashboardSource).toContain("renderDashboardWalletPreviewSvg");
    expect(dashboardSource).not.toMatch(/modernArtwork|legacyArtwork|stampPanelRegion/);
  });

  it("carries a newly selected custom stamp through the local shared render plan", () => {
    const customStamp =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
    const fallback = renderStampSvg({
      goal: 8,
      progress: 1,
      layout: "GRID",
      outputProfile: "APPLE_WALLET",
      filledColor: base.accentColor,
      emptyColor: base.secondaryColor,
    });
    const selected = renderStampSvg({
      goal: 8,
      progress: 1,
      layout: "GRID",
      outputProfile: "APPLE_WALLET",
      filledColor: base.accentColor,
      emptyColor: base.secondaryColor,
      filledArtwork: { kind: "data-uri", value: customStamp, mimeType: "image/png", trusted: true },
    });
    expect(selected.digest).not.toBe(fallback.digest);
    expect(selected.svg).toContain(customStamp);

    const dashboardSource = readFileSync(
      "apps/merchant-dashboard/components/dashboard-wallet-preview.tsx",
      "utf8",
    );
    expect(dashboardSource).toContain('"STAMP_256"');
    expect(dashboardSource).toContain("assetDataUriCache.delete(source)");
    expect(dashboardSource).toContain("retry a transient first miss");
    expect(dashboardSource).not.toContain("/programs/preview");
  });

  it("matches the server QR module pixels from the shared plan", async () => {
    const { browserInput } = await renderPair("en", "GOOGLE_WALLET");
    const request = dashboardWalletPreviewQrRasterRequest(browserInput);
    expect(request).toEqual({
      value: "waflo-wallet-preview-only",
      width: 169,
      margin: 1,
      errorCorrectionLevel: "Q",
    });
    const [serverPng, browserDataUri] = await Promise.all([
      createQrPng(request.value, request),
      createQrPreviewPngDataUri(request.value, request),
    ]);
    const markup = createQrPreviewRasterMarkup(request.value, request);
    const markupPng = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${markup.width}" height="${markup.width}">${markup.markup}</svg>`,
      ),
    )
      .ensureAlpha()
      .raw()
      .toBuffer();
    const serverRaw = await sharp(serverPng).ensureAlpha().raw().toBuffer();
    const browserRaw = Buffer.from(browserDataUri.split(",", 2)[1] ?? "", "base64");

    expect(markupPng).toEqual(serverRaw);
    expect(await sharp(browserRaw).ensureAlpha().raw().toBuffer()).toEqual(serverRaw);
  });

  it("contains every Google issuer mark inside the native circular plate and uses Waflo when none is uploaded", async () => {
    const { browserInput } = await renderPair("en", "GOOGLE_WALLET");
    const fallback = renderDashboardWalletPreviewSvg(browserInput);
    const uploaded = renderDashboardWalletPreviewSvg({
      ...browserInput,
      merchantBrandLogoDataUri:
        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iNDAiPjxyZWN0IHdpZHRoPSIxMDAiIGhlaWdodD0iNDAiIGZpbGw9IiNFNDU3MkUiLz48L3N2Zz4=",
    });

    expect(fallback.svg).toContain('id="google-issuer-clip-48-45-34-34"');
    expect(fallback.svg).toContain('<circle cx="65" cy="62" r="17" fill="#FFFFFF"/>');
    expect(fallback.svg).toContain('stroke="#fff"');
    expect(uploaded.svg).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(uploaded.svg).toContain('clip-path="url(#google-issuer-clip-48-45-34-34)"');
  });
});
