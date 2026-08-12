import { mkdir } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { mockTemplateGalleryApi, templateGalleryFixtures } from "./template-gallery-fixtures";

const evidenceDirectory = path.resolve("test-results/evidence/handoff-p6-final");
const programId = "created-program-id";

const visualFiles = [
  "01-final-library.png",
  "02-final-gallery.png",
  "03-final-builder.png",
  "04-final-studio.png",
  "05-final-test.png",
  "06-final-launch.png",
  "07-final-live.png",
  "08-final-mobile-390.png",
  "09-final-arabic-rtl.png",
] as const;

test.beforeAll(async () => {
  await mkdir(evidenceDirectory, { recursive: true });
});

function collectClientErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflowingElements: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 8)
      .map((element) => ({
        className: element.className,
        right: Math.round(element.getBoundingClientRect().right),
        tag: element.tagName,
      })),
  }));
  expect(
    geometry.scrollWidth <= geometry.clientWidth,
    `Horizontal overflow: ${JSON.stringify(geometry)}`,
  ).toBe(true);
}

async function expectNoSeriousAxeViolations(page: Page): Promise<void> {
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
}

async function chooseFirstTemplate(page: Page, locale: "en" | "ar" = "en"): Promise<void> {
  await page
    .locator(".template-gallery__section--recommended .template-gallery-card__preview")
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", {
      name: locale === "ar" ? "استخدام هذا القالب" : "Use this template",
    })
    .click();
  await expect(page.locator(".builder-shell")).toBeVisible();
}

async function openStudioArea(page: Page, name: RegExp, locale: "en" | "ar" = "en") {
  const mobileTrigger = page.locator(".studio-mobile-navigation > button");
  if (await mobileTrigger.isVisible()) await mobileTrigger.click();
  await page
    .getByRole("navigation", {
      name: locale === "ar" ? "أقسام الاستوديو" : "Studio sections",
    })
    .getByRole("button", { name })
    .click();
}

async function openSeededStudio(
  page: Page,
  options: {
    locale?: "en" | "ar";
    state?: "DRAFT" | "READY" | "LIVE";
    area?:
      | "overview"
      | "how-it-works"
      | "customers-locations"
      | "engagement"
      | "test"
      | "launch"
      | "settings";
    viewport?: { width: number; height: number };
  } = {},
): Promise<void> {
  const {
    locale = "en",
    state = "LIVE",
    area = "overview",
    viewport = { width: 1440, height: 900 },
  } = options;
  await mockTemplateGalleryApi(page, {
    seededProgram: true,
    studioState: state,
    billingStatus: state === "DRAFT" ? "PENDING_ACTIVATION" : "ACTIVE",
  });
  await page.setViewportSize(viewport);
  await page.goto(
    `/${locale}/dashboard/programs/${programId}${area === "overview" ? "" : `/${area}`}`,
  );
  await expect(page.locator(".studio-shell--p4")).toBeVisible();
}

async function capture(page: Page, filename: (typeof visualFiles)[number]): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(evidenceDirectory, filename),
    fullPage: true,
    animations: "disabled",
  });
}

