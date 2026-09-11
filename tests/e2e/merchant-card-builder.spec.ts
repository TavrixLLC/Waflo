import { mkdir, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { builderPreviewMedia, expectBuilderPreviewReady } from "./preview-assertions";
import { mockTemplateGalleryApi } from "./template-gallery-fixtures";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: a manual local browser run chooses its evidence destination.
const stagingRepairEvidenceDirectory = process.env.WAFLO_STAGING_REPAIR_EVIDENCE_DIR;

async function captureStagingRepairEvidence(target: Page, filename: string): Promise<void> {
  if (!stagingRepairEvidenceDirectory) return;
  await target.screenshot({
    path: `${stagingRepairEvidenceDirectory}/${filename}`,
    animations: "disabled",
  });
}

function allTemplates(page: Page) {
  return page.locator('section[aria-labelledby="template-gallery-all-title"]');
}

async function enterBuilder(page: Page, templateName = "Classic Roast"): Promise<void> {
  await page.goto("/en/dashboard/programs/new");
  await allTemplates(page)
    .getByRole("button", { name: `Preview: ${templateName}, all templates` })
    .click();
  await page
    .getByRole("dialog", { name: templateName })
    .getByRole("button", { name: "Use this template" })
    .click();
  await expect(page).toHaveURL(/\/en\/dashboard\/programs\/created-program-id\/edit$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Customize your loyalty card" }),
  ).toBeVisible();
}

async function addCardLanguage(page: Page, englishName: string): Promise<void> {
  const picker = page.getByRole("combobox", { name: "Add language" });
  await picker.fill(englishName);
  await page.getByRole("option", { name: new RegExp(`^${englishName}\\b`, "u") }).click();
  await expect(
    page.getByRole("list", { name: "Enabled languages" }).getByText(englishName, { exact: true }),
  ).toBeVisible();
}

test("uses the organization brand as the unmirrored issuer mark in every Builder preview", async ({
  page,
}) => {
  const merchantBrandLogoDataUri = `data:image/svg+xml;base64,${Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="20" fill="#125B72"/><path d="M26 28h44L48 70z" fill="#F8E3B1"/></svg>',
    "utf8",
  ).toString("base64")}`;
  let previewRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/preview")) previewRequests += 1;
  });
  await mockTemplateGalleryApi(page, {
    merchantBrandLogoDataUri,
  });
  await enterBuilder(page);

  for (const [tab] of [
    ["Apple Legacy", "APPLE_WALLET"],
    ["Apple iOS 27+", "APPLE_WALLET"],
    ["Google Wallet", "GOOGLE_WALLET"],
  ] as const) {
    await page.getByRole("tab", { name: tab }).click();
    await expect
      .poll(() =>
        page.locator(".builder-preview-desktop .wallet-preview-image-stack__canvas").innerHTML(),
      )
      .toContain(merchantBrandLogoDataUri);
  }

  await page.goto("/ar/dashboard/programs/created-program-id/edit");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("tab", { name: /Apple Legacy/u }).click();
  await expect
    .poll(() =>
      page.locator(".builder-preview-desktop .wallet-preview-image-stack__canvas").innerHTML(),
    )
    .toContain(merchantBrandLogoDataUri);
  expect(previewRequests).toBe(0);
  await expectBuilderPreviewReady(page.locator(".builder-preview-desktop"));
});

test("captures local frontend wallet preview evidence without a preview endpoint", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const evidenceDirectory =
    "C:/Users/Alhamza Nazhan/Desktop/TestRES/wallet-preview-frontend-parity/iteration-03-shared-rasterizer";
  await mkdir(evidenceDirectory, { recursive: true });
  const merchantBrandLogoDataUri = `data:image/svg+xml;base64,${Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="20" fill="#125B72"/><path d="M20 48h56M48 20v56" stroke="#F8E3B1" stroke-width="10"/></svg>',
    "utf8",
  ).toString("base64")}`;
  let previewRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/preview")) previewRequests += 1;
  });
  await mockTemplateGalleryApi(page, { merchantBrandLogoDataUri });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterBuilder(page);

  const preview = page.locator(".builder-preview-desktop");
  await expectBuilderPreviewReady(preview, "en");
  await expect(preview.locator("[data-wallet-artwork-render-plan]").first()).toBeVisible();
  await expect(
    preview.locator("[data-wallet-artwork-transport=inline-plan]").first(),
  ).toBeVisible();
  const fontProof: Record<string, unknown> = await page.evaluate(async () => {
    // The preview is an inline SVG and its Arabic-script scenarios are
    // selected later in this evidence flow. Explicitly load the approved
    // faces before the first capture so a font-display swap cannot produce
    // an invalid parity capture.
    await Promise.all([
      document.fonts.load("16px Manrope", "Waflo"),
      document.fonts.load('16px "Noto Sans Arabic"', "ع"),
      document.fonts.load("16px Cairo", "ع"),
    ]);
    await document.fonts.ready;
    const root = getComputedStyle(document.body);
    const configuredNoto = root.getPropertyValue("--font-noto-sans-arabic").trim();
    const configuredCairo = root.getPropertyValue("--font-cairo").trim();
    const fontFaces = [...document.fonts].map((face) => ({
      family: face.family,
      status: face.status,
    }));
    const loadedFace = (family: string) =>
      fontFaces.some((face) => face.family.includes(family) && face.status === "loaded");
    return {
      documentFontsReady: document.fonts.status === "loaded",
      computedBodyFont: getComputedStyle(document.body).fontFamily,
      configuredNoto,
      configuredCairo,
      notoSansArabicLoaded: loadedFace("Noto Sans Arabic"),
      cairoLoaded: loadedFace("Cairo"),
      manropeLoaded: loadedFace("Manrope"),
      declaredFontFaces: fontFaces.sort((left, right) => left.family.localeCompare(right.family)),
      previewFont: getComputedStyle(
        document.querySelector("[data-wallet-artwork-render-plan] text") ?? document.body,
      ).fontFamily,
      locales: {},
    };
  });
  await writeFile(
    `${evidenceDirectory}/font-proof.json`,
    `${JSON.stringify(fontProof, null, 2)}\n`,
    "utf8",
  );
  await page.screenshot({
    path: `${evidenceDirectory}/dashboard-english.png`,
    fullPage: true,
    animations: "disabled",
  });
  await preview.screenshot({
    path: `${evidenceDirectory}/dashboard-logo.png`,
    animations: "disabled",
  });
  await preview.screenshot({
    path: `${evidenceDirectory}/dashboard-live-edit-before.png`,
    animations: "disabled",
  });

  const networkProof: Record<string, number> = {
    initialLogoRender: previewRequests,
  };

  await page
    .getByRole("button", { name: /^Reward/u })
    .first()
    .click();
  await page.getByRole("tab", { name: /English/u }).click();
  await page
    .getByLabel("What does the customer get?")
    .fill(
      "An intentionally long reward summary proves the exact shared text wrapping path remains stable.",
    );
  networkProof.textEdit = previewRequests - networkProof.initialLogoRender;
  await preview.screenshot({
    path: `${evidenceDirectory}/dashboard-long-content.png`,
    animations: "disabled",
  });
  await preview.screenshot({
    path: `${evidenceDirectory}/dashboard-live-edit-after.png`,
    animations: "disabled",
  });

  await page
    .getByRole("button", { name: /^Appearance/u })
    .first()
    .click();
  await page.locator(".builder-color-control").nth(2).locator("input").nth(1).fill("#146C94");
  networkProof.colorEdit = previewRequests - networkProof.initialLogoRender - networkProof.textEdit;
  await preview.screenshot({
    path: `${evidenceDirectory}/dashboard-custom-colors.png`,
    animations: "disabled",
  });

  await page
    .getByRole("button", { name: /^Languages/u })
    .first()
    .click();
  await addCardLanguage(page, "Arabic");
  const localePicker = page.getByRole("combobox", { name: "Add language" });
  await localePicker.fill("Sorani");
  await page.getByRole("option", { name: /^Kurdish \(Sorani\)/u }).click();
  await localePicker.fill("Badini");
  await page.getByRole("option", { name: /^Kurdish \(Badini\)/u }).click();

  for (const [optionName, locale, providerTab, filename] of [
    [/^Arabic\b/u, "ar", "Apple iOS 27+", "dashboard-arabic.png"],
    [/^Kurdish \(Sorani\)/u, "ckb", "Google Wallet", "dashboard-sorani.png"],
    [/^Kurdish \(Badini\)/u, "ku-Arab-IQ", "Google Wallet", "dashboard-badini.png"],
  ] as const) {
    await preview.locator(".builder-preview-language").getByRole("combobox").click();
    await page.getByRole("option", { name: optionName }).click();
    await preview.getByRole("tab", { name: providerTab }).click();
    await expectBuilderPreviewReady(preview, locale);
    const localeFontProof = await page.evaluate(async () => {
      await document.fonts.ready;
      const plan = document.querySelector(
        ".builder-preview-desktop [data-wallet-artwork-render-plan]",
      );
      const text = plan?.querySelector("text");
      const styleRules = [...document.styleSheets].flatMap((sheet) => {
        try {
          return [...sheet.cssRules].map((rule) => rule.cssText);
        } catch {
          return [];
        }
      });
      return {
        inlinePlan: plan?.getAttribute("data-wallet-artwork-render-plan") ?? null,
        planLocale: plan?.getAttribute("lang") ?? null,
        matchesArabicSelector:
          plan?.matches('[data-wallet-artwork-render-plan][lang="ar"]') ?? false,
        matchingStyleRuleLoaded: styleRules.some((rule) =>
          rule.includes("wallet-artwork-render-plan"),
        ),
        computedTextFont: getComputedStyle(text ?? document.body).fontFamily,
        textSamples: [...(plan?.querySelectorAll("text") ?? [])].slice(0, 8).map((node) => ({
          content: node.textContent,
          attributeFont: node.getAttribute("font-family"),
          computedFont: getComputedStyle(node).fontFamily,
        })),
      };
    });
    fontProof.locales = {
      ...(fontProof.locales as Record<string, unknown>),
      [locale]: localeFontProof,
    };
    await page.screenshot({
      path: `${evidenceDirectory}/${filename}`,
      fullPage: true,
      animations: "disabled",
    });
  }

  networkProof.localeEdit =
    previewRequests -
    networkProof.initialLogoRender -
    networkProof.textEdit -
    networkProof.colorEdit;

  await page
    .getByRole("button", { name: /^Appearance/u })
    .first()
    .click();
  const cropUpload = await sharp({
    create: {
      width: 64,
      height: 40,
      channels: 4,
      background: { r: 18, g: 91, b: 114, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const beforeCropEdit = previewRequests;
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "local-preview-crop-proof.png",
    mimeType: "image/png",
    buffer: cropUpload,
  });
  const cropDialog = page.getByRole("dialog", { name: "Crop image safely" });
  await expect(cropDialog).toBeVisible();
  await cropDialog.getByRole("slider", { name: "Zoom" }).fill("1.2");
  await expect(cropDialog.getByRole("slider", { name: "Zoom" })).toHaveValue("1.2");
  await cropDialog.getByRole("button", { name: "Cancel" }).click();
  networkProof.cropZoomEdit = previewRequests - beforeCropEdit;

  await writeFile(
    `${evidenceDirectory}/font-and-network-proof.json`,
    `${JSON.stringify({ fontProof, networkProof }, null, 2)}\n`,
    "utf8",
  );

  expect(previewRequests).toBe(0);
  expect(networkProof).toEqual({
    initialLogoRender: 0,
    textEdit: 0,
    colorEdit: 0,
    localeEdit: 0,
    cropZoomEdit: 0,
  });
});

