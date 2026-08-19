import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { mockTemplateGalleryApi } from "./template-gallery-fixtures";

const reviewDirectory = path.resolve("artifacts", "p1-final-review");

async function capture(page: Page, name: string): Promise<void> {
  await mkdir(reviewDirectory, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
  await page.screenshot({
    path: path.join(reviewDirectory, name),
    animations: "disabled",
    caret: "hide",
  });
}

async function enterBuilder(page: Page): Promise<void> {
  await page.goto("/en/dashboard/programs/new");
  const templates = page.locator('section[aria-labelledby="template-gallery-all-title"]');
  await templates.getByRole("button", { name: "Preview: Classic Roast, all templates" }).click();
  await page
    .getByRole("dialog", { name: "Classic Roast" })
    .getByRole("button", { name: "Use this template" })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/programs\/created-program-id\/edit$/u);
  await expect(page.locator(".builder-shell")).toBeVisible();
}

async function assertKurdishStudioSurface(page: Page, surface: ".builder-shell" | ".studio-shell") {
  const container = page.locator(surface);
  await expect(container).not.toContainText("Card name in your dashboard");
  await expect(container).not.toContainText("Customers do not see this internal name");
  await expect(container).not.toContainText("Stamp goal");
  await expect(container).not.toContainText("Saved changes");
  await expect(container).not.toContainText("Run automated checks");
  const fontFamily = await container.evaluate((element) => getComputedStyle(element).fontFamily);
  expect(fontFamily.toLowerCase()).toContain("kurdistan24");
}

test("captures the centralized loyalty interface catalog across all four locales", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await mockTemplateGalleryApi(page, { studioLoadDelayMs: 500 });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto("/en/dashboard/programs/new");
  await expect(page.locator(".template-gallery")).toBeVisible();
  await capture(page, "i18n-template-gallery-desktop-en.png");

  await enterBuilder(page);
  for (const [locale, name] of [
    ["en", "i18n-builder-desktop-en.png"],
    ["ar", "i18n-builder-desktop-ar.png"],
    ["ku-badini", "i18n-builder-desktop-ku-badini.png"],
    ["ku-sorani", "i18n-builder-desktop-ku-sorani.png"],
  ] as const) {
    await page.goto("/" + locale + "/dashboard/programs/created-program-id/edit");
    await expect(page.locator(".builder-shell")).toBeVisible();
    if (locale.startsWith("ku-")) await assertKurdishStudioSurface(page, ".builder-shell");
    await capture(page, name);
  }

  for (const [locale, name] of [
    ["en", "i18n-studio-desktop-en.png"],
    ["ar", "i18n-studio-desktop-ar.png"],
    ["ku-badini", "i18n-studio-desktop-ku-badini.png"],
    ["ku-sorani", "i18n-studio-desktop-ku-sorani.png"],
  ] as const) {
    await page.goto("/" + locale + "/dashboard/programs/created-program-id");
    await expect(page.locator(".studio-shell")).toBeVisible();
    if (locale.startsWith("ku-")) await assertKurdishStudioSurface(page, ".studio-shell");
    await capture(page, name);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const locale of ["ku-badini", "ku-sorani"] as const) {
    await page.goto("/" + locale + "/dashboard/programs/created-program-id/edit");
    await expect(page.locator(".builder-shell")).toBeVisible();
    await assertKurdishStudioSurface(page, ".builder-shell");
    await capture(page, `i18n-builder-mobile-${locale}.png`);

    await page.goto("/" + locale + "/dashboard/programs/created-program-id");
    await expect(page.locator(".studio-shell")).toBeVisible();
    await assertKurdishStudioSurface(page, ".studio-shell");
    await capture(page, `i18n-studio-mobile-${locale}.png`);

    await page.goto("/" + locale + "/dashboard/programs");
    await expect(page.locator(".programs-home")).toBeVisible();
    await capture(page, `i18n-programs-${locale}.png`);

    await page.goto("/" + locale + "/dashboard/programs/new");
    await expect(page.locator(".template-gallery")).toBeVisible();
    await capture(page, `i18n-template-gallery-${locale}.png`);
  }

  await page.goto("/ar/dashboard/programs/created-program-id");
  await expect(page.locator(".studio-shell")).toBeVisible();
  const arabicFontFamily = await page
    .locator(".studio-shell")
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(arabicFontFamily.toLowerCase()).toContain("cairo");

  await page.getByRole("button", { name: /Language|زمان|لغة/u }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await capture(page, "i18n-language-picker-mobile.png");
});
