import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { mockTemplateGalleryApi } from "./template-gallery-fixtures";

async function enterStudio(page: Page, locale: "en" | "ar" = "en"): Promise<void> {
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

async function openLaunch(page: Page, locale: "en" | "ar" = "en"): Promise<void> {
  const name = locale === "ar" ? /^الإطلاق/u : /^Review & launch/u;
  const mobileTrigger = page.locator(".studio-mobile-navigation > button");
  if (await mobileTrigger.isVisible()) await mobileTrigger.click();
  await page
    .getByRole("navigation", { name: locale === "ar" ? "أقسام الاستوديو" : "Studio sections" })
    .getByRole("button", { name })
    .click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/dashboard/programs/[^/]+/launch$`, "u"));
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: locale === "ar" ? "الإطلاق" : "Review & launch",
    }),
  ).toBeVisible();
}

async function openSettings(page: Page, locale: "en" | "ar" = "en"): Promise<void> {
  const mobileTrigger = page.locator(".studio-mobile-navigation > button");
  if (await mobileTrigger.isVisible()) await mobileTrigger.click();
  await page
    .getByRole("navigation", {
      name: locale === "ar" ? "أقسام الاستوديو" : "Studio sections",
    })
    .getByRole("button", { name: locale === "ar" ? /^الإعدادات/u : /^Settings/u })
    .click();
}

async function resetScenario(
  page: Page,
  options: Parameters<typeof mockTemplateGalleryApi>[1],
  viewport: { width: number; height: number },
  locale: "en" | "ar" = "en",
): Promise<void> {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await mockTemplateGalleryApi(page, options);
  await page.setViewportSize(viewport);
  await enterStudio(page, locale);
}

async function expectCenteredDialog(
  _page: Page,
  dialog: Locator,
  viewport: { width: number; height: number },
): Promise<void> {
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
  expect(box.x).toBeGreaterThanOrEqual(15);
  expect(box.y).toBeGreaterThanOrEqual(15);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 15);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 15);
  expect(
    await dialog.evaluate((element) => {
      const body = element.querySelector(".wf-dialog__body");
      return {
        modal: element.matches(":modal"),
        position: getComputedStyle(element).position,
        bodyOverflow: body ? getComputedStyle(body).overflowY : "missing",
        htmlOverflow: document.documentElement.style.overflow,
        documentOverflow:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    }),
  ).toEqual({
    modal: true,
    position: "fixed",
    bodyOverflow: "auto",
    htmlOverflow: "hidden",
    documentOverflow: false,
  });
}

test("launches a ready card once, with real execution and a focused success state", async ({
  page,
}) => {
  const requests: Array<{ body: Record<string, unknown>; count: number }> = [];
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://localhost:3101",
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:3101",
  });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://localhost:3001",
  });
  await mockTemplateGalleryApi(page, {
    studioState: "READY",
    publishDelayMs: 650,
    onPublish: (body, count) => requests.push({ body, count }),
  });
  await enterStudio(page);
  await openLaunch(page);

  await expect(page.getByRole("heading", { name: "What customers receive" })).toBeVisible();
  await expect(page.getByText("Customer Web", { exact: true })).toBeVisible();
  await expect(page.getByText("Launching starts your trial", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Launch loyalty card" }).click();

  const dialog = page.getByRole("dialog", {
    name: "You’re about to launch this loyalty card",
  });
  await expect(dialog.getByText("Eligible customers can join.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Launch card" }).click();
  await expect(dialog.getByText("Launching card…", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Launch card" })).toBeDisabled();

  await expect(page.locator(".publication-success")).toBeFocused();
  expect(requests).toHaveLength(1);
  expect(requests[0]?.body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
  await expect(page.getByRole("button", { name: "Share loyalty card" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View customers" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open public card page" })).toBeVisible();
  await page.getByRole("button", { name: "Share loyalty card" }).click();
  await expect(page.getByText("Preview link", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download enrollment QR as PNG" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download enrollment QR as SVG" })).toBeVisible();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText("Link copied", { exact: true }).first()).toBeVisible();
});

test("publishes an update while preserving the existing customer contract", async ({ page }) => {
  await mockTemplateGalleryApi(page, {
    studioState: "LIVE_WITH_CHANGES",
    billingStatus: "ACTIVE",
  });
  await enterStudio(page);

  await expect(page.getByText("Unpublished changes saved", { exact: true })).toBeVisible();
  await expect(page.getByText("Live · Unpublished changes", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Customers continue to see the current live version\./u),
  ).toBeVisible();
  await openLaunch(page);
  await expect(page.getByRole("heading", { name: "Ready to publish changes" })).toBeVisible();
  await expect(
    page.getByText("Existing customers keep their current membership rules and progress.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish changes" }).click();
  const dialog = page.getByRole("dialog", { name: "You’re about to publish changes" });
  await expect(
    dialog.getByText("Publication does not claim every existing Wallet pass has refreshed.", {
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Publish changes" }).click();
  await expect(page.locator(".publication-success")).toBeFocused();
  await expect(page.getByRole("button", { name: "Share loyalty card" })).toBeVisible();
});

test("keeps the review visible after failure and retries with the same idempotency key", async ({
  page,
}) => {
  const keys: unknown[] = [];
  await mockTemplateGalleryApi(page, {
    studioState: "READY",
    publicationFailures: 1,
    onPublish: (body) => keys.push(body.idempotencyKey),
  });
  await enterStudio(page);
  await openLaunch(page);
  await page.getByRole("button", { name: "Launch loyalty card" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Launch card" }).click();

  await expect(
    page.getByRole("heading", { name: "Publication could not be completed" }),
  ).toBeVisible();
  await expect(
    page.getByText("Your saved changes and current live card remain unchanged."),
  ).toBeVisible();
  await expect(page.getByText(/same request|idempoten/iu)).toHaveCount(0);
  await expect(page.getByText("What customers receive", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry publication" }).click();
  await expect(page.getByRole("heading", { name: "Your loyalty card is live" })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

test("recovers from publication conflicts without merchant-facing version language", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page, {
    studioState: "READY",
    publicationFailures: 1,
    publicationFailureCode: "STALE_PROGRAM_DRAFT",
  });
  await enterStudio(page);
  await openLaunch(page);
  await page.getByRole("button", { name: "Launch loyalty card" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Launch card" }).click();

  const failure = page.locator(".publication-failure");
  await expect(
    failure.getByRole("heading", { name: "This loyalty card changed in another session" }),
  ).toBeVisible();
  await expect(failure.getByRole("button", { name: "Load latest changes" })).toBeVisible();
  await expect(failure.getByRole("button", { name: "Return to Studio" })).toBeVisible();
  await expect(failure.getByText(/version/iu)).toHaveCount(0);
  await expect(failure.getByRole("button", { name: /Publish anyway/iu })).toHaveCount(0);
});

test("publishes a paused replacement without silently resuming the card", async ({ page }) => {
  await mockTemplateGalleryApi(page, {
    studioState: "PAUSED_WITH_CHANGES",
    billingStatus: "ACTIVE",
  });
  await enterStudio(page);
  await openLaunch(page);
  await expect(
    page.locator("#studio-area-content").getByText("The card will remain paused", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish changes" }).click();
  const dialog = page.getByRole("dialog", { name: "You’re about to publish changes" });
  await expect(dialog.getByText("The card will remain paused", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Publish changes" }).click();
  await expect(page.getByRole("heading", { name: "Changes published" })).toBeVisible();
  await expect(page.getByText(/remains paused until resumed/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume card" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share loyalty card" })).toHaveCount(0);
});

test("explains pause and archive consequences and records the lifecycle result", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page, { studioState: "LIVE", billingStatus: "ACTIVE" });
  await enterStudio(page);
  const navigation = page.getByRole("navigation", { name: "Studio sections" });
  await navigation.getByRole("button", { name: /^Settings/u }).click();

  await page.getByRole("button", { name: "Pause card" }).click();
  const pause = page.getByRole("dialog", { name: "Pause card" });
  await expect(
    pause.locator(".wf-dialog__body").getByText(/Existing customer cards remain viewable/u),
  ).toBeVisible();
  await pause.getByRole("button", { name: "Pause card" }).click();
  await expect(page.getByText("Loyalty card paused", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Archive card" }).click();
  const archive = page.getByRole("dialog", { name: "Archive card" });
  await expect(archive.getByText(/active-card slot is freed/u)).toBeVisible();
  await archive.getByRole("button", { name: "Archive card" }).click();
  await expect(page.getByText("Loyalty card archived", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Return to Loyalty Cards" })).toBeVisible();
  await page.getByRole("button", { name: "View change history" }).click();
  await expect(page.locator("#studio-change-history")).toBeFocused();
});

test("keeps ready, live, saved-change, paused, and archived access states truthful", async ({
  page,
}) => {
  const desktop = { width: 1440, height: 900 };

  await resetScenario(page, { studioState: "READY" }, desktop);
  await expect(
    page.getByRole("button", { name: /Live: Next required\. Publish to make available/u }),
  ).toBeVisible();
  await expect(page.getByText("Available to customers", { exact: true })).toHaveCount(0);

  await resetScenario(page, { studioState: "LIVE", billingStatus: "ACTIVE" }, desktop);
  const livePreview = page.getByRole("region", { name: "Card preview" });
  await expect(
    livePreview.getByRole("img", { name: "Current published card summary" }),
  ).toBeVisible();
  await expect(livePreview.getByText("Published card summary", { exact: true })).toBeVisible();
  await expect(livePreview.getByText("Currently live", { exact: true })).toBeVisible();
  await expect(livePreview.getByText("Preview will appear here", { exact: true })).toHaveCount(0);
  await expect(livePreview.getByText("Preview unavailable", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Share loyalty card" }).first()).toBeVisible();
  const liveShare = page.locator("#studio-live-sharing");
  await expect(liveShare.getByText("Enrollment open", { exact: true }).first()).toBeVisible();
  await expect(liveShare.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(liveShare.getByRole("button", { name: "Open join page" })).toBeVisible();
  await expect(
    liveShare.getByRole("button", { name: "Download enrollment QR as PNG" }),
  ).toBeVisible();

  await resetScenario(page, { studioState: "LIVE_WITH_CHANGES", billingStatus: "ACTIVE" }, desktop);
  const pendingPreview = page.getByRole("region", { name: "Card preview" });
  await expect(
    pendingPreview.getByRole("img", { name: "Current published card summary" }),
  ).toBeVisible();
  await expect(pendingPreview.getByText("Published card summary", { exact: true })).toBeVisible();
  await expect(pendingPreview.getByText("Currently live", { exact: true })).toBeVisible();
  await expect(pendingPreview.getByRole("tab", { name: "Customer" })).toHaveCount(0);
  await expect(page.getByText("Unpublished changes saved", { exact: true })).toBeVisible();
  await expect(page.getByText("Live · Unpublished changes", { exact: true })).toBeVisible();
  await expect(
    page
      .locator(".studio-next-action")
      .getByText(
        "Review the saved changes before publishing them. The current live card is unchanged.",
        { exact: true },
      ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Review changes" }).first()).toBeVisible();
  await expect(page.getByText("Preview will appear here", { exact: true })).toHaveCount(0);

  await resetScenario(page, { studioState: "PAUSED", billingStatus: "ACTIVE" }, desktop);
  const pausedPreview = page.getByRole("region", { name: "Card preview" });
  await expect(
    pausedPreview.getByRole("img", { name: "Current published card summary" }),
  ).toBeVisible();
  await expect(pausedPreview.getByText("Published card summary", { exact: true })).toBeVisible();
  await expect(pausedPreview.getByText("Paused", { exact: true })).toBeVisible();
  await expect(pausedPreview.getByText("Currently live", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Resume card" }).first()).toBeVisible();
  const pausedShare = page.locator("#studio-live-sharing");
  await expect(
    pausedShare.getByText("Sharing is unavailable while this loyalty card is paused.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(pausedShare.getByRole("button", { name: "Copy link" })).toHaveCount(0);
  await expect(pausedShare.getByRole("button", { name: "Open join page" })).toHaveCount(0);
  await expect(pausedShare.getByRole("button", { name: /Download enrollment QR/u })).toHaveCount(0);

  await resetScenario(page, { studioState: "ARCHIVED", billingStatus: "ACTIVE" }, desktop);
  const archivedPreview = page.getByRole("region", { name: "Card preview" });
  await expect(
    archivedPreview.getByRole("img", { name: "Current published card summary" }),
  ).toBeVisible();
  await expect(archivedPreview.getByText("Published card summary", { exact: true })).toBeVisible();
  await expect(archivedPreview.getByText("Archived", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore card" }).first()).toBeVisible();
  const archivedShare = page.locator("#studio-live-sharing");
  await expect(
    archivedShare.getByText("Restore this loyalty card to share it again.", { exact: true }),
  ).toBeVisible();
  await expect(archivedShare.getByRole("button", { name: "Copy link" })).toHaveCount(0);
  await expect(archivedShare.getByRole("button", { name: "Open join page" })).toHaveCount(0);
  await expect(archivedShare.getByRole("button", { name: /Download enrollment QR/u })).toHaveCount(
    0,
  );

  await resetScenario(
    page,
    {
      studioState: "ARCHIVED",
      billingStatus: "ACTIVE",
      publishedPreviewAvailable: false,
    },
    desktop,
  );
  const unavailableArchivedPreview = page.getByRole("region", { name: "Card preview" });
  await expect(
    unavailableArchivedPreview.getByText("Preview unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    unavailableArchivedPreview.getByRole("img", { name: "Current published card summary" }),
  ).toHaveCount(0);
});

test("distinguishes a loading customer preview from a confirmed unavailable preview", async ({
  page,
}) => {
  const desktop = { width: 1440, height: 900 };
  await resetScenario(page, { studioState: "READY", previewDelayMs: 600 }, desktop);

  const loadingPreview = page.getByRole("region", { name: "Card preview" });
  await expect(loadingPreview.getByText("Loading preview…", { exact: true })).toBeVisible();
  await expect(loadingPreview.getByText("Preview unavailable", { exact: true })).toHaveCount(0);
  await expect(loadingPreview.getByRole("img", { name: "Customer card preview" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(loadingPreview.getByText("Published card summary", { exact: true })).toHaveCount(0);

  await page.route("**/programs/created-program-id/preview?**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "PROGRAM_PREVIEW_UNAVAILABLE", message: "Preview unavailable." },
      }),
    });
  });
  await loadingPreview.getByRole("slider").fill("1");
  await expect(loadingPreview.getByText("Preview unavailable", { exact: true })).toBeVisible();
  await expect(loadingPreview.getByText("Loading preview…", { exact: true })).toHaveCount(0);
});

test("centers and locks publication and lifecycle dialogs across the required viewport matrix", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const viewports = [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ];

  for (const [index, viewport] of viewports.entries()) {
    let publicationRequests = 0;
    await resetScenario(
      page,
      {
        studioState: "READY",
        publishDelayMs: 700,
        onPublish: () => {
          publicationRequests += 1;
        },
      },
      viewport,
    );
    await openLaunch(page);
    const launchTrigger = page.getByRole("button", { name: "Launch loyalty card" });
    await launchTrigger.focus();
    await launchTrigger.click();
    let dialog = page.getByRole("dialog", {
      name: "You’re about to launch this loyalty card",
    });
    await expectCenteredDialog(page, dialog, viewport);
    expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(
      true,
    );
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(
      true,
    );

    if (index === 0) {
      await dialog.getByRole("button", { name: "Back to review" }).click();
      await expect(launchTrigger).toBeFocused();
      await launchTrigger.click();
      dialog = page.getByRole("dialog", {
        name: "You’re about to launch this loyalty card",
      });
    }

    await dialog.getByRole("button", { name: "Launch card" }).click();
    await expect(dialog.getByText("Launching card…", { exact: true })).toBeVisible();
    await expectCenteredDialog(page, dialog, viewport);
    await expect(dialog.getByRole("button", { name: "Close" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Back to review" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Launch card" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your loyalty card is live" })).toBeVisible();
    expect(publicationRequests).toBe(1);

    await resetScenario(
      page,
      { studioState: "LIVE_WITH_CHANGES", billingStatus: "ACTIVE" },
      viewport,
    );
    await openLaunch(page);
    await page.getByRole("button", { name: "Publish changes" }).click();
    dialog = page.getByRole("dialog", { name: "You’re about to publish changes" });
    await expectCenteredDialog(page, dialog, viewport);
    await dialog.getByRole("button", { name: "Back to review" }).click();

    await resetScenario(page, { studioState: "LIVE", billingStatus: "ACTIVE" }, viewport);
    await openSettings(page);
    await page.getByRole("button", { name: "Pause card" }).click();
    dialog = page.getByRole("dialog", { name: "Pause card" });
    await expectCenteredDialog(page, dialog, viewport);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Archive card" }).click();
    dialog = page.getByRole("dialog", { name: "Archive card" });
    await expectCenteredDialog(page, dialog, viewport);
    await dialog.getByRole("button", { name: "Cancel" }).click();
  }

  const shortMobile = { width: 360, height: 420 };
  await resetScenario(page, { studioState: "READY" }, shortMobile);
  await openLaunch(page);
  await page.getByRole("button", { name: "Launch loyalty card" }).click();
  const longDialog = page.getByRole("dialog", {
    name: "You’re about to launch this loyalty card",
  });
  await expectCenteredDialog(page, longDialog, shortMobile);
  expect(
    await longDialog
      .locator(".wf-dialog__body")
      .evaluate((body) => body.scrollHeight > body.clientHeight),
  ).toBe(true);
});

test("keeps Arabic publication and lifecycle dialogs centered with logical focus", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const viewport = { width: 390, height: 844 };
  await resetScenario(page, { studioState: "READY", publishDelayMs: 650 }, viewport, "ar");
  await openLaunch(page, "ar");
  await page.getByRole("button", { name: "إطلاق بطاقة الولاء" }).click();
  let dialog = page.getByRole("dialog");
  await expectCenteredDialog(page, dialog, viewport);
  await dialog.getByRole("button", { name: "إطلاق البطاقة" }).click();
  await expect(dialog.getByText("جارٍ إطلاق البطاقة…", { exact: true })).toBeVisible();
  await expectCenteredDialog(page, dialog, viewport);
  await expect(dialog.getByRole("button", { name: "إغلاق" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(page.locator(".publication-success")).toBeFocused();

  await resetScenario(
    page,
    { studioState: "LIVE_WITH_CHANGES", billingStatus: "ACTIVE" },
    viewport,
    "ar",
  );
  await openLaunch(page, "ar");
  await page.getByRole("button", { name: "نشر التغييرات" }).click();
  dialog = page.getByRole("dialog");
  await expectCenteredDialog(page, dialog, viewport);
  await dialog.getByRole("button", { name: "العودة إلى المراجعة" }).click();

  await resetScenario(page, { studioState: "LIVE", billingStatus: "ACTIVE" }, viewport, "ar");
  await openSettings(page, "ar");
  await page.getByRole("button", { name: /^إيقاف البطاقة/u }).click();
  dialog = page.getByRole("dialog");
  await expectCenteredDialog(page, dialog, viewport);
  await dialog.getByRole("button", { name: "إلغاء" }).click();
  await page.getByRole("button", { name: /^أرشفة البطاقة/u }).click();
  dialog = page.getByRole("dialog");
  await expectCenteredDialog(page, dialog, viewport);

  await resetScenario(page, { studioState: "READY", publicationFailures: 1 }, viewport, "ar");
  await openLaunch(page, "ar");
  await page.getByRole("button", { name: "إطلاق بطاقة الولاء" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "إطلاق البطاقة" }).click();
  let failure = page.locator(".publication-failure");
  await expect(failure.getByRole("heading", { name: "تعذر إكمال النشر" })).toBeVisible();
  await expect(failure.getByRole("button", { name: "إعادة محاولة النشر" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);

  await resetScenario(
    page,
    {
      studioState: "READY",
      publicationFailures: 1,
      publicationFailureCode: "STALE_PROGRAM_DRAFT",
    },
    viewport,
    "ar",
  );
  await openLaunch(page, "ar");
  await page.getByRole("button", { name: "إطلاق بطاقة الولاء" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "إطلاق البطاقة" }).click();
  failure = page.locator(".publication-failure");
  await expect(
    failure.getByRole("heading", { name: "تغيّرت بطاقة الولاء في جلسة أخرى" }),
  ).toBeVisible();
  await expect(failure.getByRole("button", { name: "تحميل أحدث التغييرات" })).toBeVisible();
  await expect(failure.getByRole("button", { name: "العودة إلى الاستوديو" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
});

test("shows mixed Wallet truth and remains accessible at 360px in English and Arabic", async ({
  page,
}) => {
  for (const locale of ["en", "ar"] as const) {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await mockTemplateGalleryApi(page, {
      studioState: "READY",
      walletHealth: [
        {
          provider: "APPLE",
          mode: "TEST_ADAPTER",
          status: "HEALTHY",
          configured: true,
          providerReachable: true,
          productionCertified: false,
        },
        {
          provider: "GOOGLE",
          mode: "REAL_PROVIDER",
          status: "DEGRADED",
          configured: true,
          providerReachable: false,
          productionCertified: false,
        },
      ],
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await enterStudio(page, locale);
    await openLaunch(page, locale);
    await expect(
      page
        .locator(".publication-wallet-list")
        .getByText(locale === "ar" ? "جاهزة" : "Ready", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(locale === "ar" ? "غير متاحة مؤقتاً" : "Temporarily unavailable", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  }
});