test("switches among the three explicit legacy Apple, iOS 27+, and Google previews", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page);
  await enterBuilder(page);
  const preview = page.locator(".builder-preview-desktop");

  for (const label of ["Apple Legacy", "Apple iOS 27+", "Google Wallet"] as const) {
    const tab = page.getByRole("tab", { name: label });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    const media = await expectBuilderPreviewReady(preview);
    await expect(media).toHaveAttribute("aria-label", `${label} Preview only`);
  }
  await expect(page.getByRole("tab", { name: "Customer" })).toHaveCount(0);
  await expect(page.getByText("Stamp arrangement", { exact: true })).toHaveCount(0);
});

test("keeps each inline Wallet card centered inside its constrained preview frame", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterBuilder(page);
  const preview = page.locator(".builder-preview-desktop");

  for (const label of ["Apple Legacy", "Apple iOS 27+", "Google Wallet"] as const) {
    await preview.getByRole("tab", { name: label }).click();
    await expectBuilderPreviewReady(preview);
    const alignment = await preview.locator(".builder-preview-canvas").evaluate((frame) => {
      const card = frame.querySelector<HTMLElement>(".wallet-preview-image-stack");
      if (!card) throw new Error("Wallet card is missing.");
      const frameBounds = frame.getBoundingClientRect();
      const cardBounds = card.getBoundingClientRect();
      return {
        leadingSpace: cardBounds.left - frameBounds.left,
        trailingSpace: frameBounds.right - cardBounds.right,
        topSpace: cardBounds.top - frameBounds.top,
        bottomSpace: frameBounds.bottom - cardBounds.bottom,
      };
    });
    expect(Math.abs(alignment.leadingSpace - alignment.trailingSpace), label).toBeLessThanOrEqual(
      1,
    );
    expect(alignment.topSpace, label).toBeGreaterThanOrEqual(-1);
    expect(alignment.bottomSpace, label).toBeGreaterThanOrEqual(-1);
    if (label !== "Apple iOS 27+") continue;
    const artworkBounds = await preview.locator(".builder-preview-canvas").evaluate((frame) => {
      const root = frame.querySelector<SVGSVGElement>(
        ".wallet-preview-image-stack__canvas > span > svg",
      );
      const poster = frame.querySelector<SVGGraphicsElement>(
        '[data-production-wallet-artwork="APPLE_POSTER"]',
      );
      const coordinateMap = frame.querySelector<SVGGElement>(
        "[data-wallet-artwork-coordinate-map=canonical-viewbox]",
      );
      const master = frame.querySelector<SVGGraphicsElement>(
        '[data-wallet-plan-layer="apple-google-master"]',
      );
      const reward = [...frame.querySelectorAll<SVGTextElement>("text")].find(
        (node) => node.textContent === "REWARD",
      );
      if (!root || !poster || !coordinateMap || !master || !reward)
        throw new Error("Apple Poster artwork is incomplete.");
      const sourceViewport = master.querySelector<SVGGElement>(
        "[data-wallet-artwork-inline-viewport=true]",
      );
      const aspect = root.getAttribute("data-apple-poster-aspect")?.split(":").map(Number);
      const sourceViewBox = sourceViewport
        ?.getAttribute("data-wallet-artwork-source-view-box")
        ?.split(/\s+/u)
        .map(Number);
      const [posterWidth = Number.NaN, posterHeight = Number.NaN] = aspect ?? [];
      const [
        sourceX = Number.NaN,
        sourceY = Number.NaN,
        sourceWidth = Number.NaN,
        sourceHeight = Number.NaN,
      ] = sourceViewBox ?? [];
      if (
        !sourceViewport ||
        !Number.isFinite(posterWidth) ||
        !Number.isFinite(posterHeight) ||
        !Number.isFinite(sourceX) ||
        !Number.isFinite(sourceY) ||
        !Number.isFinite(sourceWidth) ||
        !Number.isFinite(sourceHeight)
      )
        throw new Error("Apple Poster viewport metadata is incomplete.");
      const screenBounds = (
        element: SVGGraphicsElement,
        x: number,
        y: number,
        width: number,
        height: number,
      ) => {
        const matrix = element.getScreenCTM();
        if (!matrix) throw new Error("Apple Poster viewport has no screen matrix.");
        const points = [
          new DOMPoint(x, y).matrixTransform(matrix),
          new DOMPoint(x + width, y).matrixTransform(matrix),
          new DOMPoint(x, y + height).matrixTransform(matrix),
          new DOMPoint(x + width, y + height).matrixTransform(matrix),
        ];
        return {
          left: Math.min(...points.map((point) => point.x)),
          right: Math.max(...points.map((point) => point.x)),
        };
      };
      const rootBounds = root.getBoundingClientRect();
      const posterBounds = screenBounds(coordinateMap, 0, 0, posterWidth, posterHeight);
      const masterBounds = screenBounds(master, sourceX, sourceY, sourceWidth, sourceHeight);
      const rewardBounds = reward.getBoundingClientRect();
      return {
        rootBounds,
        posterBounds,
        masterBounds,
        rewardBounds,
        nestedSvgCount: coordinateMap.querySelectorAll("svg").length,
      };
    });
    expect(artworkBounds.nestedSvgCount).toBe(0);
    expect(artworkBounds.posterBounds.left).toBeGreaterThanOrEqual(artworkBounds.rootBounds.left);
    expect(artworkBounds.posterBounds.right).toBeLessThanOrEqual(artworkBounds.rootBounds.right);
    expect(artworkBounds.masterBounds.left).toBeGreaterThanOrEqual(artworkBounds.posterBounds.left);
    expect(artworkBounds.masterBounds.right).toBeLessThanOrEqual(artworkBounds.posterBounds.right);
    expect(artworkBounds.rewardBounds.left).toBeGreaterThanOrEqual(artworkBounds.masterBounds.left);
    expect(artworkBounds.rewardBounds.right).toBeLessThanOrEqual(artworkBounds.masterBounds.right);
    await captureStagingRepairEvidence(page, "03-ios27-ltr-desktop.png");
  }
});