async function makeContactSheet(): Promise<void> {
  const panelWidth = 500;
  const panelHeight = 320;
  const labelHeight = 44;
  const gap = 18;
  const margin = 24;
  const panels: Buffer[] = [];
  for (const filename of visualFiles) {
    const image = await sharp(path.join(evidenceDirectory, filename))
      .resize(panelWidth, panelHeight, { fit: "cover", position: "top" })
      .png()
      .toBuffer();
    const label = filename
      .replace(/^\d+-final-/u, "")
      .replace(".png", "")
      .replaceAll("-", " ");
    const header = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="${panelWidth}" height="${labelHeight}">
        <rect width="100%" height="100%" fill="#241916"/>
        <text x="18" y="29" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="#ffffff">${label}</text>
      </svg>
    `);
    panels.push(
      await sharp({
        create: {
          width: panelWidth,
          height: panelHeight + labelHeight,
          channels: 4,
          background: "#fffdfb",
        },
      })
        .composite([
          { input: header, top: 0, left: 0 },
          { input: image, top: labelHeight, left: 0 },
        ])
        .png()
        .toBuffer(),
    );
  }
  const sheetWidth = margin * 2 + panelWidth * 3 + gap * 2;
  const sheetHeight = margin * 2 + (panelHeight + labelHeight) * 3 + gap * 2;
  await sharp({
    create: { width: sheetWidth, height: sheetHeight, channels: 4, background: "#eee8df" },
  })
    .composite(
      panels.map((input, index) => ({
        input,
        left: margin + (index % 3) * (panelWidth + gap),
        top: margin + Math.floor(index / 3) * (panelHeight + labelHeight + gap),
      })),
    )
    .png()
    .toFile(path.join(evidenceDirectory, "10-final-release-contact-sheet.png"));
}

test("completes the final English merchant release journey", async ({ page }) => {
  const clientErrors = collectClientErrors(page);
  let patchCount = 0;
  await mockTemplateGalleryApi(page, {
    studioState: "READY",
    onPatch: () => {
      patchCount += 1;
    },
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/en/dashboard/programs");
  await expect(page.getByRole("heading", { level: 1, name: "Loyalty cards" })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  await page.getByRole("button", { name: "Create loyalty card" }).first().click();
  await expect(page).toHaveURL(/\/en\/dashboard\/programs\/new$/u);
  await expect(page.locator(".template-gallery-card")).toHaveCount(
    templateGalleryFixtures().length + 4,
  );

  await chooseFirstTemplate(page);
  await page.getByLabel("Card name in your dashboard").fill("P6 release coffee card");
  await expect.poll(() => patchCount).toBeGreaterThan(0);
  await expect(page.locator(".builder-save-state")).toContainText("Saved");
  const review = page.getByRole("button", { name: "Review card" });
  if (await review.isVisible()) await review.click();
  await page.getByRole("button", { name: "Continue to Studio" }).click();
  await expect(page).toHaveURL(`/en/dashboard/programs/${programId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "P6 release coffee card" }),
  ).toBeVisible();

  await openStudioArea(page, /^Test/u);
  await expect(page).toHaveURL(`/en/dashboard/programs/${programId}/test`);
  await page.getByRole("button", { name: "Start demo customer" }).click();
  await expect(page.getByRole("button", { name: "Reset demo customer" })).toBeVisible();

  await openStudioArea(page, /^Launch/u);
  await expect(page).toHaveURL(`/en/dashboard/programs/${programId}/launch`);
  await page.getByRole("button", { name: "Launch loyalty card" }).click();
  const dialog = page.getByRole("dialog", { name: "You’re about to launch this loyalty card" });
  await expect(dialog).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  const dialogBox = await dialog.boundingBox();
  expect(Math.abs((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0) / 2 - 720)).toBeLessThan(2);
  expect(Math.abs((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0) / 2 - 450)).toBeLessThan(2);
  await dialog.getByRole("button", { name: "Launch card" }).click();
  await expect(page.getByRole("button", { name: "Share loyalty card" })).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await openStudioArea(page, /^Settings/u);
  await expect(page).toHaveURL(`/en/dashboard/programs/${programId}/settings`);
  await expect(page.getByRole("button", { name: "Pause card" })).toBeVisible();
  expect(clientErrors).toEqual([]);
});

