import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mockTemplateGalleryApi } from "./template-gallery-fixtures";

test("configures provider-native nearby relevance and confirms one unified Wallet campaign", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page, {
    seededProgram: true,
    studioState: "LIVE",
    businessCategory: "Cafe",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/en/dashboard/programs/created-program-id/engagement");

  const engagement = page.getByTestId("wallet-engagement");
  await expect(engagement).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nearby Wallet reminders" })).toBeVisible();
  await expect(page.getByText("BUSINESS POLICY", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("DEVICE DELIVERY", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Apple determines when the pass becomes relevant", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Google Wallet determines nearby distance, dwell time", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Provider confirmation required", { exact: true })).toBeVisible();
  await expect(page.getByText("Google controls nearby wording", { exact: true })).toBeVisible();

  const mainLocation = page
    .locator(".wallet-location-option")
    .filter({ hasText: "Gallery Main Branch" });
  await mainLocation.locator('input[type="checkbox"]').check();
  await page.locator(".wallet-switch").click();
  await page.getByRole("button", { name: "Save nearby reminder" }).click();
  await expect(
    page.getByText("Nearby settings saved. Wallet pass updates are queued."),
  ).toBeVisible();
  await expect(page.locator(".wallet-nearby-preview")).toContainText("next coffee visit");

  await expect(page.locator(".wallet-audience-strip")).toContainText("12");
  const campaignForm = page.locator(".wallet-campaign-form");
  await expect(campaignForm.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(campaignForm).not.toContainText("Apple Wallet");
  await expect(campaignForm).not.toContainText("Google Wallet");
  await expect(campaignForm.locator("select.wf-select")).toHaveCount(2);
  await page.screenshot({
    path: "diagnostics/wallet-notification-ux/notification-composer-clean.png",
    fullPage: true,
  });
  const messageLanguage = page.getByRole("combobox", { name: "Message language" });
  const branchSelect = page.getByRole("combobox", { name: "Branch" });
  await messageLanguage.selectOption({ label: "English" });
  await expect(messageLanguage).toHaveValue("EN");
  await expect(messageLanguage).toHaveClass(/wf-select/u);
  await expect(branchSelect).toHaveClass(/wf-select/u);
  await expect(
    page.getByText("Optional: recorded transaction at branch", { exact: true }),
  ).toHaveCount(0);
  const [languageBox, branchBox] = await Promise.all([
    messageLanguage.boundingBox(),
    branchSelect.boundingBox(),
  ]);
  expect(languageBox?.height).toBe(branchBox?.height);
  await page.getByLabel("Title").fill("A new visit message");
  await page
    .getByRole("textbox", { name: /^Message /u })
    .fill("Your loyalty card is ready for your next visit.");
  await expect(page.getByText("WALLET MESSAGE PREVIEW")).toBeVisible();
  await expect(page.getByText("Your message will be delivered through Wallet")).toBeVisible();
  await page.getByRole("button", { name: "Review and send" }).click();

  const dialog = page.getByRole("dialog", { name: "Confirm Wallet message" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Classic Roast");
  await expect(dialog).toContainText("Eligible audience");
  await expect(dialog).toContainText("12");
  await expect(dialog).toContainText("Audience scope");
  await expect(dialog).toContainText("Entire program");
  await expect(dialog.getByText("Provider", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Provider-controlled presentation", { exact: true })).toHaveCount(
    0,
  );
  await expect(dialog).toContainText("A new visit message");
  await dialog.screenshot({
    path: "diagnostics/wallet-notification-ux/notification-confirmation-clean.png",
  });
  const centered = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2),
      y: Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2),
    };
  });
  expect(centered.x).toBeLessThanOrEqual(2);
  expect(centered.y).toBeLessThanOrEqual(2);
  const campaignRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/wallet-engagement/campaigns"),
  );
  await dialog.getByRole("button", { name: "Send now" }).click();
  expect((await campaignRequest).postDataJSON()).not.toHaveProperty("providers");
  await expect(page.getByText("Campaign created safely.", { exact: false })).toBeVisible();
  await expect(page.getByTestId("wallet-campaign-history")).toContainText("A new visit message");
  await page.screenshot({
    path: "diagnostics/wallet-notification-ux/notification-campaign-history.png",
    fullPage: true,
  });
  await page.screenshot({
    path: "test-results/wallet-engagement-desktop.png",
    fullPage: true,
  });

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

test("keeps Wallet Engagement usable in Arabic RTL on mobile", async ({ page }) => {
  await mockTemplateGalleryApi(page, {
    seededProgram: true,
    studioState: "LIVE",
    businessCategory: "Cafe",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar/dashboard/programs/created-program-id/engagement");

  await expect(page.locator(".studio-shell--p4")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "تذكيرات Wallet القريبة" })).toBeVisible();
  await expect(
    page.getByText("تحدد Google Wallet المسافة ومدة البقاء", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("بطاقة الولاء جاهزة لزيارتك القادمة", { exact: false }),
  ).toBeVisible();
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
  await page.screenshot({
    path: "test-results/wallet-engagement-mobile-ar.png",
    fullPage: true,
  });
});

test("denies Wallet Engagement and the surrounding Loyalty Studio to ordinary staff", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page, {
    seededProgram: true,
    studioState: "LIVE",
    memberRole: "STAFF",
  });
  await page.goto("/en/dashboard/programs/created-program-id/engagement");

  await expect(page.getByText("You do not have permission to open this section.")).toBeVisible();
  await expect(page.getByTestId("wallet-engagement")).toHaveCount(0);
});