test("uniformly contains the canonical iOS 27+ artwork in the mobile preview sheet", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page);
  await page.setViewportSize({ width: 360, height: 844 });
  await enterBuilder(page);

  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator(".builder-mobile-preview-action").click();
    const sheet = page.locator(".builder-preview-modal");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("tab", { name: "Apple iOS 27+" }).click();
    await expectBuilderPreviewReady(sheet);

    const geometry = await sheet.locator(".builder-preview-canvas").evaluate((frame) => {
      const card = frame.querySelector<HTMLElement>(".wallet-preview-image-stack");
      const root = frame.querySelector<SVGSVGElement>(
        ".wallet-preview-image-stack__canvas > span > svg",
      );
      if (!card || !root) throw new Error("Mobile iOS 27+ preview is incomplete.");
      const frameBounds = frame.getBoundingClientRect();
      const cardBounds = card.getBoundingClientRect();
      const rootBounds = root.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        frameBounds,
        cardBounds,
        rootBounds,
        rootAspectRatio: rootBounds.width / rootBounds.height,
      };
    });

    expect(geometry.documentWidth, String(width)).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.cardBounds.left, String(width)).toBeGreaterThanOrEqual(
      geometry.frameBounds.left - 1,
    );
    expect(geometry.cardBounds.right, String(width)).toBeLessThanOrEqual(
      geometry.frameBounds.right + 1,
    );
    expect(geometry.cardBounds.top, String(width)).toBeGreaterThanOrEqual(
      geometry.frameBounds.top - 1,
    );
    expect(geometry.cardBounds.bottom, String(width)).toBeLessThanOrEqual(
      geometry.frameBounds.bottom + 1,
    );
    expect(geometry.rootBounds.left, String(width)).toBeGreaterThanOrEqual(
      geometry.cardBounds.left - 1,
    );
    expect(geometry.rootBounds.right, String(width)).toBeLessThanOrEqual(
      geometry.cardBounds.right + 1,
    );
    expect(geometry.rootAspectRatio, String(width)).toBeGreaterThan(0.7);
    expect(geometry.rootAspectRatio, String(width)).toBeLessThan(1.1);
    if (width === 360) await captureStagingRepairEvidence(page, "06-ios27-mobile-360.png");
    if (width === 390) await captureStagingRepairEvidence(page, "07-ios27-mobile-390.png");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }
});

test("builds one continuously saved card with combined languages and lazy truthful previews", async ({
  page,
}) => {
  const createBodies: Record<string, unknown>[] = [];
  const patchBodies: Record<string, unknown>[] = [];
  await mockTemplateGalleryApi(page, {
    onCreate: (body) => createBodies.push(body),
    onPatch: (body) => patchBodies.push(body),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterBuilder(page);

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByText("Classic Roast", { exact: true })).toBeVisible();
  await expect(page.getByText("Quick Mode", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".builder-preview-desktop")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Card builder sections" })).toBeVisible();
  for (const section of [
    "Languages",
    "Basics",
    "Reward",
    "Locations",
    "Appearance",
    "Review & validate",
    "Advanced settings",
  ]) {
    await expect(
      page.getByRole("button", { name: new RegExp(section, "u") }).first(),
    ).toBeVisible();
  }

  await addCardLanguage(page, "Arabic");
  await expect
    .poll(() =>
      patchBodies.some(
        (body) => Array.isArray(body.enabledLocales) && body.enabledLocales.includes("ar"),
      ),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: /^Basics/u })
    .first()
    .click();
  await page.getByLabel("Exact stamp goal").fill("10");
  await expect.poll(() => patchBodies.at(-1)?.requiredStampCount).toBe(10);
  await page
    .getByRole("button", { name: /^Reward/u })
    .first()
    .click();
  await page.getByRole("tab", { name: /English/u }).click();
  await page.getByLabel("What does the customer get?").fill("Free house roast");
  await expect
    .poll(
      () =>
        (patchBodies.at(-1)?.translations as Record<string, Record<string, unknown>> | undefined)
          ?.en?.rewardSummary ?? "",
    )
    .toBe("Free house roast");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(createBodies).toHaveLength(1);
  expect(patchBodies.at(-1)).toMatchObject({
    requiredStampCount: 10,
    templateCode: "COFFEE",
    revision: 3,
    translations: { en: { rewardSummary: "Free house roast" } },
  });
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
  expect(
    accessibility.violations.filter((violation) =>
      ["landmark-main-is-top-level", "landmark-no-duplicate-main", "landmark-unique"].includes(
        violation.id,
      ),
    ),
  ).toEqual([]);

  await page
    .getByRole("button", { name: /^Languages/u })
    .first()
    .click();
  const englishTab = page.getByRole("tab", { name: /English/u });
  await expect(englishTab).toBeVisible();
  await expect(page.getByRole("tab", { name: /العربية/u })).toBeVisible();
  await englishTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /العربية/u })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".builder-language-panel")).toHaveAttribute("dir", "rtl");

  await page.getByRole("tab", { name: "Apple Legacy" }).click();
  await page.getByRole("tab", { name: "Google Wallet" }).click();

  await page.reload();
  await page
    .getByRole("button", { name: /^Basics/u })
    .first()
    .click();
  await expect(page.getByLabel("Exact stamp goal")).toHaveValue("10");
  await page
    .getByRole("button", { name: /^Reward/u })
    .first()
    .click();
  await expect(page.getByLabel("What does the customer get?")).toHaveValue("Free house roast");

  await page.goBack();
  await expect(
    page.getByRole("heading", { level: 1, name: "Choose a starting design" }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { level: 1, name: "Customize your loyalty card" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /^Basics/u })
    .first()
    .click();
  await expect(page.getByLabel("Exact stamp goal")).toHaveValue("10");
  expect(createBodies).toHaveLength(1);
});

