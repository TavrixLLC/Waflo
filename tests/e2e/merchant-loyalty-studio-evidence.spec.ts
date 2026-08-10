import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type BrowserContext, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { mockTemplateGalleryApi } from "./template-gallery-fixtures";

const evidenceDirectory = path.resolve(
  "test-results/evidence/uiux/loyalty-studio-p4a-repair-round1",
);

type StudioState =
  | "DRAFT"
  | "CHECKED"
  | "READY"
  | "LIVE"
  | "PAUSED"
  | "ARCHIVED"
  | "SCHEDULED"
  | "SUSPENDED";

async function openStudio(
  page: Page,
  {
    locale = "en",
    state = "DRAFT",
    width = 1440,
    height = 1000,
  }: { locale?: "en" | "ar"; state?: StudioState; width?: number; height?: number } = {},
): Promise<void> {
  await mockTemplateGalleryApi(page, { seededProgram: true, studioState: state });
  await page.setViewportSize({ width, height });
  await page.goto(`/${locale}/dashboard/programs/created-program-id`);
  await expect(page.locator(".studio-shell--p4")).toBeVisible();
  const publishedSummary = ["LIVE", "PAUSED", "ARCHIVED", "SUSPENDED"].includes(state);
  if (publishedSummary) {
    await expect(page.locator(".studio-published-customer-preview")).toBeVisible();
  } else {
    await expect(page.locator(".studio-device-frame img")).toBeVisible();
  }
}

async function capture(page: Page, filename: string, fullPage = true): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(evidenceDirectory, filename),
    fullPage,
    animations: "disabled",
  });
}

async function openArea(page: Page, name: RegExp, locale: "en" | "ar" = "en"): Promise<void> {
  const mobileTrigger = page.locator(".studio-mobile-navigation > button");
  if (await mobileTrigger.isVisible()) await mobileTrigger.click();
  await page
    .getByRole("navigation", { name: locale === "ar" ? "أقسام الاستوديو" : "Studio sections" })
    .getByRole("button", { name })
    .click();
}

async function labeledPanel(
  input: Buffer | string,
  label: string,
  width = 900,
  imageHeight = 620,
): Promise<Buffer> {
  const image = await sharp(input)
    .resize(width, imageHeight, { fit: "contain", background: "#f5f6fa" })
    .png()
    .toBuffer();
  const headingHeight = 58;
  const safeLabel = label.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const heading = Buffer.from(`
    <svg width="${width}" height="${headingHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${headingHeight}" fill="#211714"/>
      <text x="24" y="37" font-family="Arial, sans-serif" font-size="21" font-weight="700" fill="#fff">${safeLabel}</text>
    </svg>
  `);
  return sharp({
    create: {
      width,
      height: imageHeight + headingHeight,
      channels: 4,
      background: "#f5f6fa",
    },
  })
    .composite([
      { input: heading, top: 0, left: 0 },
      { input: image, top: headingHeight, left: 0 },
    ])
    .png()
    .toBuffer();
}

async function captureOverviewState(
  context: BrowserContext,
  state: StudioState,
  filename: string,
): Promise<void> {
  const page = await context.newPage();
  await openStudio(page, { state });
  await capture(page, filename);
  await page.close();
}

