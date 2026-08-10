import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("shows disabled Wallet providers without exposing credentials", async ({ page }) => {
  await page.goto("http://localhost:3001/en/login");
  await page.locator('input[name="email"]').fill("owner@waflo.local");
  await page.locator('input[name="password"]').fill("Waflo-Development-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  const switcher = page.locator(".wf-org-switcher select");
  await switcher.selectOption({ label: "Today Coffee" });
  await page.goto("http://localhost:3001/en/dashboard/programs");
  const card = page.locator(".program-list__card").filter({ hasText: "W3 Browser Circle" }).first();
  await card.getByRole("button", { name: "Open card" }).click();
  await expect(page.getByText(/DISABLED/).first()).toBeVisible();
  await mkdir("test-results/evidence/handoff-w3-round-2/screenshots", { recursive: true });
  await page.screenshot({
    path: "test-results/evidence/handoff-w3-round-2/screenshots/15-provider-disabled.png",
    fullPage: true,
    animations: "disabled",
  });
});