test("changes the starting design on the same Program while preserving merchant data", async ({
  page,
}) => {
  const createBodies: Record<string, unknown>[] = [];
  const patchBodies: Record<string, unknown>[] = [];
  await mockTemplateGalleryApi(page, {
    onCreate: (body) => createBodies.push(body),
    onPatch: (body) => patchBodies.push(body),
  });
  await enterBuilder(page);
  await page
    .getByRole("button", { name: /^Reward/u })
    .first()
    .click();
  await page.getByLabel("What does the customer get?").fill("Signature house drink");
  await expect.poll(() => patchBodies.length).toBe(1);

  await page.getByRole("button", { name: "Change design" }).click();
  const warning = page.getByRole("dialog", { name: "Change this design?" });
  await expect(warning).toContainText("Your card name, reward, languages, goal, locations");
  await warning.getByRole("button", { name: "Choose another design" }).click();
  await expect(page).toHaveURL(/\/programs\/new\?changeFor=created-program-id$/u);

  const preview = allTemplates(page).getByRole("button", {
    name: "Preview: Dark Espresso, all templates",
  });
  await preview.click();
  await page
    .getByRole("dialog", { name: "Dark Espresso" })
    .getByRole("button", { name: "Use this template" })
    .click();

  await expect(page).toHaveURL(/\/programs\/created-program-id\/edit$/u);
  await expect(page.getByText("Dark Espresso", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: /^Reward/u })
    .first()
    .click();
  await expect(page.getByLabel("What does the customer get?")).toHaveValue("Signature house drink");
  expect(createBodies).toHaveLength(1);
  expect(patchBodies.at(-1)).toMatchObject({
    templateCode: "COFFEE_DARK_ESPRESSO",
    translations: { en: { rewardSummary: "Signature house drink" } },
  });
});

test("renders truthful 0/8, 4/8, and 8/8 Grid-only Wallet Builder previews", async ({ page }) => {
  let previewRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/preview")) previewRequests += 1;
  });
  await mockTemplateGalleryApi(page);
  await enterBuilder(page);
  const slider = page.locator('.builder-preview-desktop input[type="range"]');
  const media = builderPreviewMedia(page.locator(".builder-preview-desktop"));

  for (const progress of [0, 4, 8]) {
    await slider.evaluate((element, value) => {
      const input = element as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, progress);
    for (const [label, profile] of [
      ["Apple Legacy", "APPLE_WALLET"],
      ["Apple iOS 27+", "APPLE_WALLET"],
      ["Google Wallet", "GOOGLE_WALLET"],
    ] as const) {
      await page.getByRole("tab", { name: label }).click();
      const artworkTarget =
        label === "Apple iOS 27+"
          ? "APPLE_POSTER"
          : profile === "APPLE_WALLET"
            ? "APPLE_STORE_CARD_STRIP"
            : "GOOGLE_HERO";
      await expect
        .poll(() => media.innerHTML())
        .toContain(`data-production-wallet-artwork="${artworkTarget}"`);
      const previewSvg = await media.innerHTML();
      expect(previewSvg, `${label} ${progress}/8`).toContain(
        `data-production-wallet-artwork="${artworkTarget}"`,
      );
      expect(previewSvg, `${label} ${progress}/8`).toContain(`data-progress="${progress}"`);
      expect(previewSvg, `${label} ${progress}/8`).not.toContain('data-visual-state="MILESTONE"');
    }
  }

  expect(previewRequests).toBe(0);

  await expect(
    page.getByText(/CUSTOMER_WEB|APPLE_WALLET|GOOGLE_WALLET|ProgramVersion|Draft revision/u),
  ).toHaveCount(0);
});

test("updates the inline Wallet preview immediately without a server preview request", async ({
  page,
}) => {
  let previewRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/preview")) previewRequests += 1;
  });
  await mockTemplateGalleryApi(page);
  await enterBuilder(page);
  const preview = page.locator(".builder-preview-desktop");
  await expect(preview.locator(".builder-preview-empty")).toHaveCount(0);
  await expectBuilderPreviewReady(preview);

  await page.getByRole("tab", { name: "Apple iOS 27+" }).click();
  await expectBuilderPreviewReady(preview);
  const beforeTextEdit = await builderPreviewMedia(preview).innerHTML();

  await page
    .getByRole("button", { name: /^Reward/u })
    .first()
    .click();
  await page.getByRole("tab", { name: /English/u }).click();
  await page.getByLabel("What does the customer get?").fill("Updated coffee reward");
  await expect.poll(() => builderPreviewMedia(preview).innerHTML()).not.toBe(beforeTextEdit);

  await page
    .getByRole("button", { name: /^Appearance/u })
    .first()
    .click();
  const beforeColorEdit = await builderPreviewMedia(preview).innerHTML();
  await page.locator(".builder-color-control").nth(2).locator("input").nth(1).fill("#146C94");
  await expect.poll(() => builderPreviewMedia(preview).innerHTML()).not.toBe(beforeColorEdit);

  await page
    .getByRole("button", { name: /^Languages/u })
    .first()
    .click();
  await addCardLanguage(page, "Arabic");
  await preview.locator(".builder-preview-language").getByRole("combobox").click();
  await page.getByRole("option", { name: /^Arabic\b/u }).click();
  await expect(preview.locator(".builder-preview-canvas")).toHaveAttribute("dir", "rtl");
  expect(previewRequests).toBe(0);
});

test("gives each customer field one owner and presents current built-in artwork", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page);
  await enterBuilder(page);

  await page
    .getByRole("button", { name: /^Basics/u })
    .first()
    .click();
  await expect(page.getByLabel("Card name in your dashboard")).toHaveCount(1);
  await expect(page.getByLabel(/Customer-facing card title/u)).toHaveCount(0);
  await page
    .getByRole("button", { name: /^Reward/u })
    .first()
    .click();
  await expect(page.getByLabel("What does the customer get?")).toHaveCount(1);
  await page
    .getByRole("button", { name: /^Languages/u })
    .first()
    .click();
  await addCardLanguage(page, "Arabic");
  await expect(page.getByLabel("Card name")).toHaveCount(1);
  await expect(page.getByLabel("Reward summary")).toHaveCount(0);
  await page.getByRole("tab", { name: /العربية/u }).click();
  const arabicTitle = page.locator('.builder-language-panel[lang="ar"] input').first();
  await arabicTitle.fill("بطاقة قهوة عربية طويلة للتحقق من اتجاه النص داخل الواجهة الإنجليزية");
  await expect(arabicTitle).toHaveAttribute("dir", "rtl");
  await expect(arabicTitle).toHaveAttribute("lang", "ar");

  await page
    .getByRole("button", { name: /^Appearance/u })
    .first()
    .click();
  await expect(page.getByText("Balanced card", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Upload the first asset", { exact: true })).toHaveCount(0);
  await expect(page.locator(".studio-asset-current")).toHaveCount(2);
  await expect(page.getByText("Currently used", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("heading", { level: 4, name: "Stamped icon" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 4, name: "Empty stamp" })).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".studio-asset-current img")
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
});