test("captures exactly the focused repair evidence set", async ({ context }) => {
  test.setTimeout(240_000);
  await mkdir(evidenceDirectory, { recursive: true });

  await captureOverviewState(context, "DRAFT", "01-draft-correct.png");
  await captureOverviewState(context, "READY", "02-ready-correct.png");
  await captureOverviewState(context, "LIVE", "03-live-correct.png");
  await captureOverviewState(context, "PAUSED", "04-paused-correct.png");
  await captureOverviewState(context, "ARCHIVED", "05-archived-correct.png");

  const launch = await context.newPage();
  await openStudio(launch, { state: "CHECKED" });
  await openArea(launch, /^Launch/u);
  await expect(launch.getByRole("heading", { name: "Not ready to launch" })).toBeVisible();
  await capture(launch, "06-launch-status-consistency.png");
  await launch.close();

  const customers = await context.newPage();
  await openStudio(customers);
  await openArea(customers, /^Customers & locations/u);
  await expect(customers.getByRole("heading", { name: "How customers join" })).toBeVisible();
  await capture(customers, "07-customers-enrollment-locations.png");
  await customers.close();

  const mobile = await context.newPage();
  await openStudio(mobile, { state: "READY", width: 390, height: 844 });
  await expect(mobile.locator('.studio-journey [aria-current="page"]')).toBeVisible();
  await expect(mobile.locator('.studio-journey [data-progression-state="current"]')).toBeVisible();
  await mobile.locator(".studio-mobile-navigation > button").click();
  await capture(mobile, "08-mobile-journey-navigation.png", false);
  await mobile.close();

  const arabicPanels: Buffer[] = [];
  for (const state of [
    "DRAFT",
    "READY",
    "LIVE",
    "PAUSED",
    "ARCHIVED",
    "SCHEDULED",
    "SUSPENDED",
  ] as const) {
    const page = await context.newPage();
    await openStudio(page, { locale: "ar", state, width: 900, height: 650 });
    const shot = await page.screenshot({ animations: "disabled" });
    arabicPanels.push(await labeledPanel(shot, state, 720, 500));
    await page.close();
  }
  const arabicPanelWidth = 720;
  const arabicPanelHeight = 558;
  await sharp({
    create: {
      width: arabicPanelWidth * 2,
      height: arabicPanelHeight * 4,
      channels: 4,
      background: "#e9ecee",
    },
  })
    .composite(
      arabicPanels.map((input, index) => ({
        input,
        top: Math.floor(index / 2) * arabicPanelHeight,
        left: (index % 2) * arabicPanelWidth,
      })),
    )
    .png()
    .toFile(path.join(evidenceDirectory, "09-arabic-lifecycle-states.png"));

  const testPage = await context.newPage();
  await openStudio(testPage, { width: 1100, height: 760 });
  await openArea(testPage, /^Test/u);
  await testPage.getByRole("button", { name: "Start demo customer" }).click();
  await testPage.getByRole("button", { name: "Add a stamp" }).click();
  await expect(testPage.getByText("1 / 8", { exact: true })).toBeVisible();
  const testPanel = await labeledPanel(
    await testPage.screenshot({ animations: "disabled" }),
    "Test spacing and action hierarchy",
  );
  await testPage.close();

  const historyPage = await context.newPage();
  await openStudio(historyPage, { width: 1440, height: 800 });
  await openArea(historyPage, /^Settings/u);
  await expect(historyPage.getByText("Publication state", { exact: true })).toBeVisible();
  const historyPanel = await labeledPanel(
    await historyPage.screenshot({ animations: "disabled" }),
    "History field separation",
  );
  await historyPage.close();
  await sharp({
    create: { width: 1800, height: 678, channels: 4, background: "#e9ecee" },
  })
    .composite([
      { input: historyPanel, top: 0, left: 0 },
      { input: testPanel, top: 0, left: 900 },
    ])
    .png()
    .toFile(path.join(evidenceDirectory, "10-history-and-test-spacing.png"));

  const lifecycleStates = [
    ["Live", path.join(evidenceDirectory, "03-live-correct.png")],
    ["Paused", path.join(evidenceDirectory, "04-paused-correct.png")],
    ["Archived", path.join(evidenceDirectory, "05-archived-correct.png")],
    ["Launch", path.join(evidenceDirectory, "06-launch-status-consistency.png")],
  ] as const;
  const lifecyclePanels = await Promise.all(
    lifecycleStates.map(([label, source]) => labeledPanel(source, label, 760, 470)),
  );
  const comparisonWidth = 760;
  const comparisonHeight = 528;
  await sharp({
    create: {
      width: comparisonWidth * 2,
      height: comparisonHeight * 2,
      channels: 4,
      background: "#e9ecee",
    },
  })
    .composite(
      lifecyclePanels.map((input, index) => ({
        input,
        top: Math.floor(index / 2) * comparisonHeight,
        left: (index % 2) * comparisonWidth,
      })),
    )
    .png()
    .toFile(path.join(evidenceDirectory, "11-current-lifecycle-contact-sheet.png"));
});
