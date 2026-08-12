import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  const blocking = result.violations.filter(
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

async function login(page: Page, email = "owner@waflo.local") {
  await page.goto("/en/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("Waflo-Development-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/dashboard(?:\/|$)/);
}

test("W4 operational dashboard screens and dialogs have no serious accessibility violations", async ({
  page,
}) => {
  await login(page);
  for (const section of ["customers", "team", "approvals", "risk", "analytics", "exports"]) {
    await page.goto(`/en/dashboard/${section}`);
    await expect(page.locator(".dashboard-main")).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press("Tab");
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName ?? ""))
      .not.toBe("BODY");
  }

  await page.goto("/en/dashboard/customers");
  await page
    .getByRole("table", { name: "Organization customers" })
    .getByRole("button")
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Close" }).click();

  await page.goto("/en/dashboard/team");
  await page.getByRole("button", { name: "Add staff" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Close" }).click();

  await page.goto("/en/dashboard/devices");
  await expect(page).toHaveURL(/\/en\/dashboard\/team$/);
  await expectAccessible(page);

  await page.goto("/en/dashboard/risk");
  await page.getByRole("button", { name: "Details" }).first().click();
  await expect(page.getByRole("heading", { name: "Risk signal detail" })).toBeVisible();
  await expectAccessible(page);
});

test("W4 Arabic RTL operations and Staff permission denial are accessible", async ({
  browser,
  page,
}) => {
  await login(page);
  for (const section of ["customers", "team", "approvals", "risk", "analytics", "exports"]) {
    await page.goto(`/ar/dashboard/${section}`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expectAccessible(page);
  }

  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  await login(staffPage, "staff@waflo.local");
  await staffPage.goto("/en/dashboard/customers");
  await expect(
    staffPage.getByText("This section requires Manager or Owner permission."),
  ).toBeVisible();
  await expectAccessible(staffPage);
  await staffContext.close();
});