test("keeps readiness navigation and server validation on one status truth", async ({ page }) => {
  await mockTemplateGalleryApi(page);
  await enterBuilder(page);
  await page
    .getByRole("button", { name: /^Basics/u })
    .first()
    .click();
  await page.getByLabel("Card name in your dashboard").fill("x");
  await page.getByRole("button", { name: "Review card" }).click();
  const readiness = page.locator(".builder-readiness-list");
  await expect(readiness.getByRole("button", { name: /Basics/u })).toContainText("Fix");
  await expect(page.getByRole("button", { name: "Continue to Studio" })).toBeDisabled();

  await readiness.getByRole("button", { name: /Basics/u }).click();
  await page.getByLabel("Card name in your dashboard").fill("Classic Roast card");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review card" }).click();
  await expect(page.getByText("Readiness checks passed", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Run again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to Studio" })).toBeEnabled();
});

test("surfaces save failure and revision conflict without silently overwriting", async ({
  page,
}) => {
  const patchBodies: Record<string, unknown>[] = [];
  await mockTemplateGalleryApi(page, {
    patchFailures: 1,
    patchConflicts: 1,
    onPatch: (body) => patchBodies.push(body),
  });
  await enterBuilder(page);

  await page
    .getByRole("button", { name: /^Basics/u })
    .first()
    .click();
  await page.getByLabel("Card name in your dashboard").fill("Conflict-safe card");
  await expect(page.getByText("Save failed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.getByText(/Prisma|ProgramVersion|created-program-id/u)).toHaveCount(0);

  await page.getByRole("button", { name: "Retry" }).click();
  const conflict = page.getByRole("dialog", { name: "This draft changed in another editor" });
  await expect(conflict).toBeVisible();
  await conflict.getByRole("button", { name: "Keep my edits" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect.poll(() => patchBodies.length).toBe(3);
  expect(patchBodies.map((body) => body.revision)).toEqual([1, 1, 2]);
});

test("turns review into automatic readiness and continues directly to Studio", async ({ page }) => {
  const observedApiPaths: string[] = [];
  const validationPreviewProfiles: string[] = [];
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (
      ["localhost", "api.waflo.app"].includes(requestUrl.hostname) &&
      requestUrl.pathname.startsWith("/v1/")
    )
      observedApiPaths.push(requestUrl.pathname);
    if (requestUrl.pathname.endsWith("/preview")) {
      validationPreviewProfiles.push(requestUrl.searchParams.get("profile") ?? "");
    }
  });
  await mockTemplateGalleryApi(page);
  await enterBuilder(page);

  await page.getByRole("button", { name: "Review card" }).click();
  await expect(page.getByText("Readiness checks passed", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Publishing remains in Studio/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Test Mode" })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue to Studio" }).click();
  await expect(page).toHaveURL(/\/dashboard\/programs\/created-program-id$/u);
  expect(observedApiPaths.some((path) => path.includes("/test-sessions"))).toBe(false);
  // Review is an explicit server-side validation action. The editor itself
  // remains local; Review materializes exactly the bounded provider evidence.
  expect(validationPreviewProfiles).toEqual(["CUSTOMER_WEB", "APPLE_WALLET", "GOOGLE_WALLET"]);
});

test("blocks a Starter merchant at the real card limit before creating an impossible draft", async ({
  page,
}) => {
  let creates = 0;
  await mockTemplateGalleryApi(page, {
    selectedPlan: "STARTER",
    existingPrograms: [
      {
        id: "existing-card",
        internalName: "Existing card",
        status: "PUBLISHED",
        currentDraftVersion: null,
        currentPublishedVersion: { id: "published", versionNumber: 1, status: "PUBLISHED" },
      },
    ],
    onCreate: () => {
      creates += 1;
    },
  });
  await page.goto("/en/dashboard/programs/new");
  await allTemplates(page)
    .getByRole("button", { name: "Preview: Classic Roast, all templates" })
    .click();
  await page
    .getByRole("dialog", { name: "Classic Roast" })
    .getByRole("button", { name: "Use this template" })
    .click();

  await expect(page.getByText(/reached your plan's active loyalty-card limit/u)).toBeVisible();
  expect(creates).toBe(0);
  await expect(page).toHaveURL(/\/dashboard\/programs\/new$/u);
});

test("keeps Arabic intentional and adapts from split desktop to a mobile preview sheet", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page);
  await enterBuilder(page);
  await addCardLanguage(page, "Arabic");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.goto("/ar/dashboard/programs/created-program-id/edit");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".builder-shell")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await page.getByRole("button", { name: /اللغات/u }).click();
  await page.getByRole("tab", { name: /English/u }).click();
  const englishTitle = page.locator('.builder-language-panel[lang="en"] input').first();
  await englishTitle.fill(
    "Classic Roast loyalty card with a deliberately long English customer-facing name",
  );
  await expect(englishTitle).toHaveAttribute("dir", "ltr");
  await expect(englishTitle).toHaveAttribute("lang", "en");
  await englishTitle.press("Tab");
  await expect.poll(() => englishTitle.evaluate((input) => input.scrollLeft)).toBe(0);
  expect(await englishTitle.evaluate((element) => getComputedStyle(element).direction)).toBe("ltr");
  await page.getByRole("tab", { name: /العربية/u }).click();
  await expect(page.locator(".builder-language-panel")).toHaveAttribute("lang", "ar");
  const arabicTitle = page.getByLabel("اسم البطاقة");
  await expect(arabicTitle).toHaveAttribute("dir", "rtl");
  await expect(arabicTitle).toHaveAttribute("lang", "ar");

  for (const width of [1440, 1280, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".builder-preview-desktop")).toBeHidden();
  const previewAction = page.locator(".builder-mobile-preview-action");
  await expect(previewAction).toHaveText("معاينة");
  await previewAction.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: /معاينة مباشرة/u })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);

  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("tab", { name: "Apple iOS 27+" }).click();
  await expectBuilderPreviewReady(page.locator(".builder-preview-desktop"));
  await captureStagingRepairEvidence(page, "04-ios27-rtl-desktop.png");
  await captureStagingRepairEvidence(page, "05-ios27-long-content.png");
});

