import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { mockTemplateGalleryApi } from "./template-gallery-fixtures";

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
  await expect(page).toHaveURL(
    new RegExp(`/${locale}/dashboard/programs/created-program-id/edit$`, "u"),
  );
  const reviewCard = page.getByRole("button", {
    name: locale === "ar" ? "مراجعة البطاقة" : "Review card",
  });
  const continueToStudio = page.getByRole("button", {
    name: locale === "ar" ? "المتابعة إلى الاستوديو" : "Continue to Studio",
  });
  await expect(reviewCard.or(continueToStudio)).toBeVisible();
  if (locale === "en" && (await reviewCard.isVisible())) {
    await page
      .getByRole("button", { name: /^Reward/u })
      .first()
      .click();
    await expect(page.getByLabel("Reward validity in days")).toHaveCount(0);
    await page
      .getByRole("button", { name: /^Advanced settings/u })
      .first()
      .click();
    await expect(page.getByText("Operational rules live in Studio", { exact: true })).toBeVisible();
    await expect(page.getByText("Preview surface details", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Operational timezone")).toHaveCount(0);
  }
  if (await reviewCard.isVisible()) {
    await reviewCard.click();
    await expect(
      page
        .getByText(locale === "ar" ? "اجتازت البطاقة فحوصات الجاهزية" : "Readiness checks passed", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
  }
  await continueToStudio.click();
}

test("continues from Builder into a six-area merchant Studio without duplicate design editors", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterStudio(page, "en");

  const navigation = page.getByRole("navigation", { name: "Studio sections" });
  await expect(navigation.getByRole("button")).toHaveCount(6);
  for (const label of [
    "Overview",
    "How it works",
    "Customers & locations",
    "Test",
    "Launch",
    "Settings",
  ]) {
    await expect(navigation.getByRole("button", { name: new RegExp(label, "u") })).toBeVisible();
  }

  await expect(page.getByText("Card design complete", { exact: true })).toBeVisible();
  await expect(page.getByText("Next: Run readiness checks", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit design" })).toBeVisible();
  await expect(page.getByLabel("Internal name")).toHaveCount(0);
  await expect(page.getByLabel("Card name")).toHaveCount(0);
  await expect(page.getByText("Save to preview", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/ProgramVersion|Ledger projection|RewardEntitlement/u)).toHaveCount(
    0,
  );

  await navigation.getByRole("button", { name: /^How it works/u }).focus();
  await page.keyboard.press("Enter");
  await page.getByText("Advanced earning and redemption rules", { exact: true }).click();
  await expect(page.getByLabel("Valid for (days)").first()).toBeVisible();
  await expect(page.getByLabel("Require manager approval to redeem").first()).toBeVisible();

  await navigation.getByRole("button", { name: /^Test/u }).click();
  await expect(page.getByText("Test safely with a demo customer", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start demo customer" })).toBeVisible();

  await navigation.getByRole("button", { name: /^Launch/u }).click();
  await expect(page.getByRole("heading", { name: "Not ready to launch" })).toBeVisible();
  await expect(
    page.locator(".studio-launch-action").getByRole("button", { name: "Run checks" }),
  ).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);

  await navigation.getByRole("button", { name: /^Overview/u }).click();
  await page.getByRole("button", { name: "Edit design" }).click();
  await expect(page).toHaveURL(/\/en\/dashboard\/programs\/created-program-id\/edit$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Customize your loyalty card" }),
  ).toBeVisible();
});

test("uses a discoverable mobile menu and complete Arabic RTL navigation", async ({ page }) => {
  await mockTemplateGalleryApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await enterStudio(page, "ar");

  await expect(page.locator(".studio-shell--p4")).toHaveAttribute("dir", "rtl");
  const mobileTrigger = page.locator(".studio-mobile-navigation > button");
  await expect(mobileTrigger).toBeVisible();
  await expect(mobileTrigger).toContainText("نظرة عامة");
  await mobileTrigger.click();

  const navigation = page.getByRole("navigation", { name: "أقسام الاستوديو" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("button")).toHaveCount(6);
  for (const label of [
    "نظرة عامة",
    "طريقة العمل",
    "العملاء والمواقع",
    "الاختبار",
    "الإطلاق",
    "الإعدادات",
  ]) {
    await expect(navigation.getByRole("button", { name: new RegExp(label, "u") })).toBeVisible();
  }
  await navigation.getByRole("button", { name: /^الاختبار/u }).click();
  await expect(page.getByText("اختبر بأمان مع عميل تجريبي", { exact: true })).toBeVisible();
  await expect(mobileTrigger).toBeFocused();

  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
});

test("keeps the Studio responsive across every required breakpoint", async ({ page }) => {
  await mockTemplateGalleryApi(page);
  await enterStudio(page, "en");

  for (const size of [
    { width: 1440, height: 1000 },
    { width: 1280, height: 900 },
    { width: 1024, height: 900 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]) {
    await page.setViewportSize(size);
    await expect(page.locator(".studio-shell--p4")).toBeVisible();
    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(noOverflow, `${size.width}px viewport should not overflow`).toBe(true);
    if (size.width <= 820) {
      await expect(page.locator(".studio-mobile-navigation > button")).toBeVisible();
    } else {
      await expect(page.getByRole("navigation", { name: "Studio sections" })).toBeVisible();
    }
  }
});

test("routes launch blockers to the merchant area that can fix them", async ({ page }) => {
  await mockTemplateGalleryApi(page, {
    validationErrors: [
      {
        code: "PROGRAM_LOCATION_REQUIRED",
        path: "locations",
        message: "Choose at least one participating location.",
        suggestedAction: "Open Customers & locations and select a location.",
        severity: "error",
      },
    ],
  });
  await enterStudio(page, "en");
  const navigation = page.getByRole("navigation", { name: "Studio sections" });
  await navigation.getByRole("button", { name: /^Launch/u }).click();
  await page.locator(".studio-launch-action").getByRole("button", { name: "Run checks" }).click();
  await expect(page.getByText("1 launch blockers", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Choose at least one participating location/u }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Customers & locations" }),
  ).toBeVisible();
});

test("preserves edits when the card changed elsewhere without exposing revision numbers", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page, { patchConflicts: 1 });
  await enterStudio(page, "en");
  const navigation = page.getByRole("navigation", { name: "Studio sections" });
  await navigation.getByRole("button", { name: /^How it works/u }).click();
  await page.getByText("Advanced earning and redemption rules", { exact: true }).click();
  await page.getByLabel("Valid for (days)").first().fill("30");

  const conflict = page.getByRole("dialog", { name: "Edited elsewhere" });
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText("Your local edits are preserved");
  await expect(conflict).not.toContainText(/revision/u);
  await conflict.getByRole("button", { name: "Load latest card" }).click();
  await expect(conflict).toBeHidden();
  await expect(page.locator(".studio-save-state")).toContainText("Saved");
});

const lifecycleScenarios = [
  [
    "DRAFT",
    "Draft",
    "Not visible to real customers until it is launched.",
    "Card design complete",
    "Pending",
    "Run readiness checks",
    "Not ready to launch",
    "Run checks",
    "Archive card",
  ],
  [
    "CHECKED",
    "Draft",
    "Not visible to real customers until it is launched.",
    "Automated checks passed",
    "Pending",
    "Start test",
    "Not ready to launch",
    "Go to Test",
    "Archive card",
  ],
  [
    "READY",
    "Ready to launch",
    "Required checks and testing are complete. The card is not live yet.",
    "Ready to launch",
    "Next required",
    "Review launch",
    "Ready to launch",
    "Launch loyalty card",
    "Archive card",
  ],
  [
    "LIVE",
    "Live",
    "Currently available to eligible customers.",
    "Your loyalty card is live",
    "Complete",
    "Share loyalty card",
    "Card is live",
    "View customers",
    "Pause card",
  ],
  [
    "PAUSED",
    "Paused",
    "The card setup is retained, but new activity is temporarily unavailable.",
    "Your loyalty card is paused",
    "Paused",
    "Resume card",
    "Card is paused",
    "Resume card",
    "Resume card",
  ],
  [
    "ARCHIVED",
    "Archived",
    "Removed from normal operation and available to restore with its saved setup.",
    "This loyalty card is archived",
    "Archived",
    "Restore card",
    "Card is archived",
    "Restore card",
    "Restore card",
  ],
  [
    "SCHEDULED",
    "Scheduled to go live",
    "This card is waiting for its existing scheduled launch.",
    "Your loyalty card is scheduled",
    "Next required",
    "View launch schedule",
    "Scheduled to go live",
    "View launch schedule",
    "Archive card",
  ],
  [
    "SUSPENDED",
    "Temporarily unavailable",
    "This card is unavailable under the existing suspension rule.",
    "Your loyalty card is temporarily unavailable",
    "Blocked",
    "Review customer access",
    "Launch unavailable",
    "View card status",
    "Archive card",
  ],
] as const;

for (const [
  state,
  label,
  description,
  guidance,
  journey,
  overviewAction,
  launchStatus,
  launchAction,
  settingsAction,
] of lifecycleScenarios) {
  test(`keeps ${state.toLocaleLowerCase("en-US")} lifecycle truth consistent across Studio`, async ({
    page,
  }) => {
    await mockTemplateGalleryApi(page, { studioState: state });
    await page.setViewportSize({ width: 1280, height: 900 });
    await enterStudio(page, "en");

    await expect(
      page.locator(".studio-title-line").getByText(label, { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".studio-toolbar__title").getByText(description, { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".studio-handoff").getByText(guidance, { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".studio-journey").getByRole("button", {
        name: new RegExp(`^Live: ${journey}\\.`, "u"),
      }),
    ).toBeVisible();
    await expect(
      page.locator(".studio-next-action").getByRole("button", { name: overviewAction }),
    ).toBeVisible();

    const navigation = page.getByRole("navigation", { name: "Studio sections" });
    await navigation.getByRole("button", { name: /^Launch/u }).click();
    await expect(page.getByRole("heading", { name: launchStatus })).toBeVisible();
    await expect(
      page.locator(".studio-launch-action").getByRole("button", { name: launchAction }),
    ).toBeVisible();

    await navigation.getByRole("button", { name: /^Settings/u }).click();
    await expect(
      page.locator(".studio-lifecycle-actions").getByRole("button", { name: settingsAction }),
    ).toBeVisible();

    if (["LIVE", "PAUSED", "ARCHIVED"].includes(state)) {
      await expect(page.getByText("Run readiness checks", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Card design complete", { exact: true })).toHaveCount(0);
    }
  });
}

test("shows complete customer access controls and truthful optional Wallet availability", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page, { studioState: "LIVE" });
  await enterStudio(page, "en");
  const navigation = page.getByRole("navigation", { name: "Studio sections" });
  await navigation.getByRole("button", { name: /^Customers & locations/u }).click();

  await expect(page.getByRole("heading", { name: "Participating locations" })).toBeVisible();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How customers join" })).toBeVisible();
  await expect(page.getByLabel("Card link name")).toHaveValue("gallery-coffee-rewards");
  await expect(page.getByRole("button", { name: "Download enrollment QR as PNG" })).toBeVisible();
  await expect(page.getByLabel("Primary customer language")).toHaveValue("en");
  await expect(page.getByLabel("Show separate marketing consent")).toBeChecked();

  await navigation.getByRole("button", { name: /^Launch/u }).click();
  await expect(page.getByText("Apple Wallet", { exact: true })).toBeVisible();
  await expect(page.getByText("Google Wallet", { exact: true })).toBeVisible();
  await expect(page.getByText("Status unavailable", { exact: true })).toHaveCount(2);
  await expect(
    page.getByText("No provider data is available. This does not block Customer Web launch.", {
      exact: true,
    }),
  ).toHaveCount(2);
});

test("uses spaced Test stats, one primary progression action, and a truthful reset label", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page);
  await enterStudio(page, "en");
  const navigation = page.getByRole("navigation", { name: "Studio sections" });
  await navigation.getByRole("button", { name: /^Test/u }).click();
  await page.getByRole("button", { name: "Start demo customer" }).click();

  await expect(page.getByText("Current progress", { exact: true })).toBeVisible();
  await expect(page.getByText("0 / 8", { exact: true })).toBeVisible();
  await expect(page.getByText("Completed cycles", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a stamp" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+5 stamps" })).toHaveAttribute(
    "class",
    /secondary/u,
  );
  await expect(page.getByRole("button", { name: "Reset demo customer" })).toBeVisible();
});

test("separates the current Studio location from the next required journey stage in LTR and RTL", async ({
  page,
}) => {
  for (const locale of ["en", "ar"] as const) {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await mockTemplateGalleryApi(page, { studioState: "READY" });
    await page.setViewportSize({ width: 360, height: 800 });
    await enterStudio(page, locale);
    const currentLocation = page.locator('.studio-journey [aria-current="page"]');
    const nextRequired = page.locator('.studio-journey [data-progression-state="current"]');
    await expect(currentLocation).toBeVisible();
    await expect(nextRequired).toBeVisible();
    await expect(nextRequired).toContainText(locale === "ar" ? "المطلوبة تاليًا" : "Next required");
    expect(
      await nextRequired.evaluate((element) => {
        const stage = element.getBoundingClientRect();
        const rail = element.parentElement?.getBoundingClientRect();
        return Boolean(rail && stage.left >= rail.left && stage.right <= rail.right);
      }),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }
});
