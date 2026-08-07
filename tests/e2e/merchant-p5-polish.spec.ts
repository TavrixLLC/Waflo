import { mkdir } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type BrowserContext, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { mockTemplateGalleryApi } from "./template-gallery-fixtures";

const evidenceDirectory = path.resolve("artifacts/uiux/p5-end-to-end-polish");

type StudioState =
  | "DRAFT"
  | "CHECKED"
  | "READY"
  | "LIVE"
  | "LIVE_WITH_CHANGES"
  | "PAUSED"
  | "ARCHIVED";

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(
    blocking,
    blocking
      .map(
        (violation) =>
          `${violation.id}: ${violation.description} (${violation.nodes.length} nodes)`,
      )
      .join("\n"),
  ).toEqual([]);
}

async function openGallery(
  page: Page,
  locale: "en" | "ar" = "en",
  viewport = { width: 1440, height: 1000 },
): Promise<void> {
  await mockTemplateGalleryApi(page);
  await page.setViewportSize(viewport);
  await page.goto(`/${locale}/dashboard/programs/new`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: locale === "ar" ? "اختر تصميمًا للبدء" : "Choose a starting design",
    }),
  ).toBeVisible();
}

async function selectFirstTemplate(page: Page, locale: "en" | "ar" = "en"): Promise<void> {
  await page
    .locator(".template-gallery__section--recommended .template-gallery-card__preview")
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", {
      name: locale === "ar" ? "استخدام هذا القالب" : "Use this template",
    })
    .click();
}

async function chooseFirstTemplate(page: Page, locale: "en" | "ar" = "en"): Promise<void> {
  await selectFirstTemplate(page, locale);
  await expect(page.locator(".builder-shell")).toBeVisible();
  const desktopPreview = page.locator(".builder-preview-desktop");
  if (await desktopPreview.isVisible())
    await expect(desktopPreview.locator(".builder-preview-canvas img")).toBeVisible();
  else await expect(page.locator(".builder-mobile-preview-action")).toBeVisible();
}

async function openBuilder(
  page: Page,
  locale: "en" | "ar" = "en",
  viewport = { width: 1440, height: 1000 },
): Promise<void> {
  await openGallery(page, locale, viewport);
  await chooseFirstTemplate(page, locale);
}

async function continueToStudio(page: Page, locale: "en" | "ar" = "en"): Promise<void> {
  const review = page.getByRole("button", {
    name: locale === "ar" ? "مراجعة البطاقة" : "Review card",
  });
  const continueButton = page.getByRole("button", {
    name: locale === "ar" ? "المتابعة إلى الاستوديو" : "Continue to Studio",
  });
  await expect(review.or(continueButton)).toBeVisible();
  if (await review.isVisible()) await review.click();
  await continueButton.click();
  await expect(page.locator(".studio-shell--p4")).toBeVisible();
}

async function openStudio(
  page: Page,
  options: {
    locale?: "en" | "ar";
    state?: StudioState;
    viewport?: { width: number; height: number };
    patchFailures?: number;
  } = {},
): Promise<void> {
  const {
    locale = "en",
    state = "DRAFT",
    viewport = { width: 1440, height: 1000 },
    patchFailures = 0,
  } = options;
  await mockTemplateGalleryApi(page, {
    studioState: state,
    billingStatus: state === "DRAFT" ? "PENDING_ACTIVATION" : "ACTIVE",
    patchFailures,
  });
  await page.setViewportSize(viewport);
  await page.goto(`/${locale}/dashboard/programs/new`);
  await selectFirstTemplate(page, locale);
  await continueToStudio(page, locale);
}

async function openStudioArea(page: Page, name: RegExp, locale: "en" | "ar" = "en"): Promise<void> {
  const mobileTrigger = page.locator(".studio-mobile-navigation > button");
  if (await mobileTrigger.isVisible()) await mobileTrigger.click();
  await page
    .getByRole("navigation", {
      name: locale === "ar" ? "أقسام الاستوديو" : "Studio sections",
    })
    .getByRole("button", { name })
    .click();
}

async function capture(page: Page, filename: string, fullPage = true): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(evidenceDirectory, filename),
    fullPage,
    animations: "disabled",
  });
}