test("keeps deliberately long Arabic iOS 27+ content inside its canonical artwork regions", async ({
  page,
}) => {
  const longArabicMerchant =
    "\u0645\u062a\u062c\u0631 \u0627\u0644\u0642\u0647\u0648\u0629 \u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u0644\u0644\u0645\u0643\u0627\u0641\u0622\u062a \u0648\u0627\u0644\u0648\u0644\u0627\u0621 \u0627\u0644\u0645\u062d\u0644\u064a";
  const longArabicTitle =
    "\u0628\u0631\u0646\u0627\u0645\u062c \u0627\u0644\u0632\u0628\u0627\u0626\u0646 \u0627\u0644\u0645\u0645\u064a\u0632 \u0644\u0644\u0642\u0647\u0648\u0629 \u0627\u0644\u064a\u0648\u0645\u064a\u0629 \u0648\u0627\u0644\u0639\u0631\u0648\u0636 \u0627\u0644\u0645\u0633\u062a\u0645\u0631\u0629";
  const longArabicReward =
    "\u0645\u0643\u0627\u0641\u0623\u0629 \u0645\u062c\u0627\u0646\u064a\u0629 \u0645\u0645\u064a\u0632\u0629 \u0645\u0639 \u0627\u062e\u062a\u064a\u0627\u0631 \u0645\u0634\u0631\u0648\u0628 \u0648\u062d\u0644\u0648\u0649 \u0648\u0625\u0636\u0627\u0641\u0627\u062a \u0645\u0648\u0633\u0645\u064a\u0629 \u0637\u0648\u0627\u0644 \u0627\u0644\u064a\u0648\u0645";
  await mockTemplateGalleryApi(page, { merchantName: longArabicMerchant });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterBuilder(page);
  await addCardLanguage(page, "Arabic");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.goto("/ar/dashboard/programs/created-program-id/edit");

  await page.locator('[data-builder-section-link="languages"]').click();
  await page.getByRole("tab", { name: /\u0627\u0644\u0639\u0631\u0628\u064a\u0629/u }).click();
  const title = page.locator('.builder-language-panel[lang="ar"] input').first();
  await title.fill(longArabicTitle);
  await title.press("Tab");
  await expect(page.locator(".builder-save-state--saved")).toBeVisible();

  await page.locator('[data-builder-section-link="reward"]').click();
  await page.getByRole("tab", { name: /\u0627\u0644\u0639\u0631\u0628\u064a\u0629/u }).click();
  const reward = page.locator('[data-builder-section="reward"] input').first();
  await reward.fill(longArabicReward);
  await reward.press("Tab");
  await expect(page.locator(".builder-save-state--saved")).toBeVisible();

  const inspectGeometry = async (container: Locator) =>
    container.locator(".builder-preview-canvas").evaluate((frame) => {
      const root = frame.querySelector<SVGSVGElement>(
        ".wallet-preview-image-stack__canvas > span > svg",
      );
      const master = frame.querySelector<SVGGraphicsElement>(
        '[data-wallet-plan-layer="apple-google-master"]',
      );
      const qr = frame.querySelector<SVGGraphicsElement>('[data-wallet-plan-layer="qr"]');
      const stamp = frame.querySelector<SVGGraphicsElement>('[data-wallet-plan-layer="stamp"]');
      if (!root || !master || !qr || !stamp)
        throw new Error("iOS 27+ artwork layers are incomplete.");
      const rootBounds = root.getBoundingClientRect();
      const masterBounds = master.getBoundingClientRect();
      const screenBounds = (element: SVGGraphicsElement) => {
        const box = element.getBBox();
        const matrix = element.getScreenCTM();
        if (!matrix) throw new Error("Wallet artwork layer has no screen transform.");
        const points = [
          new DOMPoint(box.x, box.y).matrixTransform(matrix),
          new DOMPoint(box.x + box.width, box.y).matrixTransform(matrix),
          new DOMPoint(box.x, box.y + box.height).matrixTransform(matrix),
          new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix),
        ];
        return {
          left: Math.min(...points.map((point) => point.x)),
          right: Math.max(...points.map((point) => point.x)),
          top: Math.min(...points.map((point) => point.y)),
          bottom: Math.max(...points.map((point) => point.y)),
          width:
            Math.max(...points.map((point) => point.x)) -
            Math.min(...points.map((point) => point.x)),
          height:
            Math.max(...points.map((point) => point.y)) -
            Math.min(...points.map((point) => point.y)),
        };
      };
      const qrBounds = screenBounds(qr);
      const stampBounds = screenBounds(stamp);
      const overlaps = (left: DOMRect, right: DOMRect) =>
        left.left < right.right &&
        left.right > right.left &&
        left.top < right.bottom &&
        left.bottom > right.top;
      const textBounds = [...root.querySelectorAll<SVGTextElement>("text")]
        .filter((text) => !text.closest('[data-wallet-plan-layer="stamp"]'))
        .map((text) => ({
          content: text.textContent ?? "",
          anchor: text.getAttribute("text-anchor"),
          bounds: screenBounds(text),
        }))
        .filter((entry) => entry.bounds.width > 0 && entry.bounds.height > 0);
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        rootBounds,
        masterBounds,
        qrBounds,
        stampBounds,
        rootAspect: rootBounds.width / rootBounds.height,
        rootDirection: root.getAttribute("direction"),
        textBounds,
        textOutsideRoot: textBounds.filter(
          ({ bounds }) =>
            bounds.left < rootBounds.left - 1 ||
            bounds.right > rootBounds.right + 1 ||
            bounds.top < rootBounds.top - 1 ||
            bounds.bottom > rootBounds.bottom + 1,
        ),
        textOverlappingQr: textBounds.filter(({ bounds }) => overlaps(bounds, qrBounds)),
        textOverlappingStamp: textBounds.filter(({ bounds }) => overlaps(bounds, stampBounds)),
      };
    });

  const desktopPreview = page.locator(".builder-preview-desktop");
  await desktopPreview.locator(".builder-preview-language").getByRole("combobox").click();
  await page.getByRole("option", { name: /^Arabic\b/u }).click();
  await desktopPreview.getByRole("tab", { name: "Apple iOS 27+" }).click();
  await expectBuilderPreviewReady(desktopPreview, "ar");
  const desktop = await inspectGeometry(desktopPreview);
  expect(desktop.documentWidth).toBeLessThanOrEqual(desktop.viewportWidth + 1);
  expect(desktop.textOutsideRoot).toEqual([]);
  expect(desktop.textOverlappingQr).toEqual([]);
  expect(desktop.textOverlappingStamp).toEqual([]);
  expect(desktop.rootDirection).toBe("rtl");
  const rtlContent = desktop.textBounds.filter(({ content }) =>
    /\u0628\u0631\u0646\u0627\u0645\u062c|\u0645\u0643\u0627\u0641\u0623\u0629/u.test(content),
  );
  expect(rtlContent.length).toBeGreaterThan(0);
  // SVG's logical start is the physical right edge in RTL. The canonical plan
  // positions Arabic x coordinates at that leading edge so text remains in
  // its own clipped region instead of escaping through the right side.
  expect(rtlContent.every(({ anchor }) => anchor === "start")).toBe(true);
  expect(desktop.rootAspect).toBeGreaterThan(0.7);
  expect(desktop.rootAspect).toBeLessThan(1.1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".builder-mobile-preview-action").click();
  const mobilePreview = page.locator(".builder-preview-modal");
  await expect(mobilePreview).toBeVisible();
  await mobilePreview.locator(".builder-preview-language").getByRole("combobox").click();
  await page.getByRole("option", { name: /^Arabic\b/u }).click();
  await mobilePreview.getByRole("tab", { name: "Apple iOS 27+" }).click();
  await expectBuilderPreviewReady(mobilePreview, "ar");
  const mobile = await inspectGeometry(mobilePreview);
  expect(mobile.documentWidth).toBeLessThanOrEqual(mobile.viewportWidth + 1);
  expect(mobile.textOutsideRoot).toEqual([]);
  expect(mobile.textOverlappingQr).toEqual([]);
  expect(mobile.textOverlappingStamp).toEqual([]);
  expect(Math.abs(mobile.rootAspect - desktop.rootAspect)).toBeLessThan(0.01);
  await captureStagingRepairEvidence(page, "05b-ios27-long-arabic.png");
});

test("reserves sticky-footer space and keeps active section navigation visible", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page);
  await enterBuilder(page);
  await page.getByRole("button", { name: "Review card" }).click();
  await expect(page.getByText("Readiness checks passed", { exact: true }).first()).toBeVisible();

  for (const width of [1280, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: width <= 390 ? 780 : 860 });
    const activeNavigation = page.locator(
      '.builder-section-nav [data-builder-section-link="review"]',
    );
    await expect(activeNavigation).toHaveAttribute("aria-current", "page");
    await activeNavigation.scrollIntoViewIfNeeded();
    await expect(activeNavigation).toBeInViewport();
    await page.getByRole("button", { name: "Continue to Studio" }).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 1_000));
    const geometry = await page.evaluate(() => {
      const footer = document.querySelector<HTMLElement>(".builder-footer");
      const editor = document.querySelector<HTMLElement>(".builder-editor");
      const controls = [
        ...(editor?.querySelectorAll<HTMLElement>("button, input, textarea, select") ?? []),
      ].filter((element) => element.getClientRects().length > 0);
      const lastControl = controls.at(-1);
      const dashboardContent = document.querySelector<HTMLElement>(".dashboard-content");
      return {
        bodyWidth: document.body.getBoundingClientRect().width,
        clientWidth: document.documentElement.clientWidth,
        dashboardContentBoxSizing: dashboardContent
          ? getComputedStyle(dashboardContent).boxSizing
          : "missing",
        dashboardContentRect: dashboardContent
          ? {
              left: dashboardContent.getBoundingClientRect().left,
              right: dashboardContent.getBoundingClientRect().right,
              width: dashboardContent.getBoundingClientRect().width,
            }
          : null,
        footerTop: footer?.getBoundingClientRect().top ?? 0,
        innerWidth: window.innerWidth,
        lastControlBottom: lastControl?.getBoundingClientRect().bottom ?? 0,
        scrollX: window.scrollX,
        viewportHeight: window.innerHeight,
        documentOverflow:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
        overflowingElements: [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((element) => {
            if (element.getClientRects().length === 0) return false;
            const rect = element.getBoundingClientRect();
            return rect.left < -0.5 || rect.right > document.documentElement.clientWidth + 0.5;
          })
          .slice(0, 12)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              className: element.className,
              left: Math.round(rect.left * 10) / 10,
              right: Math.round(rect.right * 10) / 10,
              tagName: element.tagName,
              text: element.textContent?.trim().slice(0, 80) ?? "",
            };
          }),
      };
    });
    expect(
      geometry.documentOverflow,
      `${width}px horizontal overflow: ${JSON.stringify(geometry)}`,
    ).toBe(false);
    expect(
      geometry.lastControlBottom <= geometry.footerTop - 4 ||
        geometry.footerTop >= geometry.viewportHeight,
      `${width}px footer overlap: ${JSON.stringify(geometry)}`,
    ).toBe(true);
  }
});

