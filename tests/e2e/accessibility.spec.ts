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

  await page.goto("http://localhost:3001/en/dashboard/team");
  await page.getByRole("button", { name: "Invite member" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoCriticalViolations(page);

  await page.goto("http://localhost:3001/en/dashboard/programs");
  await page.getByRole("button", { name: "Create program" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoCriticalViolations(page);

  await page.goto("http://localhost:3001/ar/dashboard/programs");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expectNoCriticalViolations(page);
});

test("Loyalty Studio editor, crop, validation, Test Mode, publishing, conflicts, and RTL are accessible", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const programName = `A11y Pro ${randomUUID().slice(0, 6)}`;
  await loginAsSeedOwner(page);

  const organizationSwitcher = page.locator(".wf-org-switcher select");
  const growthOrganization = await organizationSwitcher
    .locator("option")
    .nth(1)
    .getAttribute("value");
  expect(growthOrganization).toBeTruthy();
  await organizationSwitcher.selectOption(growthOrganization as string);
  await page.goto("http://localhost:3001/en/dashboard/programs");
  await page.getByRole("button", { name: "Create program" }).click();
  await page.getByRole("radio", { name: /Pro Mode/ }).check();
  await expectNoCriticalViolations(page);
  await expectKeyboardFocus(page);
  await page.locator(".template-card").filter({ hasText: "Car wash" }).click();
  const templateSwitchDialog = page
    .getByRole("dialog")
    .filter({ hasText: "Replace template settings?" })
    .last();
  await expect(templateSwitchDialog).toBeVisible();
  await expectNoCriticalViolations(page);
  await expectKeyboardFocus(page);
  await templateSwitchDialog.getByRole("button", { name: "Replace settings" }).click();
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

  await page.route(
    "**/v1/organizations/*/programs/*",
    async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
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
    },
    { times: 1 },
  );
  await page.locator(".studio-editor-panel input").first().fill(`${programName} local`);
  const conflictDialog = page.getByRole("dialog").filter({ hasText: "Edited elsewhere" });
  await expect(conflictDialog).toBeVisible();
  await expect(page.getByText("Your local edits are preserved")).toBeVisible();
  await expectNoCriticalViolations(page);
  await expectKeyboardFocus(page);
  await page.getByRole("button", { name: "Reload latest" }).click();
  await expect(conflictDialog).toBeHidden();

  await page
    .locator(".studio-section-nav")
    .getByRole("button", { name: /Rewards & milestones/ })
    .click();
  const milestoneSave = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/programs/") &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Add milestone" }).click();
  await milestoneSave;
  await expectNoCriticalViolations(page);

  await page
    .locator(".studio-section-nav")
    .getByRole("button", { name: /Artwork/ })
    .click();
  await expectNoCriticalViolations(page);
  const artworkPicker = page.locator(".studio-asset-picker").first();
  await artworkPicker.locator('input[type="file"]').setInputFiles({
    name: "a11y-logo.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAARklEQVRYhe3XwQ0AMAhC0U7EOuyfuIfdor28g3cTET5nmv05xwLjBCXCeMNlRMOKK4wijheQDCQrKA0sX8VkVLMqp3mugwtMYqCIQ8Mt0gAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  const cropDialog = page.getByRole("dialog").filter({ hasText: "Crop image safely" });
  await expect(cropDialog).toBeVisible();
  await expectNoCriticalViolations(page);
  await page.getByLabel("Zoom").fill("1.4");
  await page.getByRole("button", { name: "Process and upload" }).click();
  await expect(cropDialog).toBeHidden();
  await expect(page.locator(".studio-save-state")).toContainText("Saved");

  await page
    .locator(".studio-section-nav")
    .getByRole("button", { name: /Stamp layout/ })
    .click();
  for (const layout of ["ROW", "GRID", "PATH", "RING"]) {
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/programs/") &&
        response.status() === 200,
    );
    await page.getByRole("button", { name: new RegExp(`^${layout}`) }).click();
    await saved;
    await expect(page.locator(".studio-save-state")).toContainText("Saved");
  }
  await expectNoCriticalViolations(page);

  for (const section of ["Customer Web", "Apple Wallet", "Google Wallet"]) {
    await page
      .locator(".studio-section-nav")
      .getByRole("button", { name: new RegExp(section) })
      .click();
    await expect(page.locator(`img[alt$="preview"]`)).toBeVisible();
    await page.locator(".studio-capability-summary summary").click();
    await expectNoCriticalViolations(page);
  }

  await page
    .locator(".studio-section-nav")
    .getByRole("button", { name: /Validation/ })
    .click();
  await page.getByRole("button", { name: "Run validation" }).click();
  await expect(page.getByText(/0 errors/)).toBeVisible();
  await expectNoCriticalViolations(page);

  await page
    .locator(".studio-section-nav")
    .getByRole("button", { name: /Test Mode/ })
    .click();
  await page.getByRole("button", { name: "Start Test Mode" }).click();
  await page.getByRole("button", { name: "+1 stamp" }).click();
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByText("RESET", { exact: true })).toBeVisible();
  await expectNoCriticalViolations(page);
  await page.getByRole("button", { name: "+5 stamps" }).click();
  await page.getByRole("button", { name: "+1 stamp" }).click();
  await expect(page.getByText("Reward ready", { exact: true })).toBeVisible();
  await expectNoCriticalViolations(page);
  await page.locator('button:has-text("Synthetic redeem"):not([disabled])').last().click();
  await expect(page.getByText("Reward ready", { exact: true })).toHaveCount(0);
  await expect(page.getByText("0/6", { exact: true })).toBeVisible();
  await expectNoCriticalViolations(page);
  await page.locator('button:has-text("Synthetic redeem"):not([disabled])').first().click();
  await expect(page.getByText("COMPLETED", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Publish program" }).click();
  await expect(page.getByRole("dialog").filter({ hasText: "Publish program" })).toBeVisible();
  await expectNoCriticalViolations(page);
  await expectKeyboardFocus(page);
  await page.getByRole("button", { name: "Cancel" }).click();

  await page
    .locator(".studio-section-nav")
    .getByRole("button", { name: /Version history/ })
    .click();
  await expectNoCriticalViolations(page);

  const { createPrismaClient } = await import("../../packages/database/dist/src/client.js");
  const database = createPrismaClient(
    process.env.DATABASE_URL ??
      "postgresql://waflo:waflo_dev_password@localhost:5432/waflo?schema=public",
  );
  const storedProgram = await database.loyaltyProgram.findFirstOrThrow({
    where: {
      organizationId: growthOrganization as string,
      internalName: { startsWith: programName },
    },
  });
  await database.loyaltyProgram.update({
    where: { id: storedProgram.id },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });
  await page.getByRole("button", { name: "Programs" }).click();
  await page
    .locator(".program-list__card")
    .filter({ hasText: programName })
    .getByRole("button", { name: "Open Studio" })
    .click();
  const archivedGuidance = page
    .locator(".studio-publication-state-guidance")
    .filter({ hasText: "Restore required before publishing" });
  await expect(archivedGuidance).toBeVisible();
  await archivedGuidance.locator("summary").focus();
  await expect(archivedGuidance.locator("summary")).toBeFocused();
  await expect(page.getByRole("button", { name: "Publish program" })).toBeDisabled();
  await expectNoCriticalViolations(page);

  await database.loyaltyProgram.update({
    where: { id: storedProgram.id },
    data: { status: "SUSPENDED", archivedAt: null },
  });
  await database.$disconnect();
  await page.goto("http://localhost:3001/ar/dashboard/programs");
  const programCard = page.locator(".program-list__card").filter({ hasText: programName });
  await programCard.locator("button").last().click();
  await expect(page.locator(".studio-shell")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".studio-workspace")).toBeVisible();
  const suspendedGuidance = page
    .locator(".studio-publication-state-guidance")
    .filter({ hasText: "النشر غير متاح" });
  await expect(suspendedGuidance).toBeVisible();
  await expect(
    page.getByText("لا يمكن نشر هذا البرنامج في حالته الحالية. تواصل مع الدعم للمساعدة."),
  ).toBeVisible();
  await suspendedGuidance.locator("summary").focus();
  await expect(suspendedGuidance.locator("summary")).toBeFocused();
  await expectNoCriticalViolations(page);
});