async function labeledPanel(
  source: Buffer,
  label: string,
  width = 520,
  imageHeight = 430,
): Promise<Buffer> {
  const image = await sharp(source)
    .resize(width, imageHeight, { fit: "contain", background: "#fffdfb" })
    .png()
    .toBuffer();
  const safeLabel = label.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const headingHeight = 56;
  const heading = Buffer.from(`
    <svg width="${width}" height="${headingHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#241916"/>
      <text x="22" y="36" font-family="Arial, sans-serif" font-size="19" font-weight="700" fill="#ffffff">${safeLabel}</text>
    </svg>
  `);
  return sharp({
    create: {
      width,
      height: imageHeight + headingHeight,
      channels: 4,
      background: "#fffdfb",
    },
  })
    .composite([
      { input: heading, top: 0, left: 0 },
      { input: image, top: headingHeight, left: 0 },
    ])
    .png()
    .toBuffer();
}

async function createPreviewConsistencySheet(context: BrowserContext): Promise<void> {
  const panels: Buffer[] = [];

  const builder = await context.newPage();
  await openBuilder(builder);
  panels.push(
    await labeledPanel(
      await builder.locator(".builder-preview-desktop").screenshot({ animations: "disabled" }),
      "Builder · editable customer preview",
    ),
  );
  await builder.close();

  const studio = await context.newPage();
  await openStudio(studio, { state: "LIVE" });
  panels.push(
    await labeledPanel(
      await studio.getByLabel("Card preview").screenshot({ animations: "disabled" }),
      "Studio · current published card",
    ),
  );
  await studio.close();

  const launch = await context.newPage();
  await openStudio(launch, { state: "READY" });
  await openStudioArea(launch, /^Launch/u);
  panels.push(
    await labeledPanel(
      await launch.getByLabel("Loyalty card summary").screenshot({ animations: "disabled" }),
      "Launch · truthful visual summary",
    ),
  );
  await launch.close();

  await sharp({
    create: { width: 1584, height: 534, channels: 4, background: "#efe9e1" },
  })
    .composite(panels.map((input, index) => ({ input, top: 24, left: 24 + index * 528 })))
    .png()
    .toFile(path.join(evidenceDirectory, "14-preview-consistency.png"));
}

async function createComparisonNotes(): Promise<void> {
  const svg = Buffer.from(`
    <svg width="1600" height="980" xmlns="http://www.w3.org/2000/svg">
      <rect width="1600" height="980" fill="#f7f9ff"/>
      <rect x="48" y="44" width="1504" height="892" rx="30" fill="#fffdfb" stroke="#e7ded9"/>
      <text x="92" y="112" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#241916">Btaqa benchmark → Waflo P5 response</text>
      <text x="92" y="154" font-family="Arial, sans-serif" font-size="18" fill="#6f625e">Product comparison notes only · no competitor interface is reproduced</text>

      <rect x="92" y="202" width="430" height="54" rx="16" fill="#241916"/>
      <rect x="538" y="202" width="420" height="54" rx="16" fill="#7d2311"/>
      <rect x="974" y="202" width="534" height="54" rx="16" fill="#ae3115"/>
      <text x="116" y="237" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#fff">Merchant need</text>
      <text x="562" y="237" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#fff">Btaqa benchmark insight</text>
      <text x="998" y="237" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#fff">Waflo P5 response</text>

      <g font-family="Arial, sans-serif" font-size="18" fill="#241916">
        <text x="116" y="312" font-weight="700">First useful action</text>
        <text x="562" y="312">Guided setup communicates</text><text x="562" y="338">speed and low effort.</text>
        <text x="998" y="312">Recommended templates lead directly</text><text x="998" y="338">to customize → preview → Studio.</text>

        <line x1="92" y1="378" x2="1508" y2="378" stroke="#e7ded9"/>
        <text x="116" y="432" font-weight="700">Customization confidence</text>
        <text x="562" y="432">Colors, logo, and reward are</text><text x="562" y="458">presented as approachable choices.</text>
        <text x="998" y="432">Exact renderer previews stay visible;</text><text x="998" y="458">Quick and Advanced remain progressive.</text>

        <line x1="92" y1="498" x2="1508" y2="498" stroke="#e7ded9"/>
        <text x="116" y="552" font-weight="700">Visible complexity</text>
        <text x="562" y="552">The public message emphasizes</text><text x="562" y="578">a short guided path.</text>
        <text x="998" y="552">Operational depth is staged across six</text><text x="998" y="578">Studio tasks; redundant outer panels removed.</text>

        <line x1="92" y1="618" x2="1508" y2="618" stroke="#e7ded9"/>
        <text x="116" y="672" font-weight="700">Wallet truthfulness</text>
        <text x="562" y="672">Apple and Google availability</text><text x="562" y="698">is a simple product promise.</text>
        <text x="998" y="672">Customer Web, Apple Wallet, and Google</text><text x="998" y="698">Wallet remain separate provider-aware surfaces.</text>

        <line x1="92" y1="738" x2="1508" y2="738" stroke="#e7ded9"/>
        <text x="116" y="792" font-weight="700">Commercial clarity</text>
        <text x="562" y="792">Five-minute and same-day language</text><text x="562" y="818">sets a high immediacy benchmark.</text>
        <text x="998" y="792">One state-led primary action per stage;</text><text x="998" y="818">safety and publication truth remain explicit.</text>
      </g>

      <text x="92" y="892" font-family="Arial, sans-serif" font-size="15" fill="#6f625e">Benchmark source review: official btaqa.io product and FAQ pages · accessed 2026-08-07</text>
    </svg>
  `);
  await sharp(svg)
    .png()
    .toFile(path.join(evidenceDirectory, "15-btaqa-waflo-comparison-notes.png"));
}

