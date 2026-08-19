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
    await capture(page, name);
  }

  await page.goto("/ku-badini/dashboard/programs/created-program-id/edit");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".builder-shell")).toBeVisible();
  await capture(page, "i18n-builder-mobile-ku-badini.png");

  await page.goto("/ku-sorani/dashboard/programs/created-program-id");
  await expect(page.locator(".studio-shell")).toBeVisible();
  await capture(page, "i18n-studio-mobile-ku-sorani.png");

  await page.getByRole("button", { name: /Language|زمان|لغة/u }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await capture(page, "i18n-language-picker-mobile.png");
});
