import { randomUUID } from "node:crypto";
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

async function expectKeyboardFocus(page: Page): Promise<void> {
  await page.keyboard.press("Tab");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName ?? ""))
    .not.toBe("BODY");
}

test("public, authentication, and form-error screens have no serious accessibility violations", async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const url of [
    "http://localhost:3000/en",
    "http://localhost:3000/en/pricing",
    "http://localhost:3000/en/contact",
    "http://localhost:3000/en/privacy",
    "http://localhost:3000/en/terms",
    "http://localhost:3000/en/refunds",
    "http://localhost:3000/ar/refunds",
    "http://localhost:3001/en/signup",
    "http://localhost:3001/ar/signup",
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
  for (const route of [
    "",
    "/programs",
    "/locations",
    "/team",
    "/billing",
    "/security",
    "/audit",
    "/settings",
  ]) {
    await page.goto(`http://localhost:3001/en/dashboard${route}`);
    await expect(page.locator(".dashboard-main")).toBeVisible();
    await expectNoCriticalViolations(page);
  }

  await page.route("**/v1/organizations/*/billing", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const upstream = await route.fetch();
    const body = (await upstream.json()) as { data: Record<string, unknown> };
    body.data.canManageBilling = true;
    body.data.invoices = [
      {
        id: "f3333333-3333-4333-8333-333333333333",
        number: "WF-A11Y-REFUND",
        status: "paid",
        paymentStatus: "paid",
        amountDue: 6900,
        amountPaid: 6900,
        amountRemaining: 0,
        currency: "USD",
        date: "2026-08-01T09:00:00.000Z",
        periodStart: "2026-08-01T09:00:00.000Z",
        periodEnd: "2026-09-01T09:00:00.000Z",
        paidAt: "2026-08-01T09:00:00.000Z",
        hostedInvoiceUrl: "https://invoice.stripe.test/a11y",
        invoicePdfUrl: null,
        refundable: true,
        amountRefunded: 0,
        remainingRefundableAmount: 6900,
        paymentMethod: { brand: "visa", last4: "4242", expMonth: 8, expYear: 2029 },
        refunds: [],
      },
    ];
    await route.fulfill({ response: upstream, json: body });
  });
  await page.goto("http://localhost:3001/en/dashboard/billing");
  await page.getByRole("button", { name: "Request refund for invoice WF-A11Y-REFUND" }).click();
  await expect(page.getByRole("dialog", { name: "Request a refund review" })).toBeVisible();
  await expectNoCriticalViolations(page);

  await page.goto("http://localhost:3001/en/dashboard/team");
  await page.getByRole("button", { name: "Add staff" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoCriticalViolations(page);

  await page.goto("http://localhost:3001/en/dashboard/programs");
  await page.getByRole("button", { name: "Create loyalty card" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Choose a starting design" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview: Start from scratch, all templates" }).click();
  await expect(page.getByRole("dialog", { name: "Start from scratch" })).toBeVisible();
  await expectNoCriticalViolations(page);

  await page.goto("http://localhost:3001/ar/dashboard/programs");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expectNoCriticalViolations(page);
});

test("Loyalty Studio lifecycle, Test, launch, conflicts, and RTL are accessible", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const programName = `A11y Pro ${randomUUID().slice(0, 6)}`;
  await loginAsSeedOwner(page);

  const organizationSwitcher = page.locator(".wf-org-switcher select");
  const growthOrganizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await organizationSwitcher.selectOption(growthOrganizationId);
  await expect(organizationSwitcher).toHaveValue(growthOrganizationId);
  await page.goto("http://localhost:3001/en/dashboard/programs?create=quick");
  await page.getByRole("radio", { name: /Pro Mode/ }).check();
  await expectNoCriticalViolations(page);
  await expectKeyboardFocus(page);
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByPlaceholder("Weekend rewards").fill(programName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator('input[name="en-program-name"]').fill(programName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator('input[name="ar-program-name"]').fill("برنامج إمكانية الوصول");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator(".studio-check-grid input[type=checkbox]").first().check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Save and open Studio" }).click();

  await expect(page.getByRole("heading", { level: 1, name: programName })).toBeVisible();
  await expectNoCriticalViolations(page);

  const studioNavigation = page.getByRole("navigation", { name: "Studio sections" });
  let remainingConflicts = 1;
  await page.route("**/v1/organizations/*/programs/*", async (route) => {
    if (route.request().method() !== "PATCH" || remainingConflicts === 0) {
      await route.continue();
      return;
    }
    remainingConflicts -= 1;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "STALE_PROGRAM_DRAFT",
          message: "This draft changed in another editor.",
          requestId: "a11y-conflict",
          details: { expectedRevision: 2, receivedRevision: 1 },
        },
      }),
    });
  });
  await studioNavigation.getByRole("button", { name: /^How it works/u }).click();
  await expect(page).toHaveURL(/\/how-it-works$/u);
  await page.getByText("Advanced earning and redemption rules", { exact: true }).click();
  await page.getByLabel("Valid for (days)").first().fill("31");
  const conflictDialog = page.getByRole("dialog").filter({ hasText: "Edited elsewhere" });
  await expect(conflictDialog).toBeVisible();
  await expect(page.getByText("Your local edits are preserved")).toBeVisible();
  await expectNoCriticalViolations(page);
  await expectKeyboardFocus(page);
  await conflictDialog.getByRole("button", { name: "Load latest card" }).click();
  await expect(conflictDialog).toBeHidden();

  await studioNavigation.getByRole("button", { name: /^Customers & locations/u }).click();
  await expect(page).toHaveURL(/\/customers-locations$/u);
  await expect(page).toHaveTitle(/Customers & locations/u);
  await expectNoCriticalViolations(page);

  await studioNavigation.getByRole("button", { name: /^Test/u }).click();
  await expect(page).toHaveURL(/\/test$/u);
  await expectNoCriticalViolations(page);
  await page.getByRole("button", { name: "Start demo customer" }).click();
  const currentProgress = page.getByText("Current progress", { exact: true });
  const safeTestFailure = page.getByText(
    "Test Mode could not start. No real customer activity was created. Try again.",
    { exact: true },
  );
  await expect(currentProgress.or(safeTestFailure)).toBeVisible();
  if (await currentProgress.isVisible()) {
    await page.getByRole("button", { name: "Add a stamp" }).click();
  }
  await expectNoCriticalViolations(page);

  await studioNavigation.getByRole("button", { name: /^(?:Review & launch|Launch)/u }).click();
  await expect(page).toHaveURL(/\/launch$/u);
  await expectNoCriticalViolations(page);
  await studioNavigation.getByRole("button", { name: /^Settings/u }).click();
  await expect(page).toHaveURL(/\/settings$/u);
  await expectNoCriticalViolations(page);

  const { createPrismaClient } = await import("../../packages/database/dist/src/client.js");
  const database = createPrismaClient(
    process.env.DATABASE_URL ??
      "postgresql://waflo:waflo_dev_password@localhost:5432/waflo?schema=public",
  );
  const storedProgram = await database.loyaltyProgram.findFirstOrThrow({
    where: {
      organizationId: growthOrganizationId,
      internalName: { startsWith: programName },
    },
  });
  await database.loyaltyProgram.update({
    where: { id: storedProgram.id },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });
  await page.getByRole("button", { name: "Loyalty Cards" }).click();
  await page
    .locator(".program-list__card")
    .filter({ hasText: programName })
    .getByRole("button", { name: "Open card" })
    .click();
  await expect(page.getByText("This loyalty card is archived", { exact: true })).toBeVisible();
  const restoreAction = page.getByRole("button", { name: "Restore card" }).first();
  await restoreAction.focus();
  await expect(restoreAction).toBeFocused();
  await page
    .getByRole("navigation", { name: "Studio sections" })
    .getByRole("button", { name: /^(?:Review & launch|Launch)/u })
    .click();
  await expect(page.getByRole("heading", { name: "Card is archived" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore card" })).toBeVisible();
  await expectNoCriticalViolations(page);

  await database.loyaltyProgram.update({
    where: { id: storedProgram.id },
    data: { status: "SUSPENDED", archivedAt: null },
  });
  await database.$disconnect();
  await page.goto("http://localhost:3001/ar/dashboard/programs");
  const programCard = page.locator(".program-list__card").filter({ hasText: programName });
  await programCard.getByRole("button", { name: /فتح البطاقة/ }).click();
  await expect(page.locator(".studio-shell")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".studio-workspace")).toBeVisible();
  await page
    .getByRole("navigation", { name: "أقسام الاستوديو" })
    .getByRole("button", { name: /^الإطلاق/u })
    .click();
  await expect(page.getByRole("heading", { name: "الإطلاق غير متاح" })).toBeVisible();
  const suspendedStatusAction = page.getByRole("button", { name: "عرض حالة البطاقة" });
  await suspendedStatusAction.focus();
  await expect(suspendedStatusAction).toBeFocused();
  await expectNoCriticalViolations(page);
});