async function createEndToEndContactSheet(): Promise<void> {
  const filenames = [
    "01-loyalty-cards-desktop.png",
    "02-template-gallery-desktop.png",
    "03-builder-desktop.png",
    "04-builder-arabic.png",
    "05-studio-draft.png",
    "06-studio-live.png",
    "07-launch-review.png",
    "08-test-mode.png",
    "09-mobile-gallery-390.png",
    "10-mobile-builder-390.png",
    "11-mobile-studio-360.png",
    "12-arabic-studio-live.png",
    "13-centered-dialog-system.png",
    "14-preview-consistency.png",
  ];
  const cellWidth = 360;
  const cellHeight = 250;
  const labelHeight = 38;
  const gap = 16;
  const columns = 4;
  const rows = Math.ceil(filenames.length / columns);
  const width = gap + columns * (cellWidth + gap);
  const height = gap + rows * (cellHeight + labelHeight + gap);
  const composites: sharp.OverlayOptions[] = [];

  for (const [index, filename] of filenames.entries()) {
    const left = gap + (index % columns) * (cellWidth + gap);
    const top = gap + Math.floor(index / columns) * (cellHeight + labelHeight + gap);
    const label = filename
      .replace(/^\d+-/u, "")
      .replace(/\.png$/u, "")
      .replaceAll("-", " ");
    const image = await sharp(path.join(evidenceDirectory, filename))
      .resize(cellWidth, cellHeight, { fit: "contain", background: "#ffffff" })
      .png()
      .toBuffer();
    const labelSvg = Buffer.from(`
      <svg width="${cellWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#241916"/>
        <text x="14" y="25" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#fff">${label}</text>
      </svg>
    `);
    composites.push({ input: labelSvg, left, top }, { input: image, left, top: top + labelHeight });
  }

  await sharp({
    create: { width, height, channels: 4, background: "#e9ecee" },
  })
    .composite(composites)
    .png()
    .toFile(path.join(evidenceDirectory, "16-end-to-end-contact-sheet.png"));
}

test("keeps the Gallery dialog centered and mobile controls comfortably tappable", async ({
  page,
}) => {
  await openGallery(page, "en", { width: 390, height: 844 });
  await page
    .locator(".template-gallery__section--recommended .template-gallery-card__preview")
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const geometry = await dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const body = element.querySelector(".wf-dialog__body");
    return {
      top: bounds.top,
      bottom: window.innerHeight - bounds.bottom,
      bodyOverflow: body ? getComputedStyle(body).overflowY : "missing",
    };
  });
  expect(Math.abs(geometry.top - geometry.bottom)).toBeLessThanOrEqual(1);
  expect(geometry.top).toBeGreaterThan(0);
  expect(geometry.bodyOverflow).toBe("auto");

  const controlHeights = await page
    .locator(
      ".template-gallery__filters button, .template-gallery-card__action, .template-preview-tabs button",
    )
    .evaluateAll((controls) =>
      controls
        .filter((control) => (control as HTMLElement).offsetParent !== null)
        .map((control) => control.getBoundingClientRect().height),
    );
  expect(Math.min(...controlHeights)).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
});

