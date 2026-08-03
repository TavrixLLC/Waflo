import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { mockTemplateGalleryApi, templateGalleryFixtures } from "./template-gallery-fixtures";

const categories = [
  ["Coffee", "coffee"],
  ["Bakery", "bakery"],
  ["Car Wash", "car-wash"],
  ["Salon", "salon"],
  ["Barbershop", "barbershop"],
  ["Restaurant", "restaurant"],
  ["Retail", "retail"],
  ["General", "general"],
] as const;

function allTemplates(page: Page) {
  return page.locator('section[aria-labelledby="template-gallery-all-title"]');
}

function recommendedTemplates(page: Page) {
  return page.locator(".template-gallery__section--recommended");
}

async function openPreview(page: Page, name: string) {
  const section = allTemplates(page);
  await section.getByRole("button", { name: `Preview: ${name}, all templates` }).click();
  const dialog = page.getByRole("dialog", { name });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function savePreviewContactSheet(cards: Locator, path: string): Promise<void> {
  const count = await cards.count();
  const cellWidth = 380;
  const cellHeight = 268;
  const gap = 16;
  const columns = 4;
  const rows = Math.ceil(count / columns);
  const composites: sharp.OverlayOptions[] = [];

  for (let index = 0; index < count; index += 1) {
    const card = cards.nth(index);
    await card.scrollIntoViewIfNeeded();
    const screenshot = await card.locator(".template-gallery-card__preview").screenshot({
      animations: "disabled",
    });
    const tile = await sharp(screenshot)
      .resize(cellWidth, cellHeight, { fit: "contain", background: "#FCFBFA" })
      .png()
      .toBuffer();
    composites.push({
      input: tile,
      left: gap + (index % columns) * (cellWidth + gap),
      top: gap + Math.floor(index / columns) * (cellHeight + gap),
    });
  }

  await sharp({
    create: {
      width: gap + columns * (cellWidth + gap),
      height: gap + rows * (cellHeight + gap),
      channels: 4,
      background: "#FCFBFA",
    },
  })
    .composite(composites)
    .png()
    .toFile(path);
}

test("opens a 32-design visual library with three business recommendations and a neutral start", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page, { businessCategory: "Cafe" });
  await page.goto("/en/dashboard/programs");
  await page.getByRole("button", { name: "Create loyalty card" }).click();

  await expect(page).toHaveURL(/\/en\/dashboard\/programs\/new$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Choose a starting design" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Recommended for your business" }),
  ).toBeVisible();
  await expect(recommendedTemplates(page).locator(".template-gallery-card")).toHaveCount(3);
  await expect(allTemplates(page).locator(".template-gallery-card")).toHaveCount(33);
  await expect(page.getByRole("heading", { level: 3, name: "Start from scratch" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Classic Roast" })).toHaveCount(2);

  const filters = page.locator(".template-gallery__filters");
  for (const category of ["All", ...categories.map(([label]) => label)]) {
    await expect(filters.getByRole("button", { name: category, exact: true })).toBeVisible();
  }
  await expect(page.getByText("Balanced grid", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Circular layout", { exact: true })).toHaveCount(0);
  await expect(page.getByText("COFFEE_DARK_ESPRESSO", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/v\d+/u, { exact: true })).toHaveCount(0);
});

test("filters four designs per category and searches names and presentation-only styles", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page);
  await page.goto("/en/dashboard/programs/new");
  const filters = page.locator(".template-gallery__filters");

  for (const [label, slug] of categories) {
    await filters.getByRole("button", { name: label, exact: true }).click();
    await expect(filters.getByRole("button", { name: label, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(allTemplates(page).locator(".template-gallery-card")).toHaveCount(
      slug === "general" ? 5 : 4,
    );
  }

  await filters.getByRole("button", { name: "All", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search loyalty card templates" });
  await search.fill("Premium");
  await expect(allTemplates(page).locator(".template-gallery-card")).toHaveCount(3);
  await expect(page.getByRole("heading", { level: 3, name: "Premium Auto" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Luxury Beauty" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Premium Member" })).toBeVisible();

  await search.fill("المخبوزات");
  await expect(allTemplates(page).locator(".template-gallery-card")).toHaveCount(4);
  await expect(page.getByRole("heading", { level: 3, name: "Artisan Bakery" })).toBeVisible();

  await search.fill("circular layout");
  await expect(page.getByText("No templates match that search.")).toBeVisible();
  await search.fill("Blank card");
  await expect(page.getByRole("heading", { level: 3, name: "Start from scratch" })).toBeVisible();
  await expect(allTemplates(page).locator(".template-gallery-card")).toHaveCount(1);
});

test("lazy-loads and caches the three truthful surfaces while preserving keyboard tab behavior", async ({
  page,
}) => {
  const previewRequests: Array<[string, string]> = [];
  await mockTemplateGalleryApi(page, {
    onPreviewRequest: (code, presentation) => previewRequests.push([code, presentation]),
  });
  await page.goto("/en/dashboard/programs/new");
  expect(previewRequests).toEqual([]);

  const dialog = await openPreview(page, "Classic Roast");
  await expect(
    dialog.getByRole("img", { name: /Classic Roast — Customer Preview only/u }),
  ).toBeVisible();
  expect(previewRequests).toEqual([["COFFEE", "TEMPLATE"]]);

  const customerTab = dialog.getByRole("tab", { name: "Customer" });
  await customerTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("tab", { name: "Apple Wallet" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    dialog.getByRole("img", { name: /Classic Roast — Apple Wallet Preview only/u }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("tab", { name: "Google Wallet" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    dialog.getByRole("img", { name: /Classic Roast — Google Wallet Preview only/u }),
  ).toBeVisible();
  expect(previewRequests).toHaveLength(1);

  await dialog.getByRole("button", { name: "Close template preview" }).click();
  await openPreview(page, "Classic Roast");
  expect(previewRequests).toHaveLength(1);
});

test("Start from scratch uses a neutral preview while retaining the safe General Program default", async ({
  page,
}) => {
  const previewRequests: Array<[string, string]> = [];
  await mockTemplateGalleryApi(page, {
    onPreviewRequest: (code, presentation) => previewRequests.push([code, presentation]),
  });
  await page.goto("/en/dashboard/programs/new");

  const dialog = await openPreview(page, "Start from scratch");
  const image = dialog.getByRole("img", { name: /Start from scratch — Customer Preview only/u });
  await expect(image).toBeVisible();
  const source = await image.getAttribute("src");
  expect(decodeURIComponent(source ?? "")).toContain("Your loyalty card");
  expect(decodeURIComponent(source ?? "")).toContain("Your reward");
  expect(decodeURIComponent(source ?? "")).not.toContain("General visits rewards");
  expect(previewRequests).toEqual([["GENERAL_VISITS", "BLANK"]]);

  await dialog.getByRole("button", { name: "Start from scratch" }).click();
  await expect(page).toHaveURL(/\/en\/dashboard\/programs\/created-program-id\/edit$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Customize your loyalty card" }),
  ).toBeVisible();
  await expect(page.getByText("Start from scratch", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: /^Languages/u })
    .first()
    .click();
  await expect(page.getByLabel("Card name")).toHaveValue("Your loyalty card");
});

test("preserves selected stable code and version through one Program draft and revisioned autosave", async ({
  page,
}) => {
  const createBodies: Record<string, unknown>[] = [];
  const patchBodies: Record<string, unknown>[] = [];
  await mockTemplateGalleryApi(page, {
    onCreate: (body) => createBodies.push(body),
    onPatch: (body) => patchBodies.push(body),
    patchDelayMs: 700,
  });
  await page.goto("/en/dashboard/programs/new");

  const dialog = await openPreview(page, "Clean Blue");
  await dialog.getByRole("button", { name: "Use this template" }).click();

  await expect.poll(() => createBodies.length).toBe(1);
  expect(createBodies[0]).toMatchObject({
    internalName: "Clean Blue",
    templateCode: "CAR_WASH",
    templateVersion: 4,
    requiredStampCount: 6,
    locationIds: ["gallery-location"],
  });
  await expect(page).toHaveURL(/\/en\/dashboard\/programs\/created-program-id\/edit$/u);
  await expect(page.getByText("Clean Blue", { exact: true })).toBeVisible();

  await page.getByLabel("Card name in your dashboard").fill("Gallery car wash");
  await expect(page.getByText("Saving…", { exact: true })).toBeVisible();
  await expect.poll(() => patchBodies.length).toBe(1);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(patchBodies[0]).toMatchObject({
    internalName: "Gallery car wash",
    templateCode: "CAR_WASH",
    templateVersion: 4,
    revision: 1,
  });
});

test("keeps the direct legacy Quick route and two-artwork picker valid", async ({ page }) => {
  await mockTemplateGalleryApi(page);
  await page.goto("/en/dashboard/programs?create=quick");

  const wizard = page.getByRole("dialog", { name: "Create a loyalty card" });
  await expect(wizard).toBeVisible();
  await expect(wizard.getByText("Editing mode", { exact: true })).toBeVisible();
  const coffee = wizard.locator(".template-card").filter({ hasText: "Classic Roast" });
  await expect(coffee.locator("img")).toHaveCount(2);
  await expect(coffee).not.toContainText(/v\d+/u);
});

test("supports RTL, keyboard focus, Axe, and practical 1440-to-360 responsive browsing", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page, { businessCategory: "صالون تجميل" });
  await page.goto("/ar/dashboard/programs/new");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".template-gallery")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "اختر تصميمًا للبدء" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(recommendedTemplates(page).locator(".template-gallery-card")).toHaveCount(3);
  await expect(page.getByRole("heading", { level: 3, name: "لمسة وردية" })).toHaveCount(2);

  for (const width of [1440, 1280, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(allTemplates(page).locator(".template-gallery__grid")).toHaveCSS(
    "grid-template-columns",
    /\d+(?:\.\d+)?px \d+(?:\.\d+)?px/u,
  );
  await page.setViewportSize({ width: 360, height: 800 });
  const columnsAt360 = await allTemplates(page)
    .locator(".template-gallery__grid")
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(columnsAt360).toBe(1);

  await expect(page.getByRole("region", { name: "البحث في القوالب وتصفيتها" })).toBeVisible();
  await expect(page.getByRole("region", { name: "جميع القوالب" })).toHaveCount(1);
  const galleryAccessibility = await new AxeBuilder({ page }).analyze();
  expect(galleryAccessibility.violations).toEqual([]);

  const previewButton = allTemplates(page).getByRole("button", {
    name: "معاينة: لمسة وردية, جميع القوالب",
  });
  await previewButton.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "لمسة وردية" });
  await expect(
    dialog.getByRole("img", { name: /لمسة وردية — العميل للمعاينة فقط/u }),
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "Apple Wallet" }).click();
  await expect(
    dialog.getByRole("img", { name: /لمسة وردية — Apple Wallet للمعاينة فقط/u }),
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "Google Wallet" }).click();
  await expect(
    dialog.getByRole("img", { name: /لمسة وردية — Google Wallet للمعاينة فقط/u }),
  ).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(previewButton).toBeFocused();
});

test("fixture boundary exposes the expanded catalog and only one initial preview surface", () => {
  const fixtures = templateGalleryFixtures();
  expect(fixtures).toHaveLength(32);
  expect(fixtures.every((template) => template.galleryThumbnail.profile === "CUSTOMER_WEB")).toBe(
    true,
  );
  expect(fixtures.every((template) => !("galleryPreviews" in template))).toBe(true);
});

test("keeps visual discovery lazy, console-clean, and within practical browser budgets", async ({
  page,
}) => {
  const previewRequests: Array<[string, string]> = [];
  const consoleProblems: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.url()} · ${request.failure()?.errorText ?? "unknown"}`);
  });
  await mockTemplateGalleryApi(page, {
    onPreviewRequest: (code, presentation) => previewRequests.push([code, presentation]),
  });

  const galleryStart = Date.now();
  await page.goto("/en/dashboard/programs/new");
  await expect(
    page.getByRole("heading", { level: 1, name: "Choose a starting design" }),
  ).toBeVisible();
  const galleryReadyMs = Date.now() - galleryStart;
  const heapBefore = await page.evaluate(() => {
    const browserPerformance = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    return browserPerformance.memory?.usedJSHeapSize ?? null;
  });

  const previewStart = Date.now();
  await openPreview(page, "Classic Roast");
  const previewOpenMs = Date.now() - previewStart;
  const heapAfter = await page.evaluate(() => {
    const browserPerformance = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    return browserPerformance.memory?.usedJSHeapSize ?? null;
  });
  const heapDeltaMiB =
    heapBefore === null || heapAfter === null
      ? null
      : Number(((heapAfter - heapBefore) / 1024 / 1024).toFixed(1));

  console.info(
    `P2.1R browser metrics ${JSON.stringify({ galleryReadyMs, previewOpenMs, heapDeltaMiB, failedRequests })}`,
  );
  expect(previewRequests).toEqual([["COFFEE", "TEMPLATE"]]);
  expect(galleryReadyMs).toBeLessThan(15_000);
  expect(previewOpenMs).toBeLessThan(4_000);
  if (heapDeltaMiB !== null) expect(heapDeltaMiB).toBeLessThan(32);
  expect(consoleProblems).toEqual([]);
});

test("captures P2.1R visual evidence and differentiated contact sheets", async ({ page }) => {
  test.setTimeout(240_000);
  const evidenceDirectory = "artifacts/uiux/template-library-p21r";
  await mkdir(evidenceDirectory, { recursive: true });
  await mockTemplateGalleryApi(page, { businessCategory: "Cafe" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/en/dashboard/programs/new");
  await expect(
    page.getByRole("heading", { level: 1, name: "Choose a starting design" }),
  ).toBeVisible();
  await page.addStyleTag({
    content: ".template-gallery-card--deferred{content-visibility:visible!important}",
  });

  await page.screenshot({ path: `${evidenceDirectory}/01-gallery-en-desktop.png`, fullPage: true });
  await recommendedTemplates(page).screenshot({
    path: `${evidenceDirectory}/04-recommended-coffee.png`,
  });
  const afterGallery = await allTemplates(page).screenshot({ animations: "disabled" });

  const filters = page.locator(".template-gallery__filters");
  for (const [index, [label, slug]] of categories.entries()) {
    await filters.getByRole("button", { name: label, exact: true }).click();
    await page.screenshot({
      path: `${evidenceDirectory}/${String(index + 5).padStart(2, "0")}-${slug}-four.png`,
      fullPage: true,
    });
  }
  await filters.getByRole("button", { name: "All", exact: true }).click();
  const catalog = allTemplates(page);
  await savePreviewContactSheet(
    catalog.locator('article[data-template-role="SIGNATURE"]'),
    `${evidenceDirectory}/13-signature-heroes-contact-sheet.png`,
  );
  await savePreviewContactSheet(
    catalog.locator('article[data-template-role="PREMIUM"]'),
    `${evidenceDirectory}/14-premium-dark-contact-sheet.png`,
  );
  await savePreviewContactSheet(
    catalog.locator('article[data-template-role="MINIMAL"]:not([data-template-code="BLANK"])'),
    `${evidenceDirectory}/15-minimal-contact-sheet.png`,
  );

  let dialog = await openPreview(page, "Classic Roast");
  await dialog.screenshot({ path: `${evidenceDirectory}/16-light-customer-preview.png` });
  await dialog.getByRole("tab", { name: "Apple Wallet" }).click();
  await dialog.screenshot({ path: `${evidenceDirectory}/18-apple-preview.png` });
  await dialog.getByRole("tab", { name: "Google Wallet" }).click();
  await dialog.screenshot({ path: `${evidenceDirectory}/19-google-preview.png` });
  await dialog.getByRole("button", { name: "Close template preview" }).click();

  dialog = await openPreview(page, "Dark Espresso");
  await dialog.screenshot({ path: `${evidenceDirectory}/17-dark-customer-preview.png` });
  await dialog.getByRole("button", { name: "Close template preview" }).click();

  const beforeSheet = await sharp("artifacts/uiux/template-library-p21/21-contact-sheet.png")
    .resize({ width: 760 })
    .png()
    .toBuffer();
  const afterSheet = await sharp(afterGallery).resize({ width: 760 }).png().toBuffer();
  const [beforeMetadata, afterMetadata] = await Promise.all([
    sharp(beforeSheet).metadata(),
    sharp(afterSheet).metadata(),
  ]);
  const comparisonHeight = Math.max(beforeMetadata.height ?? 0, afterMetadata.height ?? 0);
  await sharp({
    create: { width: 1568, height: comparisonHeight + 64, channels: 4, background: "#FCFBFA" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="1568" height="64"><text x="16" y="40" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#241916">Before · P2.1</text><text x="808" y="40" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#241916">After · P2.1R</text></svg>',
        ),
        left: 0,
        top: 0,
      },
      { input: beforeSheet, left: 16, top: 64 },
      { input: afterSheet, left: 808, top: 64 },
    ])
    .png()
    .toFile(`${evidenceDirectory}/22-before-after-contact-sheet.png`);

  await page.goto("/ar/dashboard/programs/new");
  await page.addStyleTag({
    content: ".template-gallery-card--deferred{content-visibility:visible!important}",
  });
  await expect(page.getByRole("heading", { level: 1, name: "اختر تصميمًا للبدء" })).toBeVisible();
  await page.screenshot({ path: `${evidenceDirectory}/02-gallery-ar-desktop.png`, fullPage: true });
  await allTemplates(page)
    .getByRole("button", { name: "معاينة: المحمصة الكلاسيكية, جميع القوالب" })
    .click();
  const arabicDialog = page.getByRole("dialog", { name: "المحمصة الكلاسيكية" });
  await expect(
    arabicDialog.getByRole("img", { name: /المحمصة الكلاسيكية — العميل للمعاينة فقط/u }),
  ).toBeVisible();
  await arabicDialog.screenshot({ path: `${evidenceDirectory}/20-arabic-preview.png` });
  await arabicDialog.getByRole("button", { name: "إغلاق معاينة القالب" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en/dashboard/programs/new");
  await expect(
    page.getByRole("heading", { level: 1, name: "Choose a starting design" }),
  ).toBeVisible();
  await page.addStyleTag({
    content: ".template-gallery-card--deferred{content-visibility:visible!important}",
  });
  await page.screenshot({ path: `${evidenceDirectory}/03-gallery-mobile.png`, fullPage: true });
  await allTemplates(page)
    .locator(".template-gallery__grid")
    .screenshot({
      path: `${evidenceDirectory}/21-compact-mobile-cards.png`,
    });
});
