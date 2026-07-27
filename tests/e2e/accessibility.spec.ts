import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function expectNoCriticalViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
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

async function loginAsSeedOwner(page: Page): Promise<void> {
  await page.goto("/en/login");
  await page.locator('input[name="email"]').fill("owner@waflo.local");
  await page.locator('input[name="password"]').fill("Waflo-Development-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/dashboard(?:\/|$)/);
}

test("public, authentication, and form-error screens have no serious accessibility violations", async ({
  page,
}) => {
  for (const url of [
    "http://localhost:3000/en",
    "http://localhost:3000/en/pricing",
    "http://localhost:3000/en/contact",
    "http://localhost:3000/en/privacy",
    "http://localhost:3000/en/terms",
    "http://localhost:3001/en/signup",
    "http://localhost:3001/en/login",
    "http://localhost:3001/en/forgot-password",
    "http://localhost:3001/en/reset-password",
    "http://localhost:3001/en/verify-email",
    "http://localhost:3001/en/invite",
    "http://localhost:3001/en/logged-out",
    "http://localhost:3001/en/session-expired",
    "http://localhost:3002/?tenant=today",
  ]) {
    await page.goto(url);
    await expectNoCriticalViolations(page);
  }

  await page.goto("http://localhost:3001/en/signup");
  await page.locator('input[name="displayName"]').fill("Mismatch User");
  await page.locator('input[name="email"]').fill("mismatch@waflo.local");
  await page.locator('input[name="password"]').fill("Password mismatch 2026!");
  await page.locator('input[name="confirmPassword"]').fill("Different password 2026!");
  await page.locator('input[name="terms"]').check();
  await page.locator('input[name="privacy"]').check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Passwords do not match.")).toBeVisible();
  await expectNoCriticalViolations(page);
});

test("authenticated English and Arabic dashboard screens and dialogs are accessible", async ({
  page,
}) => {
  await loginAsSeedOwner(page);
  await page.goto("http://localhost:3001/en/onboarding/business");
  await expect(page.getByRole("heading", { name: "Tell us about your business" })).toBeVisible();
  await expectNoCriticalViolations(page);
  for (const route of ["", "/locations", "/team", "/billing", "/security", "/audit", "/settings"]) {
    await page.goto(`http://localhost:3001/en/dashboard${route}`);
    await expect(page.locator(".dashboard-main")).toBeVisible();
    await expectNoCriticalViolations(page);
  }

  await page.goto("http://localhost:3001/en/dashboard/team");
  await page.getByRole("button", { name: "Invite member" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoCriticalViolations(page);

  await page.goto("http://localhost:3001/ar/dashboard");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expectNoCriticalViolations(page);
});