test("loads Studio deep links, refreshes, and fails safely for inaccessible cards", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page, {
    seededProgram: true,
    studioState: "LIVE",
    billingStatus: "ACTIVE",
  });
  const routeExpectations = [
    ["", "Overview"],
    ["/how-it-works", "How it works"],
    ["/customers-locations", "Customers & locations"],
    ["/engagement", "Wallet Engagement"],
    ["/test", "Test"],
    ["/launch", "Launch"],
    ["/settings", "Settings"],
  ] as const;
  for (const [suffix, heading] of routeExpectations) {
    const response = await page.goto(`/en/dashboard/programs/${programId}${suffix}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
  }

  await page.reload();
  await expect(page).toHaveURL(`/en/dashboard/programs/${programId}/settings`);
  await expect(page.getByRole("heading", { level: 2, name: "Settings" })).toBeVisible();

  await page.goto("/en/dashboard/programs/foreign-program-id/launch");
  const safeFailure = page.locator('.builder-loading--unavailable[role="alert"]');
  await expect(
    safeFailure.getByText("Loyalty Studio could not open", { exact: true }),
  ).toBeVisible();
  await expect(safeFailure).not.toContainText(/requestId|Prisma|tenant|organizationId/u);

  await page.goto("/en/dashboard/programs/foreign-program-id/edit");
  const safeBuilderFailure = page.locator('.builder-loading--unavailable[role="alert"]');
  await expect(safeBuilderFailure.getByText(/Card Builder could not open/u)).toBeVisible();
  await expect(safeBuilderFailure).not.toContainText(/requestId|Prisma|tenant|organizationId/u);

  const notFound = await page.goto(`/en/dashboard/programs/${programId}/not-a-studio-area`);
  expect(notFound?.status()).toBe(404);
  await expect(page.locator("body")).not.toBeEmpty();
});

test("keeps the Arabic RTL release path, centered dialog, and accessibility gate intact", async ({
  page,
}) => {
  const clientErrors = collectClientErrors(page);
  await openSeededStudio(page, {
    locale: "ar",
    state: "LIVE",
    area: "settings",
    viewport: { width: 390, height: 844 },
  });
  await expect(page.locator(".studio-shell--p4")).toHaveAttribute("dir", "rtl");
  await expect(page).toHaveURL(`/ar/dashboard/programs/${programId}/settings`);
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "الإعدادات" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page.getByText("MANAGE LOYALTY CARD", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: /^إيقاف البطاقة/u }).click();
  const dialog = page.getByRole("dialog", { name: /^إيقاف البطاقة/u });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - 195)).toBeLessThan(2);
  expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) / 2 - 422)).toBeLessThan(2);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();

  await expectNoSeriousAxeViolations(page);
  expect(clientErrors).toEqual([]);
});

test("keeps Arabic preview and Studio summaries localized with an honest English fallback", async ({
  context,
}) => {
  const englishEarningCopy = "Collect a cup stamp with every qualifying coffee.";
  const arabicEarningCopy = "اجمع ختم كوب مع كل طلب قهوة مؤهل.";

  const localized = await context.newPage();
  await openSeededStudio(localized, { locale: "ar", state: "LIVE" });
  const localizedPreview = localized.locator(".studio-published-customer-preview");
  const localizedSummary = localized.locator(".studio-overview__summary > section").first();
  await expect(localizedPreview).toContainText(arabicEarningCopy);
  await expect(localizedSummary).toContainText(arabicEarningCopy);
  await expect(localizedSummary).not.toContainText(englishEarningCopy);
  await localized.close();

  const fallback = await context.newPage();
  await mockTemplateGalleryApi(fallback, {
    seededProgram: true,
    studioState: "LIVE",
    billingStatus: "ACTIVE",
    arabicEarningCopy: "missing",
  });
  await fallback.goto(`/ar/dashboard/programs/${programId}`);
  await expect(fallback.locator(".studio-shell--p4")).toBeVisible();
  const fallbackSummary = fallback.locator(".studio-overview__summary > section").first();
  await expect(fallbackSummary).toContainText(englishEarningCopy);
  await expect(fallbackSummary).not.toContainText(arabicEarningCopy);
  await fallback.close();
});

test("keeps routed Studio dialogs centered and contained across the release viewport matrix", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page, {
    seededProgram: true,
    studioState: "LIVE",
    billingStatus: "ACTIVE",
  });
  const viewports = [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ] as const;

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(`/en/dashboard/programs/${programId}/settings`);
    await expect(page.getByRole("heading", { level: 2, name: "Settings" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "Pause card" }).click();
    const dialog = page.getByRole("dialog", { name: "Pause card" });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) / 2 - viewport.height / 2)).toBeLessThan(2);
    expect(box?.x ?? 0).toBeGreaterThanOrEqual(15);
    expect(viewport.width - ((box?.x ?? 0) + (box?.width ?? 0))).toBeGreaterThanOrEqual(15);
    expect(box?.y ?? 0).toBeGreaterThanOrEqual(15);
    expect(viewport.height - ((box?.y ?? 0) + (box?.height ?? 0))).toBeGreaterThanOrEqual(15);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  }
});

test("captures exactly the ten final P6 release visuals", async ({ context }) => {
  const library = await context.newPage();
  await mockTemplateGalleryApi(library, {
    existingPrograms: [
      {
        id: programId,
        internalName: "Classic Roast rewards",
        status: "PUBLISHED",
        updatedAt: "2026-08-07T09:30:00.000Z",
        currentDraftVersion: null,
        currentPublishedVersion: {
          id: "published-p6-version",
          versionNumber: 1,
          status: "PUBLISHED",
          publishedAt: "2026-08-07T09:00:00.000Z",
        },
        _count: { versions: 1 },
      },
    ],
  });
  await library.setViewportSize({ width: 1440, height: 900 });
  await library.goto("/en/dashboard/programs");
  await expect(library.locator(".program-list__card")).toBeVisible();
  await capture(library, "01-final-library.png");
  await library.close();

  const gallery = await context.newPage();
  await mockTemplateGalleryApi(gallery);
  await gallery.setViewportSize({ width: 1440, height: 900 });
  await gallery.goto("/en/dashboard/programs/new");
  const galleryCards = gallery.locator(
    'section[aria-labelledby="template-gallery-all-title"] .template-gallery-card',
  );
  await expect(galleryCards).toHaveCount(templateGalleryFixtures().length + 1);
  for (let index = 0; index < (await galleryCards.count()); index += 1) {
    await galleryCards.nth(index).scrollIntoViewIfNeeded();
    await expect(galleryCards.nth(index).locator("img")).toBeVisible();
  }
  await capture(gallery, "02-final-gallery.png");
  await gallery.close();

  const builder = await context.newPage();
  await mockTemplateGalleryApi(builder);
  await builder.setViewportSize({ width: 1440, height: 900 });
  await builder.goto("/en/dashboard/programs/new");
  await chooseFirstTemplate(builder);
  await expect(builder.locator(".builder-preview-desktop img")).toBeVisible();
  await capture(builder, "03-final-builder.png");
  await builder.close();

  const studio = await context.newPage();
  await openSeededStudio(studio, { state: "DRAFT" });
  await expect(studio.locator(".studio-device-frame img")).toBeVisible();
  await capture(studio, "04-final-studio.png");
  await studio.close();

  const testMode = await context.newPage();
  await openSeededStudio(testMode, { state: "READY", area: "test" });
  await expect(testMode.getByRole("button", { name: "Start demo customer" })).toBeVisible();
  await capture(testMode, "05-final-test.png");
  await testMode.close();

  const launch = await context.newPage();
  await openSeededStudio(launch, { state: "READY", area: "launch" });
  await expect(launch.getByRole("button", { name: "Launch loyalty card" })).toBeVisible();
  await capture(launch, "06-final-launch.png");
  await launch.close();

  const live = await context.newPage();
  await openSeededStudio(live, { state: "LIVE" });
  await expect(live.getByRole("img", { name: "Current published card summary" })).toBeVisible();
  await capture(live, "07-final-live.png");
  await live.close();

  const mobile = await context.newPage();
  await openSeededStudio(mobile, {
    state: "LIVE",
    viewport: { width: 390, height: 844 },
  });
  await expectNoHorizontalOverflow(mobile);
  await capture(mobile, "08-final-mobile-390.png");
  await mobile.close();

  const arabic = await context.newPage();
  await openSeededStudio(arabic, {
    locale: "ar",
    state: "LIVE",
    viewport: { width: 1440, height: 900 },
  });
  await expect(arabic.locator(".studio-shell--p4")).toHaveAttribute("dir", "rtl");
  const arabicSummary = arabic.locator(".studio-overview__summary > section").first();
  await expect(arabicSummary).toContainText("اجمع ختم كوب مع كل طلب قهوة مؤهل.");
  await expect(arabicSummary).not.toContainText(
    "Collect a cup stamp with every qualifying coffee.",
  );
  await capture(arabic, "09-final-arabic-rtl.png");
  await arabic.close();

  await makeContactSheet();
  expect(
    await Promise.all(
      [...visualFiles, "10-final-release-contact-sheet.png"].map(async (filename) =>
        sharp(path.join(evidenceDirectory, filename)).metadata(),
      ),
    ),
  ).toHaveLength(10);
});

test("updates only the repaired Arabic RTL and release contact-sheet evidence", async ({
  page,
}) => {
  await openSeededStudio(page, {
    locale: "ar",
    state: "LIVE",
    viewport: { width: 1440, height: 900 },
  });
  await expect(page.locator(".studio-shell--p4")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".studio-published-customer-preview")).toContainText(
    "اجمع ختم كوب مع كل طلب قهوة مؤهل.",
  );
  const summary = page.locator(".studio-overview__summary > section").first();
  await expect(summary).toContainText("اجمع ختم كوب مع كل طلب قهوة مؤهل.");
  await expect(summary).not.toContainText("Collect a cup stamp with every qualifying coffee.");
  await capture(page, "09-final-arabic-rtl.png");
  await makeContactSheet();
});