test("keeps Studio calm, responsive, and free of raw save diagnostics", async ({ page }) => {
  await openStudio(page, { patchFailures: 1 });
  const panelStyle = await page.locator(".studio-editor-panel").evaluate((element) => {
    const style = getComputedStyle(element);
    return { border: style.borderTopWidth, shadow: style.boxShadow };
  });
  expect(panelStyle).toEqual({ border: "0px", shadow: "none" });

  await openStudioArea(page, /^How it works/u);
  await page.getByText("Advanced earning and redemption rules", { exact: true }).click();
  await page.getByLabel("Valid for (days)").first().fill("30");
  await expect(
    page.getByText(
      "Changes could not be saved. Your last saved version is still safe. Try saving again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText(/PROGRAM_DRAFT_SAVE_FAILED|Draft save unavailable/u)).toHaveCount(0);

  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
});

test("representative Gallery, Builder, Studio, and RTL states have no serious Axe violations", async ({
  page,
}) => {
  await openGallery(page);
  await page
    .locator(".template-gallery__section--recommended .template-gallery-card__preview")
    .first()
    .click();
  await expectNoSeriousViolations(page);
  await page.getByRole("dialog").getByRole("button", { name: "Use this template" }).click();
  await expect(page.locator(".builder-shell")).toBeVisible();
  await expectNoSeriousViolations(page);
  await continueToStudio(page);
  await expectNoSeriousViolations(page);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await openStudio(page, { locale: "ar" });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expectNoSeriousViolations(page);
});

test("captures exactly the focused P5 visual QA set", async ({ context }) => {
  test.setTimeout(300_000);
  await mkdir(evidenceDirectory, { recursive: true });

  const library = await context.newPage();
  await mockTemplateGalleryApi(library, {
    existingPrograms: [
      {
        id: "p5-live-library-card",
        internalName: "Classic Roast rewards",
        status: "PUBLISHED",
        updatedAt: "2026-08-07T09:30:00.000Z",
        currentDraftVersion: null,
        currentPublishedVersion: {
          id: "p5-live-library-version",
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
  await expect(
    library.getByRole("heading", { level: 3, name: "Classic Roast rewards" }),
  ).toBeVisible();
  await capture(library, "01-loyalty-cards-desktop.png");
  await library.close();

  const gallery = await context.newPage();
  await openGallery(gallery);
  await capture(gallery, "02-template-gallery-desktop.png");
  await gallery.close();

  const builder = await context.newPage();
  await openBuilder(builder);
  await capture(builder, "03-builder-desktop.png");
  await builder.close();

  const builderArabic = await context.newPage();
  await openBuilder(builderArabic, "ar");
  await capture(builderArabic, "04-builder-arabic.png");
  await builderArabic.close();

  const studioDraft = await context.newPage();
  await openStudio(studioDraft);
  await capture(studioDraft, "05-studio-draft.png");
  await studioDraft.close();

  const studioLive = await context.newPage();
  await openStudio(studioLive, { state: "LIVE" });
  await expect(
    studioLive.getByRole("img", { name: "Currently published customer card" }),
  ).toBeVisible();
  await capture(studioLive, "06-studio-live.png");
  await studioLive.close();

  const launch = await context.newPage();
  await openStudio(launch, { state: "READY" });
  await openStudioArea(launch, /^Launch/u);
  await expect(launch.getByText("FINAL LAUNCH REVIEW", { exact: true })).toBeVisible();
  await capture(launch, "07-launch-review.png");
  await launch.close();

  const testMode = await context.newPage();
  await openStudio(testMode);
  await openStudioArea(testMode, /^Test/u);
  await testMode.getByRole("button", { name: "Start demo customer" }).click();
  await testMode.getByRole("button", { name: "Add a stamp" }).click();
  await expect(testMode.getByText("1 / 8", { exact: true })).toBeVisible();
  await capture(testMode, "08-test-mode.png");
  await testMode.close();

  const mobileGallery = await context.newPage();
  await openGallery(mobileGallery, "en", { width: 390, height: 844 });
  await capture(mobileGallery, "09-mobile-gallery-390.png");
  await mobileGallery.close();

  const mobileBuilder = await context.newPage();
  await openBuilder(mobileBuilder, "en", { width: 390, height: 844 });
  await capture(mobileBuilder, "10-mobile-builder-390.png");
  await mobileBuilder.close();

  const mobileStudio = await context.newPage();
  await openStudio(mobileStudio, { state: "READY", viewport: { width: 360, height: 800 } });
  await capture(mobileStudio, "11-mobile-studio-360.png");
  await mobileStudio.close();

  const arabicLive = await context.newPage();
  await openStudio(arabicLive, { locale: "ar", state: "LIVE" });
  await capture(arabicLive, "12-arabic-studio-live.png");
  await arabicLive.close();

  const centeredDialog = await context.newPage();
  await openGallery(centeredDialog, "en", { width: 390, height: 844 });
  await centeredDialog
    .locator(".template-gallery__section--recommended .template-gallery-card__preview")
    .first()
    .click();
  await expect(centeredDialog.getByRole("dialog")).toBeVisible();
  await capture(centeredDialog, "13-centered-dialog-system.png", false);
  await centeredDialog.close();

  await createPreviewConsistencySheet(context);
  await createComparisonNotes();
  await createEndToEndContactSheet();
});