test("coalesces sixty seconds of continuous editing into one save while rendering the preview locally", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const patchBodies: Record<string, unknown>[] = [];
  let previewRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/preview")) previewRequests += 1;
  });
  await mockTemplateGalleryApi(page, {
    onPatch: (body) => patchBodies.push(body),
  });
  await enterBuilder(page);
  await page
    .getByRole("button", { name: /^Basics/u })
    .first()
    .click();
  const internalName = page.getByLabel("Card name in your dashboard");
  const startedAt = Date.now();
  for (let index = 0; index < 120; index += 1) {
    await internalName.fill(`Continuous card edit ${index % 2 === 0 ? "A" : "B"}`);
    await page.waitForTimeout(500);
  }
  const editingMs = Date.now() - startedAt;

  await expect.poll(() => patchBodies.length).toBe(1);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(previewRequests).toBe(0);
  expect(patchBodies).toHaveLength(1);
  expect(editingMs).toBeGreaterThanOrEqual(58_000);
  expect(editingMs).toBeLessThan(90_000);
  console.info(
    `P3 builder edit metrics ${JSON.stringify({ editingMs, patches: patchBodies.length, previewRequests })}`,
  );
});

test("captures the P3 builder journey and old-wizard comparison evidence", async ({ page }) => {
  test.setTimeout(300_000);
  const evidenceDirectory = "test-results/evidence/uiux/create-card-p3";
  await mkdir(evidenceDirectory, { recursive: true });
  await mockTemplateGalleryApi(page, { patchDelayMs: 1_200 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterBuilder(page);
  await addCardLanguage(page, "Arabic");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.screenshot({
    path: `${evidenceDirectory}/01-builder-en-desktop.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.locator(".builder-workspace").screenshot({
    path: `${evidenceDirectory}/03-coffee-template-builder.png`,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: /^Basics/u })
    .first()
    .click();
  await page.locator(".builder-editor").screenshot({
    path: `${evidenceDirectory}/06-basics.png`,
    animations: "disabled",
  });

  await page.goto("/ar/dashboard/programs/created-program-id/edit");
  await expect(page.getByRole("heading", { level: 1, name: "خصّص بطاقة الولاء" })).toBeVisible();
  await page.screenshot({
    path: `${evidenceDirectory}/02-builder-ar-desktop.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.goto("/en/dashboard/programs/created-program-id/edit");
  await expect(
    page.getByRole("heading", { level: 1, name: "Customize your loyalty card" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /^Reward/u })
    .first()
    .click();
  await page.locator(".builder-editor").screenshot({
    path: `${evidenceDirectory}/07-reward.png`,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: /^Languages/u })
    .first()
    .click();
  await page.locator(".builder-editor").screenshot({
    path: `${evidenceDirectory}/08-language-en.png`,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: /العربية/u }).click();
  await page.locator(".builder-editor").screenshot({
    path: `${evidenceDirectory}/09-language-ar.png`,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: /^Locations/u })
    .first()
    .click();
  await page.locator(".builder-editor").screenshot({
    path: `${evidenceDirectory}/10-locations.png`,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: /^Appearance/u })
    .first()
    .click();
  await page.locator(".builder-editor").screenshot({
    path: `${evidenceDirectory}/11-appearance.png`,
    animations: "disabled",
  });

  await page.getByRole("tab", { name: "Apple Legacy" }).click();
  await page.locator(".builder-preview-desktop").screenshot({
    path: `${evidenceDirectory}/12-apple-legacy-preview.png`,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Apple iOS 27+" }).click();
  await page.locator(".builder-preview-desktop").screenshot({
    path: `${evidenceDirectory}/13-apple-ios27-preview.png`,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Google Wallet" }).click();
  await page.locator(".builder-preview-desktop").screenshot({
    path: `${evidenceDirectory}/14-google-preview.png`,
    animations: "disabled",
  });

  await page
    .getByRole("button", { name: /^Basics/u })
    .first()
    .click();
  await page.getByLabel("Card name in your dashboard").fill("P3 evidence card");
  await expect(page.getByText("Saving…", { exact: true })).toBeVisible();
  await page.screenshot({
    path: `${evidenceDirectory}/15-saving.png`,
    fullPage: true,
    animations: "disabled",
  });
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.screenshot({
    path: `${evidenceDirectory}/16-saved.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.getByLabel("Card name in your dashboard").fill("");
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review card" }).click();
  await expect(page.getByText("Needs attention", { exact: true }).first()).toBeVisible();
  await page.screenshot({
    path: `${evidenceDirectory}/17-validation-error.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: /^Basics/u })
    .first()
    .click();
  await page.getByLabel("Card name in your dashboard").fill("P3 evidence card");
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review card" }).click();
  await expect(page.getByText("Readiness checks passed", { exact: true }).first()).toBeVisible();
  await page.screenshot({
    path: `${evidenceDirectory}/18-readiness-review.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.screenshot({
    path: `${evidenceDirectory}/19-tablet.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${evidenceDirectory}/20-mobile-390.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({
    path: `${evidenceDirectory}/21-mobile-360.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.goto("/ar/dashboard/programs/created-program-id/edit");
  await expect(page.locator(".builder-shell")).toHaveAttribute("dir", "rtl");
  await page.screenshot({
    path: `${evidenceDirectory}/22-mobile-ar.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/en/dashboard/programs/created-program-id/edit");
  await page.getByRole("button", { name: "Change design" }).click();
  const warning = page.getByRole("dialog", { name: "Change this design?" });
  await expect(warning).toBeVisible();
  await warning.screenshot({
    path: `${evidenceDirectory}/23-change-design-warning.png`,
    animations: "disabled",
  });
  await warning.getByRole("button", { name: "Choose another design" }).click();
  let preview = allTemplates(page).getByRole("button", {
    name: "Preview: Start from scratch, all templates",
  });
  await preview.click();
  await page
    .getByRole("dialog", { name: "Start from scratch" })
    .getByRole("button", { name: "Start from scratch" })
    .click();
  await expect(page).toHaveURL(/\/programs\/created-program-id\/edit$/u);
  await expect(
    page.locator(".builder-template-context").getByText("Start from scratch", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${evidenceDirectory}/05-start-from-scratch.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.getByRole("button", { name: "Change design" }).click();
  await page
    .getByRole("dialog", { name: "Change this design?" })
    .getByRole("button", { name: "Choose another design" })
    .click();
  preview = allTemplates(page).getByRole("button", {
    name: "Preview: Dark Espresso, all templates",
  });
  await preview.click();
  await page
    .getByRole("dialog", { name: "Dark Espresso" })
    .getByRole("button", { name: "Use this template" })
    .click();
  await expect(page).toHaveURL(/\/programs\/created-program-id\/edit$/u);
  await expect(
    page.locator(".builder-template-context").getByText("Dark Espresso", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${evidenceDirectory}/04-dark-template-builder.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.getByRole("button", { name: "Review card" }).click();
  await expect(page.getByText("Readiness checks passed", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Continue to Studio" }).click();
  await expect(page.getByRole("navigation", { name: "Studio sections" })).toBeVisible();
  await page.screenshot({
    path: `${evidenceDirectory}/24-builder-studio-consistency.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.goto("/en/dashboard/programs?create=quick");
  const legacyWizard = page.getByRole("dialog", { name: "Create a loyalty card" });
  await expect(legacyWizard).toBeVisible();
  const legacyBuffer = await legacyWizard.screenshot({ animations: "disabled" });
  const builderBuffer = await sharp(`${evidenceDirectory}/01-builder-en-desktop.png`)
    .resize({ width: 740 })
    .png()
    .toBuffer();
  const wizardBuffer = await sharp(legacyBuffer).resize({ width: 740 }).png().toBuffer();
  const [builderMetadata, wizardMetadata] = await Promise.all([
    sharp(builderBuffer).metadata(),
    sharp(wizardBuffer).metadata(),
  ]);
  const comparisonHeight = Math.max(builderMetadata.height ?? 0, wizardMetadata.height ?? 0);
  await sharp({
    create: { width: 1528, height: comparisonHeight + 64, channels: 4, background: "#fcfbfa" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="1528" height="64"><text x="16" y="40" font-family="Arial,sans-serif" font-size="23" font-weight="700" fill="#241916">Before · seven-step modal</text><text x="788" y="40" font-family="Arial,sans-serif" font-size="23" font-weight="700" fill="#241916">After · continuous card builder</text></svg>',
        ),
        left: 0,
        top: 0,
      },
      { input: wizardBuffer, left: 16, top: 64 },
      { input: builderBuffer, left: 788, top: 64 },
    ])
    .png()
    .toFile(`${evidenceDirectory}/25-old-wizard-new-builder-contact-sheet.png`);
});

test("captures focused P3 repair-round-1 evidence", async ({ page }) => {
  test.setTimeout(240_000);
  const evidenceDirectory = "test-results/evidence/uiux/create-card-p3-repair-round1";
  await mkdir(evidenceDirectory, { recursive: true });
  await mockTemplateGalleryApi(page, { patchDelayMs: 350 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterBuilder(page);
  await addCardLanguage(page, "Arabic");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  const preview = page.locator(".builder-preview-desktop");
  const slider = preview.locator('input[type="range"]');
  const setProgress = async (value: number) => {
    await slider.evaluate((element, progress) => {
      const input = element as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, String(progress));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    await expectBuilderPreviewReady(preview);
    await expect(preview.locator(".builder-preview-status")).toHaveCount(0);
  };

  await page.screenshot({
    path: `${evidenceDirectory}/01-builder-desktop-fixed.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.getByRole("tab", { name: "Apple Legacy" }).click();
  for (const [progress, filename] of [
    [0, "02-apple-legacy-preview-0-of-8.png"],
    [4, "03-apple-legacy-preview-4-of-8.png"],
    [8, "04-apple-legacy-preview-8-of-8.png"],
  ] as const) {
    await setProgress(progress);
    await preview.screenshot({
      path: `${evidenceDirectory}/${filename}`,
      animations: "disabled",
    });
  }

  await setProgress(4);
  await page.getByRole("tab", { name: "Apple iOS 27+" }).click();
  await expectBuilderPreviewReady(preview);
  await expect(preview.locator(".builder-preview-status")).toHaveCount(0);
  await preview.screenshot({
    path: `${evidenceDirectory}/05-apple-ios27-preview.png`,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Google Wallet" }).click();
  await expectBuilderPreviewReady(preview);
  await expect(preview.locator(".builder-preview-status")).toHaveCount(0);
  await preview.screenshot({
    path: `${evidenceDirectory}/06-google-preview.png`,
    animations: "disabled",
  });

  await page
    .getByRole("button", { name: /^Appearance/u })
    .first()
    .click();
  await expect(page.locator(".studio-asset-current")).toHaveCount(2);
  await expect
    .poll(() =>
      page
        .locator(".studio-asset-current img")
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
  await page.locator(".builder-editor").screenshot({
    path: `${evidenceDirectory}/07-appearance-assets.png`,
    animations: "disabled",
  });

  await page.getByRole("button", { name: "Review card" }).click();
  await expect(page.getByText("Readiness checks passed", { exact: true }).first()).toBeVisible();
  await page.locator(".builder-editor").screenshot({
    path: `${evidenceDirectory}/08-readiness-valid.png`,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 1024, height: 860 });
  await page.getByRole("button", { name: "Continue to Studio" }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 1_000));
  await page.screenshot({
    path: `${evidenceDirectory}/09-tablet-no-overlap.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 780 });
  await page.getByRole("button", { name: "Continue to Studio" }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 1_000));
  await page.screenshot({
    path: `${evidenceDirectory}/10-mobile-390-no-overlap.png`,
    animations: "disabled",
  });

  await page.goto("/ar/dashboard/programs/created-program-id/edit");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /اللغات/u }).click();
  await page.getByRole("tab", { name: "English" }).click();
  const mixedDirectionTitle = page.locator('.builder-language-panel[lang="en"] input').first();
  await mixedDirectionTitle.fill(
    "Classic Roast loyalty card with a long English name inside the Arabic interface",
  );
  await mixedDirectionTitle.press("Tab");
  await expect.poll(() => mixedDirectionTitle.evaluate((input) => input.scrollLeft)).toBe(0);
  await page.screenshot({
    path: `${evidenceDirectory}/11-arabic-mobile-mixed-language.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("tab", { name: /العربية/u }).click();
  await page.screenshot({
    path: `${evidenceDirectory}/12-arabic-desktop.png`,
    fullPage: true,
    animations: "disabled",
  });

  const apple = await sharp(`${evidenceDirectory}/03-apple-legacy-preview-4-of-8.png`)
    .resize({ width: 430 })
    .png()
    .toBuffer();
  const google = await sharp(`${evidenceDirectory}/06-google-preview.png`)
    .resize({ width: 430 })
    .png()
    .toBuffer();
  const [appleMetadata, googleMetadata] = await Promise.all([
    sharp(apple).metadata(),
    sharp(google).metadata(),
  ]);
  const mappingHeight = Math.max(appleMetadata.height ?? 0, googleMetadata.height ?? 0);
  await sharp({
    create: { width: 900, height: mappingHeight + 96, channels: 4, background: "#FCFBFA" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="96"><text x="18" y="30" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#241916">Apple · storeCard fields + strip + QR + back reward</text><text x="468" y="30" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#241916">Google · class/object + points + image + QR</text><text x="18" y="62" font-family="Arial,sans-serif" font-size="14" fill="#625B57">No template-only motif or unsupported hero treatment</text><text x="468" y="62" font-family="Arial,sans-serif" font-size="14" fill="#625B57">No CSS-only modules beyond provider payload</text></svg>',
        ),
        left: 0,
        top: 0,
      },
      { input: apple, left: 12, top: 96 },
      { input: google, left: 458, top: 96 },
    ])
    .png()
    .toFile(`${evidenceDirectory}/13-wallet-mapping-evidence.png`);

  const currentPreview = await sharp(`${evidenceDirectory}/02-apple-legacy-preview-0-of-8.png`)
    .resize({ width: 600 })
    .png()
    .toBuffer();
  const currentMetadata = await sharp(currentPreview).metadata();
  await sharp({
    create: {
      width: 640,
      height: (currentMetadata.height ?? 0) + 72,
      channels: 4,
      background: "#FCFBFA",
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="72"><text x="20" y="44" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#241916">Current · shared renderer truth</text></svg>',
        ),
        left: 0,
        top: 0,
      },
      { input: currentPreview, left: 20, top: 72 },
    ])
    .png()
    .toFile(`${evidenceDirectory}/14-current-repair-contact-sheet.png`);
});
