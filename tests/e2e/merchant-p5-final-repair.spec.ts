import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { mockTemplateGalleryApi, templateGalleryFixtures } from "./template-gallery-fixtures";

const evidenceDirectory = path.resolve("test-results/evidence/uiux/p5-final-repair");

async function openGallery(
  page: Page,
  locale: "en" | "ar" = "en",
  viewport = { width: 1440, height: 1000 },
): Promise<void> {
  await mockTemplateGalleryApi(page);
  await page.setViewportSize(viewport);
  await page.goto(`/${locale}/dashboard/programs/new`);
  await expect(page.locator(".template-gallery")).toBeVisible();
}

async function resolveGallery(page: Page): Promise<Locator> {
  const collection = page.locator(
    'section[aria-labelledby="template-gallery-all-title"] .template-gallery-card',
  );
  await expect(collection).toHaveCount(templateGalleryFixtures().length + 1);
  for (let index = 0; index < (await collection.count()); index += 1) {
    const card = collection.nth(index);
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator("h3")).not.toHaveText("");
    await expect(card.locator("img")).toBeVisible();
    await expect
      .poll(() =>
        card
          .locator("img")
          .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return collection;
}

async function selectFirstTemplate(
  page: Page,
  locale: "en" | "ar" = "en",
  expectEditableBuilder = true,
): Promise<void> {
  await page
    .locator(".template-gallery__section--recommended .template-gallery-card__preview")
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("img")).toBeVisible();
  await dialog
    .getByRole("button", {
      name: locale === "ar" ? "استخدام هذا القالب" : "Use this template",
    })
    .click();
  if (expectEditableBuilder) await expect(page.locator(".builder-shell")).toBeVisible();
  else await expect(page.getByRole("button", { name: "Continue to Studio" })).toBeVisible();
}

async function openBuilder(
  page: Page,
  options: {
    locale?: "en" | "ar";
    viewport?: { width: number; height: number };
    studioState?: "DRAFT" | "READY" | "LIVE";
    onBuilderPreview?: (profile: string, locale: string, svg: string) => void;
  } = {},
): Promise<void> {
  const {
    locale = "en",
    viewport = { width: 1440, height: 1000 },
    studioState = "DRAFT",
    onBuilderPreview,
  } = options;
  await mockTemplateGalleryApi(page, {
    studioState,
    billingStatus: studioState === "DRAFT" ? "PENDING_ACTIVATION" : "ACTIVE",
    onBuilderPreview: (profile, previewLocale, preview) =>
      onBuilderPreview?.(profile, previewLocale, preview.svg),
  });
  await page.setViewportSize(viewport);
  await page.goto(`/${locale}/dashboard/programs/new`);
  await selectFirstTemplate(page, locale, studioState !== "LIVE");
  if (studioState !== "LIVE") {
    const desktopPreview = page.locator(".builder-preview-desktop");
    if (await desktopPreview.isVisible()) {
      await expect(desktopPreview.locator(".builder-preview-canvas img")).toBeVisible();
    }
  }
}

async function continueToStudio(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Review card" }).click();
  const continueButton = page.getByRole("button", { name: "Continue to Studio" });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page.locator(".studio-shell--p4")).toBeVisible();
}

