import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { mockTemplateGalleryApi } from "./template-gallery-fixtures";

const evidenceDirectory = path.resolve(
  "test-results/evidence/uiux/loyalty-studio-p4b-repair-round-1",
);
const finalPreviewEvidenceDirectory = path.resolve(
  "test-results/evidence/uiux/loyalty-studio-p4b-final-micro-repair",
);

async function enterStudio(page: Page, locale: "en" | "ar"): Promise<void> {
  await page.goto(`/${locale}/dashboard/programs/new`);
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
  const review = page.getByRole("button", {
    name: locale === "ar" ? "مراجعة البطاقة" : "Review card",
  });
  const continueToStudio = page.getByRole("button", {
    name: locale === "ar" ? "المتابعة إلى الاستوديو" : "Continue to Studio",
  });
  await expect(review.or(continueToStudio)).toBeVisible();
  if (await review.isVisible()) await review.click();
  await continueToStudio.click();
  await expect(page.locator(".studio-shell--p4")).toBeVisible();
}

async function openLaunch(page: Page, locale: "en" | "ar"): Promise<void> {
  const mobileTrigger = page.locator(".studio-mobile-navigation > button");
  if (await mobileTrigger.isVisible()) await mobileTrigger.click();
  await page
    .getByRole("navigation", {
      name: locale === "ar" ? "أقسام الاستوديو" : "Studio sections",
    })
    .getByRole("button", { name: locale === "ar" ? /^الإطلاق/u : /^Review & launch/u })
    .click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/dashboard/programs/[^/]+/launch$`, "u"));
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: locale === "ar" ? "الإطلاق" : "Review & launch",
    }),
  ).toBeVisible();
}

async function openScenario(
  page: Page,
  options: Parameters<typeof mockTemplateGalleryApi>[1],
  locale: "en" | "ar" = "en",
  viewport = { width: 1440, height: 1000 },
): Promise<void> {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockTemplateGalleryApi(page, options);
  await page.setViewportSize(viewport);
  await enterStudio(page, locale);
}

async function capture(page: Page, filename: string, fullPage = false): Promise<void> {
  await page.screenshot({
    path: path.join(evidenceDirectory, filename),
    fullPage,
    animations: "disabled",
  });
}

async function createContactSheet(): Promise<void> {
  const captures = [
    {
      label: "Paused sharing",
      source: path.join(evidenceDirectory, "03-paused-share-disabled.png"),
    },
    {
      label: "Archived sharing",
      source: path.join(evidenceDirectory, "04-archived-share-disabled.png"),
    },
    {
      label: "Published preview with saved changes",
      source: path.join(evidenceDirectory, "05-live-preview-with-unpublished-changes.png"),
    },
    {
      label: "Publication dialog placement",
      source: path.join(evidenceDirectory, "06-first-launch-dialog-centered-desktop.png"),
    },
  ];
  const cellWidth = 680;
  const cellHeight = 430;
  const gutter = 24;
  const headingHeight = 64;
  const rowLabelHeight = 38;
  const canvasWidth = cellWidth * 2 + gutter * 3;
  const canvasHeight =
    headingHeight +
    Math.ceil(captures.length / 2) * (cellHeight + rowLabelHeight + gutter) +
    gutter;
  const composites: Array<{ input: Buffer; top: number; left: number }> = [];

  const header = Buffer.from(`
    <svg width="${canvasWidth}" height="${headingHeight}">
      <rect width="100%" height="100%" fill="#efe9e1"/>
      <text x="${gutter}" y="40" font-family="Arial" font-size="25" font-weight="700" fill="#25343a">Current post-launch states</text>
    </svg>
  `);
  composites.push({ input: header, top: 0, left: 0 });

  for (const [index, capture] of captures.entries()) {
    const row = Math.floor(index / 2);
    const column = index % 2;
    const left = gutter + column * (cellWidth + gutter);
    const top = headingHeight + row * (cellHeight + rowLabelHeight + gutter);
    const label = Buffer.from(`
      <svg width="${cellWidth}" height="${rowLabelHeight}">
        <rect width="100%" height="100%" fill="#efe9e1"/>
        <text x="0" y="27" font-family="Arial" font-size="18" font-weight="700" fill="#8c3f2d">${capture.label}</text>
      </svg>
    `);
    const image = await sharp(capture.source)
      .resize({
        width: cellWidth,
        height: cellHeight,
        fit: "contain",
        background: "#ffffff",
      })
      .png()
      .toBuffer();
    composites.push({ input: label, top, left }, { input: image, top: top + rowLabelHeight, left });
  }

  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: "#efe9e1",
    },
  })
    .composite(composites)
    .png()
    .toFile(path.join(evidenceDirectory, "12-current-post-launch-contact-sheet.png"));
}

test("captures the focused P4B Repair Round 1 evidence set", async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(evidenceDirectory, { recursive: true });

  await openScenario(page, { studioState: "READY" });
  await capture(page, "01-ready-live-stage-copy.png", true);

  await openScenario(page, { studioState: "LIVE", billingStatus: "ACTIVE" });
  await capture(page, "02-live-share-enabled.png", true);

  await openScenario(page, { studioState: "PAUSED", billingStatus: "ACTIVE" });
  await capture(page, "03-paused-share-disabled.png", true);

  await openScenario(page, { studioState: "ARCHIVED", billingStatus: "ACTIVE" });
  await capture(page, "04-archived-share-disabled.png", true);

  await openScenario(page, { studioState: "LIVE_WITH_CHANGES", billingStatus: "ACTIVE" });
  await expect(page.getByText("Published card summary", { exact: true })).toBeVisible();
  await capture(page, "05-live-preview-with-unpublished-changes.png", true);

  await openScenario(page, { studioState: "READY" }, "en", { width: 1440, height: 900 });
  await openLaunch(page, "en");
  await page.getByRole("button", { name: "Launch loyalty card" }).click();
  await capture(page, "06-first-launch-dialog-centered-desktop.png");

  await openScenario(page, { studioState: "LIVE_WITH_CHANGES", billingStatus: "ACTIVE" }, "en", {
    width: 1440,
    height: 900,
  });
  await openLaunch(page, "en");
  await page.getByRole("button", { name: "Publish changes" }).click();
  await capture(page, "07-update-dialog-centered-desktop.png");

  await openScenario(page, { studioState: "READY", publishDelayMs: 1_400 }, "en", {
    width: 1440,
    height: 900,
  });
  await openLaunch(page, "en");
  await page.getByRole("button", { name: "Launch loyalty card" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Launch card" }).click();
  await expect(page.getByText("Launching card…", { exact: true })).toBeVisible();
  await capture(page, "08-publish-loading-centered-and-locked.png");
  await expect(page.getByRole("heading", { name: "Your loyalty card is live" })).toBeVisible();

  await openScenario(page, { studioState: "READY" }, "en", { width: 390, height: 844 });
  await openLaunch(page, "en");
  await page.getByRole("button", { name: "Launch loyalty card" }).click();
  await capture(page, "09-dialog-centered-mobile-390.png");

  await openScenario(page, { studioState: "READY" }, "en", { width: 360, height: 800 });
  await openLaunch(page, "en");
  await page.getByRole("button", { name: "Launch loyalty card" }).click();
  await capture(page, "10-dialog-centered-mobile-360.png");

  await openScenario(page, { studioState: "READY" }, "ar", { width: 390, height: 844 });
  await openLaunch(page, "ar");
  await page.getByRole("button", { name: "إطلاق بطاقة الولاء" }).click();
  await capture(page, "11-dialog-centered-arabic.png");

  await createContactSheet();
});

test("captures the final published customer preview repair evidence", async ({ page }) => {
  test.setTimeout(120_000);
  await mkdir(finalPreviewEvidenceDirectory, { recursive: true });

  await openScenario(page, { studioState: "LIVE", billingStatus: "ACTIVE" });
  const livePreview = page.getByLabel("Card preview");
  await expect(
    livePreview.getByRole("img", { name: "Current published card summary" }),
  ).toBeVisible();
  await expect(livePreview.getByText("Preview will appear here", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: path.join(finalPreviewEvidenceDirectory, "01-live-published-preview.png"),
    fullPage: true,
    animations: "disabled",
  });
  const repairedPreview = await livePreview.screenshot({ animations: "disabled" });

  await livePreview.evaluate((panel) => {
    const headerLabel = panel.querySelector(".dashboard-card__label");
    const heading = panel.querySelector("h3");
    const badge = panel.querySelector(".studio-preview-header .wf-badge");
    const header = panel.querySelector(".studio-preview-header");
    const frame = panel.querySelector(".studio-device-frame");
    if (headerLabel) headerLabel.textContent = "CUSTOMER VIEW";
    if (heading) heading.textContent = "Customer card";
    badge?.remove();
    header?.insertAdjacentHTML(
      "afterend",
      '<div class="studio-preview-tabs" role="tablist"><button type="button" role="tab" aria-selected="true">Customer</button><button type="button" role="tab">Apple</button><button type="button" role="tab">Google</button></div>',
    );
    if (frame) {
      frame.className = "studio-device-frame studio-device-frame--customer_web";
      frame.innerHTML =
        '<div class="studio-preview-loading" role="status"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v6h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Preview will appear here</span></div>';
    }
  });
  const previousPreview = await livePreview.screenshot({ animations: "disabled" });

  await openScenario(page, { studioState: "LIVE_WITH_CHANGES", billingStatus: "ACTIVE" });
  await expect(page.getByText("Unpublished changes saved", { exact: true })).toBeVisible();
  await expect(page.getByText("Live · Unpublished changes", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Current published card summary" })).toBeVisible();
  await page.screenshot({
    path: path.join(finalPreviewEvidenceDirectory, "02-live-with-pending-changes-preview.png"),
    fullPage: true,
    animations: "disabled",
  });

  await openScenario(page, { studioState: "PAUSED", billingStatus: "ACTIVE" });
  await expect(page.getByLabel("Card preview").getByText("Paused", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Current published card summary" })).toBeVisible();
  await page.screenshot({
    path: path.join(finalPreviewEvidenceDirectory, "03-paused-published-preview.png"),
    fullPage: true,
    animations: "disabled",
  });

  const cellWidth = 680;
  const cellHeight = 500;
  const gutter = 24;
  const headerHeight = 88;
  const canvasWidth = cellWidth * 2 + gutter * 3;
  const canvasHeight = headerHeight + cellHeight + gutter * 2;
  const [beforeCell, afterCell] = await Promise.all(
    [previousPreview, repairedPreview].map((input) =>
      sharp(input)
        .resize({
          width: cellWidth,
          height: cellHeight,
          fit: "contain",
          background: "#ffffff",
        })
        .png()
        .toBuffer(),
    ),
  );
  const contactHeader = Buffer.from(`
    <svg width="${canvasWidth}" height="${headerHeight}">
      <rect width="100%" height="100%" fill="#efe9e1"/>
      <text x="${gutter}" y="32" font-family="Arial" font-size="17" font-weight="700" fill="#8c3f2d">NORMAL LIVE · BEFORE</text>
      <text x="${gutter}" y="62" font-family="Arial" font-size="24" font-weight="700" fill="#25343a">Preview will appear here</text>
      <text x="${cellWidth + gutter * 2}" y="32" font-family="Arial" font-size="17" font-weight="700" fill="#1f7a5a">NORMAL LIVE · AFTER</text>
      <text x="${cellWidth + gutter * 2}" y="62" font-family="Arial" font-size="24" font-weight="700" fill="#25343a">Actual published customer preview</text>
    </svg>
  `);
  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: "#efe9e1",
    },
  })
    .composite([
      { input: contactHeader, top: 0, left: 0 },
      { input: beforeCell, top: headerHeight + gutter, left: gutter },
      { input: afterCell, top: headerHeight + gutter, left: cellWidth + gutter * 2 },
    ])
    .png()
    .toFile(path.join(finalPreviewEvidenceDirectory, "04-preview-state-contact-sheet.png"));
});