async function openStudio(
  page: Page,
  state: "READY" | "LIVE" = "LIVE",
  viewport = { width: 1440, height: 1000 },
): Promise<void> {
  await openBuilder(page, { studioState: state, viewport });
  if (await page.locator(".builder-shell").isVisible()) await continueToStudio(page);
  else {
    await page.getByRole("button", { name: "Continue to Studio" }).click();
    await expect(page.locator(".studio-shell--p4")).toBeVisible();
  }
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

async function screenshot(page: Page, filename: string, fullPage = true): Promise<void> {
  await page.screenshot({
    path: path.join(evidenceDirectory, filename),
    fullPage,
    animations: "disabled",
  });
}

async function labeledPanel(
  source: Buffer,
  label: string,
  width: number,
  imageHeight: number,
): Promise<Buffer> {
  const image = await sharp(source)
    .resize(width, imageHeight, { fit: "contain", background: "#fffdfb" })
    .png()
    .toBuffer();
  const safeLabel = label.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const header = Buffer.from(`
    <svg width="${width}" height="54" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="54" fill="#241916"/>
      <text x="20" y="35" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#ffffff">${safeLabel}</text>
    </svg>
  `);
  return sharp({
    create: { width, height: imageHeight + 54, channels: 4, background: "#fffdfb" },
  })
    .composite([
      { input: header, top: 0, left: 0 },
      { input: image, top: 54, left: 0 },
    ])
    .png()
    .toBuffer();
}

test("resolves every expected Gallery template after progressive scrolling", async ({ page }) => {
  await openGallery(page);
  const cards = await resolveGallery(page);
  const identifiers = await cards.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-template-code")),
  );
  expect(new Set(identifiers).size).toBe(templateGalleryFixtures().length + 1);
  expect(identifiers).toContain("BLANK");
  for (const template of templateGalleryFixtures()) expect(identifiers).toContain(template.code);
  await expect(page.locator(".template-gallery-card--deferred")).toHaveCount(0);
  await expect(page.locator(".template-gallery__loading")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("keeps Gallery comparison useful at 390px and 360px", async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]) {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await openGallery(page, "en", viewport);
    const cards = await resolveGallery(page);
    const sample = cards.first();
    const previewBox = await sample.locator(".template-gallery-card__preview").boundingBox();
    const actionBox = await sample.locator(".template-gallery-card__action").boundingBox();
    expect(previewBox?.width ?? 0).toBeGreaterThanOrEqual(viewport.width === 390 ? 140 : 280);
    expect(actionBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(sample.locator("h3")).toBeVisible();
    await expect(sample.locator(".template-gallery-card__taxonomy")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test("uses a neutral Library summary when renderer-ready data is unavailable", async ({ page }) => {
  await mockTemplateGalleryApi(page, {
    existingPrograms: [
      {
        id: "known-eight-stamp-card",
        internalName: "Classic Roast rewards",
        status: "PUBLISHED",
        updatedAt: "2026-08-07T09:30:00.000Z",
        currentDraftVersion: null,
        currentPublishedVersion: {
          id: "known-eight-stamp-version",
          versionNumber: 1,
          status: "PUBLISHED",
          publishedAt: "2026-08-07T09:00:00.000Z",
        },
        _count: { versions: 1 },
      },
    ],
  });
  await page.goto("/en/dashboard/programs");
  const card = page.locator(".program-list__card");
  await expect(card.locator(".loyalty-card-real-preview")).toBeVisible();
  await expect(card.locator(".loyalty-card-real-preview__title")).toHaveText(
    "Classic Roast rewards",
  );
  await expect(card.locator(".loyalty-card-real-preview__body")).toBeVisible();
  await expect(card.getByText("Design available in Studio", { exact: true })).toBeVisible();
});

test("selects Arabic customer content for the Arabic editor and preview", async ({ page }) => {
  const previewResponses: Array<{ locale: string; svg: string }> = [];
  await openBuilder(page, {
    locale: "ar",
    onBuilderPreview: (profile, previewLocale, svg) => {
      if (profile === "CUSTOMER_WEB") previewResponses.push({ locale: previewLocale, svg });
    },
  });
  await page.getByRole("button", { name: /اللغات/u }).click();
  const arabicTab = page.getByRole("tab", { name: /العربية/u });
  await arabicTab.click();
  const localizedName = "بطاقة القهوة العربية";
  await page.getByLabel("اسم البطاقة").fill(localizedName);
  await expect(page.locator(".builder-save-state")).toContainText("تم الحفظ", { timeout: 10_000 });
  await expect
    .poll(() =>
      previewResponses.some(
        (response) => response.locale === "AR" && response.svg.includes(localizedName),
      ),
    )
    .toBe(true);
  const previewImage = page.locator(".builder-preview-desktop .builder-preview-canvas img");
  await expect(previewImage).toBeVisible();
  expect(decodeURIComponent((await previewImage.getAttribute("src")) ?? "")).toContain(
    localizedName,
  );
});

test("keeps focused bottom fields above the mobile Builder footer", async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]) {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await openBuilder(page, { viewport });
    await page.getByRole("button", { name: /^Languages/u }).click();
    await page.getByText("Detailed content and messages", { exact: true }).click();
    const bottomField = page.getByLabel("Paused-card message");
    await bottomField.focus();
    await bottomField.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
    await expect(bottomField).toBeFocused();
    const geometry = await page.evaluate(() => {
      const field = document.activeElement?.getBoundingClientRect();
      const footer = document.querySelector(".builder-footer")?.getBoundingClientRect();
      return {
        fieldBottom: field?.bottom ?? 0,
        fieldTop: field?.top ?? 0,
        footerTop: footer?.top ?? window.innerHeight,
      };
    });
    expect(geometry.fieldTop).toBeGreaterThanOrEqual(0);
    expect(geometry.fieldBottom).toBeLessThanOrEqual(geometry.footerTop - 16);
    await expectNoHorizontalOverflow(page);
  }
});

test("keeps Wallet preview tabs selectable without implying provider readiness", async ({
  page,
}) => {
  await openBuilder(page);
  const preview = page.locator(".builder-preview-desktop");
  await expect(
    preview.getByText(
      "Visual preview only. Wallet availability and production readiness are shown separately in Studio.",
      { exact: true },
    ),
  ).toBeVisible();
  for (const name of ["Apple Wallet", "Google Wallet"]) {
    const tab = preview.getByRole("tab", { name });
    await expect(tab).toBeEnabled();
    const affordance = await tab.evaluate((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return { cursor: style.cursor, height: box.height, opacity: style.opacity };
    });
    expect(affordance).toMatchObject({ cursor: "pointer", opacity: "1" });
    expect(affordance.height).toBeGreaterThanOrEqual(44);
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
  }
});

test("keeps Studio summary semantics truthful and the template dialog centered and content-sized", async ({
  page,
}) => {
  await openStudio(page, "LIVE");
  const preview = page.getByLabel("Card preview");
  await expect(preview.getByText("Published card summary", { exact: true })).toBeVisible();
  await expect(preview.getByRole("img", { name: "Current published card summary" })).toBeVisible();
  await expect(preview.getByText("Published customer view", { exact: true })).toHaveCount(0);
  await expect(preview.getByText("Loading preview…", { exact: true })).toHaveCount(0);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await openGallery(page, "en", { width: 1440, height: 1000 });
  await page.locator(".template-gallery-card__preview").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("img")).toBeVisible();
  const geometry = await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const body = element.querySelector(".wf-dialog__body");
    return {
      centerX: Math.abs(box.left + box.width / 2 - window.innerWidth / 2),
      centerY: Math.abs(box.top + box.height / 2 - window.innerHeight / 2),
      height: box.height,
      bodyClientHeight: body?.clientHeight ?? 0,
      bodyScrollHeight: body?.scrollHeight ?? 0,
    };
  });
  expect(geometry.centerX).toBeLessThanOrEqual(2);
  expect(geometry.centerY).toBeLessThanOrEqual(2);
  expect(geometry.height).toBeLessThan(900);
  expect(geometry.bodyScrollHeight).toBeLessThanOrEqual(geometry.bodyClientHeight + 2);
  const accessibility = await new AxeBuilder({ page })
    .include(".template-preview-dialog")
    .analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

test("captures exactly the nine P5 final-repair evidence files", async ({ context }) => {
  test.setTimeout(300_000);
  await rm(evidenceDirectory, { recursive: true, force: true });
  await mkdir(evidenceDirectory, { recursive: true });

  const library = await context.newPage();
  await mockTemplateGalleryApi(library, {
    existingPrograms: [
      {
        id: "p5-repair-library-card",
        internalName: "Classic Roast rewards",
        status: "PUBLISHED",
        updatedAt: "2026-08-07T09:30:00.000Z",
        currentDraftVersion: null,
        currentPublishedVersion: {
          id: "p5-repair-library-version",
          versionNumber: 1,
          status: "PUBLISHED",
          publishedAt: "2026-08-07T09:00:00.000Z",
        },
        _count: { versions: 1 },
      },
    ],
  });
  await library.setViewportSize({ width: 1440, height: 1000 });
  await library.goto("/en/dashboard/programs");
  await expect(library.getByText("Design available in Studio", { exact: true })).toBeVisible();
  await screenshot(library, "01-library-truthful-thumbnail.png");
  await library.close();

  const gallery = await context.newPage();
  await openGallery(gallery);
  await resolveGallery(gallery);
  await screenshot(gallery, "02-gallery-desktop-all-templates-loaded.png");
  await gallery.close();

  const mobileGallery = await context.newPage();
  await openGallery(mobileGallery, "en", { width: 390, height: 844 });
  await resolveGallery(mobileGallery);
  await screenshot(mobileGallery, "03-gallery-mobile-390-all-templates-loaded.png");
  await mobileGallery.close();

  const arabicBuilder = await context.newPage();
  await openBuilder(arabicBuilder, { locale: "ar" });
  await arabicBuilder.getByRole("button", { name: /اللغات/u }).click();
  await arabicBuilder.getByRole("tab", { name: /العربية/u }).click();
  await expect(arabicBuilder.locator(".builder-preview-desktop img")).toBeVisible();
  await screenshot(arabicBuilder, "04-builder-arabic-localized-content.png");
  await arabicBuilder.close();

  const studio = await context.newPage();
  await openStudio(studio, "LIVE");
  await expect(studio.getByRole("img", { name: "Current published card summary" })).toBeVisible();
  await expect(studio.getByText("Loading preview…", { exact: true })).toHaveCount(0);
  await screenshot(studio, "05-studio-stable-preview.png");
  await studio.close();

  const mobileBuilder = await context.newPage();
  await openBuilder(mobileBuilder, { viewport: { width: 390, height: 844 } });
  await mobileBuilder.getByRole("button", { name: /^Languages/u }).click();
  await mobileBuilder.getByText("Detailed content and messages", { exact: true }).click();
  const bottomField = mobileBuilder.getByLabel("Paused-card message");
  await bottomField.focus();
  await bottomField.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
  await screenshot(mobileBuilder, "06-mobile-builder-sticky-footer-clearance.png", false);
  await mobileBuilder.close();

  const semanticPanels: Buffer[] = [];
  const builder = await context.newPage();
  await openBuilder(builder);
  semanticPanels.push(
    await labeledPanel(
      await builder.locator(".builder-preview-desktop").screenshot({ animations: "disabled" }),
      "Builder · exact selectable preview",
      500,
      430,
    ),
  );
  await builder.close();
  const studioPanel = await context.newPage();
  await openStudio(studioPanel, "LIVE");
  semanticPanels.push(
    await labeledPanel(
      await studioPanel.getByLabel("Card preview").screenshot({ animations: "disabled" }),
      "Studio · published card summary",
      500,
      430,
    ),
  );
  await studioPanel.close();
  const launch = await context.newPage();
  await openStudio(launch, "READY");
  await launch
    .getByRole("navigation", { name: "Studio sections" })
    .getByRole("button", { name: /^(?:Review & launch|Launch)/u })
    .click();
  semanticPanels.push(
    await labeledPanel(
      await launch.getByLabel("Loyalty card summary").screenshot({ animations: "disabled" }),
      "Launch · operational summary",
      500,
      430,
    ),
  );
  await launch.close();
  await sharp({
    create: { width: 1572, height: 532, channels: 4, background: "#efe9e1" },
  })
    .composite(semanticPanels.map((input, index) => ({ input, top: 24, left: 24 + index * 516 })))
    .png()
    .toFile(path.join(evidenceDirectory, "07-preview-semantics-builder-studio-launch.png"));

  const dialogPage = await context.newPage();
  await openGallery(dialogPage, "en", { width: 1440, height: 1000 });
  await dialogPage.locator(".template-gallery-card__preview").first().click();
  await expect(dialogPage.getByRole("dialog").getByRole("img")).toBeVisible();
  await screenshot(dialogPage, "08-centered-template-dialog-content-sized.png", false);
  await dialogPage.close();

  const contactFiles = [
    "01-library-truthful-thumbnail.png",
    "02-gallery-desktop-all-templates-loaded.png",
    "03-gallery-mobile-390-all-templates-loaded.png",
    "04-builder-arabic-localized-content.png",
    "05-studio-stable-preview.png",
    "06-mobile-builder-sticky-footer-clearance.png",
    "08-centered-template-dialog-content-sized.png",
  ];
  const contactPanels: Buffer[] = [];
  for (const filename of contactFiles) {
    contactPanels.push(
      await labeledPanel(
        await sharp(path.join(evidenceDirectory, filename)).png().toBuffer(),
        filename
          .replace(/^\d+-/u, "")
          .replace(/\.png$/u, "")
          .replaceAll("-", " "),
        500,
        330,
      ),
    );
  }
  await sharp({
    create: { width: 1572, height: 1192, channels: 4, background: "#efe9e1" },
  })
    .composite(
      contactPanels.map((input, index) => ({
        input,
        top: 24 + Math.floor(index / 3) * 388,
        left: 24 + (index % 3) * 516,
      })),
    )
    .png()
    .toFile(path.join(evidenceDirectory, "09-p5-repair-contact-sheet.png"));
});
