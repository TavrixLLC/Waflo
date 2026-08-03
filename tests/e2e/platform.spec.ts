import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

const screenshots = "artifacts/handoff-w2-round-5/screenshots";
const runId = randomUUID().slice(0, 8);
const ownerEmail = `browser-owner-${runId}@waflo.local`;
const staffEmail = `browser-staff-${runId}@waflo.local`;
const resetEmail = `browser-reset-${runId}@waflo.local`;
const initialPassword = "Browser Waflo 2026!";
const changedPassword = "Browser Waflo Changed 2026!";
const resetPassword = "Browser Waflo Reset 2026!";
const initialSlug = `browser-${runId}`;
const changedSlug = `flow-${runId}`;
let browserOrganizationId = "";

interface MailpitAddress {
  Address: string;
}

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: MailpitAddress[];
  Created: string;
}

interface MailpitList {
  messages: MailpitMessage[];
}

interface MailpitDetail {
  HTML?: string;
  Text?: string;
}

async function screenshot(page: Page, name: string): Promise<void> {
  await mkdir(screenshots, { recursive: true });
  const path = `${screenshots}/${name}.png`;
  try {
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
  } catch {
    await page.screenshot({ path, fullPage: false, animations: "disabled" });
  }
}

async function latestMailAction(
  request: APIRequestContext,
  recipient: string,
  subjectFragment: string,
): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const response = await request.get("http://localhost:8025/api/v1/messages");
    const list = (await response.json()) as MailpitList;
    const message = list.messages
      .filter(
        (item) =>
          item.To.some((address) => address.Address === recipient) &&
          item.Subject.includes(subjectFragment),
      )
      .sort((left, right) => right.Created.localeCompare(left.Created))[0];
    if (message) {
      const detailResponse = await request.get(
        `http://localhost:8025/api/v1/message/${message.ID}`,
      );
      const detail = (await detailResponse.json()) as MailpitDetail;
      const content = `${detail.HTML ?? ""}\n${detail.Text ?? ""}`;
      const match = content.match(/https?:\/\/[^"' <]+/);
      if (match?.[0]) return match[0].replaceAll("&amp;", "&");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No matching Mailpit action found for ${recipient}.`);
}

async function signup(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/en/signup");
  await page
    .locator('input[name="displayName"]')
    .fill(email === ownerEmail ? "Browser Owner" : "Browser Staff");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirmPassword"]').fill(password);
  await page.locator('input[name="terms"]').check();
  await page.locator('input[name="privacy"]').check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/en\/verify-email/);
}

async function verifyLatestEmail(page: Page, email: string): Promise<void> {
  const verificationUrl = await latestMailAction(page.request, email, "Verify your Waflo email");
  const verificationParsed = new URL(verificationUrl);
  expect(new URL(verificationUrl).hash).toMatch(/^#token=.+/);
  // Signup already leaves the browser on this pathname; add a harmless query
  // so Playwright performs a full navigation before the fragment is consumed.
  verificationParsed.searchParams.set("round3", "fragment");
  await page.goto(verificationParsed.toString());
  await expect(page.getByText("Email verified", { exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/en/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/(?:dashboard(?:\/|$)|onboarding\/)/);
}

async function chooseGalleryTemplate(page: Page, templateName: string): Promise<void> {
  await expect(
    page.getByRole("heading", { level: 1, name: "Choose a starting design" }),
  ).toBeVisible();
  await page.getByRole("button", { name: `Preview: ${templateName}, all templates` }).click();
  await page
    .getByRole("dialog", { name: templateName })
    .getByRole("button", {
      name: templateName === "Start from scratch" ? "Start from scratch" : "Use this template",
    })
    .click();
}

async function finishQuickWizard(page: Page, name: string): Promise<void> {
  if (
    (await page.getByRole("heading", { level: 1, name: "Choose a starting design" }).count()) > 0
  ) {
    await chooseGalleryTemplate(page, "Start from scratch");
  }
  if ((await page.getByText("Editing mode", { exact: true }).count()) > 0) {
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await page.getByPlaceholder("Weekend rewards").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator('input[name="en-program-name"]').fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator('input[name="ar-program-name"]').fill("برنامج ستارتر");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator(".studio-check-grid input[type=checkbox]").first().check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Save and open Studio" }).click();
}

test.describe
  .serial("Waflo W2 browser flows", () => {
    test("marketing pages render in English and Arabic with real RTL", async ({ page }) => {
      await page.goto("http://localhost:3000/en");
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Turn every visit");
      await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
      await screenshot(page, "01-marketing-home-en");

      await page.goto("http://localhost:3000/ar");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await screenshot(page, "02-marketing-home-ar");

      await page.goto("http://localhost:3000/en/pricing");
      await expect(page.getByText("$29")).toBeVisible();
      await expect(page.getByText("$69")).toBeVisible();
      await expect(page.getByText("$129")).toBeVisible();
      await screenshot(page, "03-pricing");
    });

    test("registers, opens the Mailpit verification action, and completes onboarding", async ({
      page,
    }) => {
      await page.goto("/en/signup");
      await screenshot(page, "04-signup");
      await signup(page, ownerEmail, initialPassword);
      await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
      await screenshot(page, "05-email-verification-pending");

      await verifyLatestEmail(page, ownerEmail);
      await screenshot(page, "06-email-verification-complete");
      await page.getByRole("button", { name: "Continue to sign in" }).click();
      await expect(page).toHaveURL(/\/en\/login/);
      await screenshot(page, "07-login");

      await page.locator('input[name="email"]').fill(ownerEmail);
      await page.locator('input[name="password"]').fill(initialPassword);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/en\/onboarding\/business/);
      await screenshot(page, "08-onboarding-business");

      await page.locator('input[name="name"]').fill(`Browser Coffee ${runId}`);
      await page.locator('input[name="slug"]').fill(initialSlug);
      await expect(page.getByText("URL is available")).toBeVisible();
      await page.getByRole("button", { name: "Save and continue" }).click();
      await expect(page).toHaveURL(/\/en\/onboarding\/location/);
      await screenshot(page, "09-onboarding-location");

      await page.locator('input[name="name"]').fill("Browser Main Branch");
      await page.locator('input[name="address"]').fill("Main Street");
      await page.locator('input[name="city"]').fill("Baghdad");
      await page.getByRole("button", { name: "Create location and finish setup" }).click();
      await expect(page).toHaveURL(/\/en\/onboarding\/complete/);
      await expect(page.getByText("Not started", { exact: true })).toBeVisible();
      await expect(page.getByText("no payment was taken")).toBeVisible();
      browserOrganizationId = new URL(page.url()).searchParams.get("organization") ?? "";
      expect(browserOrganizationId).toBeTruthy();
      const organizationResponse = await page.request.get(
        `http://localhost:4000/v1/organizations/${browserOrganizationId}`,
      );
      const organizationEnvelope = (await organizationResponse.json()) as {
        data: {
          billingProfile: {
            subscriptionStatus: string;
            trialStart: string | null;
            trialEnd: string | null;
          };
        };
      };
      expect(organizationEnvelope.data.billingProfile).toMatchObject({
        subscriptionStatus: "PENDING_ACTIVATION",
        trialStart: null,
        trialEnd: null,
      });
      await screenshot(page, "10-onboarding-completion");

      await page.getByRole("button", { name: "Continue to dashboard" }).click();
      await expect(page).toHaveURL(/\/en\/dashboard/);
      await expect(page.getByText("Not started yet")).toBeVisible();
      await expect(page.getByText("pending_activation")).toBeVisible();
      await expect(page.getByText(/15-day free trial has not started/)).toBeVisible();
      await expect(page.getByText(/no fabricated loyalty metrics/i)).toBeVisible();
      await expect(page.getByText(/stamps issued/i)).toHaveCount(0);
      await screenshot(page, "11-dashboard-en");
    });

    test("completes Quick Mode, autosaves Studio, validates, tests, and publishes", async ({
      page,
    }) => {
      await login(page, ownerEmail, initialPassword);
      await page.goto("/en/dashboard/programs");
      await expect(
        page.getByRole("main").getByRole("heading", { name: "Loyalty cards" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Create loyalty card" }).click();
      await chooseGalleryTemplate(page, "Cookies & bakery");
      await page.getByPlaceholder("Weekend rewards").fill("Browser Studio Rewards");
      await page.getByRole("button", { name: "Continue" }).click();

      await page.locator('input[name="en-program-name"]').fill("Browser Studio Rewards");
      await page.getByRole("button", { name: "Continue" }).click();

      await page.locator('input[name="ar-program-name"]').fill("مكافآت استوديو المتصفح");
      await page.getByRole("button", { name: "Continue" }).click();

      await page.getByRole("checkbox", { name: "Browser Main Branch" }).check();
      await page.getByRole("button", { name: "Continue" }).click();

      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("button", { name: "Save and open Studio" })).toBeEnabled();
      await page.getByRole("button", { name: "Save and open Studio" }).click();

      await expect(
        page.getByRole("heading", { level: 1, name: "Browser Studio Rewards" }),
      ).toBeVisible();
      await expect(page.locator(".studio-section-nav button")).toHaveCount(16);
      await expect(page.locator('img[alt="CUSTOMER_WEB preview"]')).toBeVisible();
      await screenshot(page, "23-loyalty-studio-customer-preview");
      const previewProgress = page.locator(".studio-preview-panel input[type=range]");
      await previewProgress.fill("0");
      await expect(page.locator('img[alt="CUSTOMER_WEB preview"]')).toBeVisible();
      await screenshot(page, "41-r4-stamp-0-of-8-all-empty");
      await previewProgress.fill("5");
      await expect(page.locator('img[alt="CUSTOMER_WEB preview"]')).toBeVisible();
      await screenshot(page, "42-r4-stamp-5-of-8-two-state");
      await previewProgress.fill("8");
      await expect(page.locator('img[alt="CUSTOMER_WEB preview"]')).toBeVisible();
      await screenshot(page, "43-r4-stamp-8-of-8-reward-ready");
      await previewProgress.fill("0");

      const internalName = page.locator(".studio-editor-panel input").first();
      const autosave = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes("/programs/") &&
          response.status() === 200,
      );
      await internalName.fill("Browser Studio Rewards Updated");
      await autosave;
      await expect(page.locator(".studio-save-state")).toContainText("Saved");

      for (const [section, profile] of [
        ["Customer Web", "CUSTOMER_WEB"],
        ["Apple Wallet", "APPLE_WALLET"],
        ["Google Wallet", "GOOGLE_WALLET"],
      ] as const) {
        await page
          .locator(".studio-section-nav")
          .getByRole("button", { name: new RegExp(section) })
          .click();
        await expect(page.locator(`img[alt="${profile} preview"]`)).toBeVisible();
        if (profile === "APPLE_WALLET") await screenshot(page, "24-loyalty-studio-apple-preview");
      }

      await page
        .locator(".studio-section-nav")
        .getByRole("button", { name: /Validation/ })
        .click();
      await page.getByRole("button", { name: "Run validation" }).click();
      await expect(page.getByText(/0 errors/)).toBeVisible();

      await page.goto("/ar/dashboard/programs");
      const arabicProgramCard = page
        .locator(".program-list__card")
        .filter({ hasText: "Browser Studio Rewards Updated" });
      await arabicProgramCard.getByRole("button", { name: /فتح البطاقة/ }).click();
      await expect(page.locator(".studio-shell")).toHaveAttribute("dir", "rtl");
      await page.locator(".studio-preview-panel input[type=range]").fill("8");
      await expect(page.locator('img[alt="CUSTOMER_WEB preview"]')).toBeVisible();
      await screenshot(page, "47-r4-arabic-rtl-reward-ready");

      await page.goto("/en/dashboard/programs");
      const englishProgramCard = page
        .locator(".program-list__card")
        .filter({ hasText: "Browser Studio Rewards Updated" });
      await englishProgramCard.getByRole("button", { name: "Open card" }).click();

      await page
        .locator(".studio-section-nav")
        .getByRole("button", { name: /Test Mode/ })
        .click();
      await page.getByRole("button", { name: "Start Test Mode" }).click();
      await screenshot(page, "44-r4-test-mode-cycle-start-empty");
      await page.getByRole("button", { name: "+5 stamps" }).click();
      await page.getByRole("button", { name: "Reverse latest stamp" }).click();
      await expect(page.getByText("TEST_STAMP_REVERSED")).toBeVisible();
      for (let stamp = 0; stamp < 4; stamp += 1) {
        await page.getByRole("button", { name: "+1 stamp" }).click();
      }
      await expect(page.getByText("Reward ready", { exact: true })).toBeVisible();
      await page
        .locator(".studio-section-nav")
        .getByRole("button", { name: /Apple Wallet/ })
        .click();
      await expect(page.locator('img[alt="APPLE_WALLET preview"]')).toBeVisible();
      await screenshot(page, "45-r4-apple-8-of-8-no-star");
      await page
        .locator(".studio-section-nav")
        .getByRole("button", { name: /Google Wallet/ })
        .click();
      await expect(page.locator('img[alt="GOOGLE_WALLET preview"]')).toBeVisible();
      await screenshot(page, "46-r4-google-8-of-8-no-star");
      await page
        .locator(".studio-section-nav")
        .getByRole("button", { name: /Test Mode/ })
        .click();
      await page.getByRole("button", { name: "Synthetic redeem" }).click();
      await expect(page.getByText("COMPLETED", { exact: true })).toBeVisible();
      await expect(page.getByText("Reward ready", { exact: true })).toHaveCount(0);
      await expect(page.getByText("0/8", { exact: true })).toBeVisible();
      await screenshot(page, "48-r4-after-redemption-all-empty");
      await screenshot(page, "25-loyalty-studio-test-mode");

      await page.getByRole("button", { name: "Publish card" }).click();
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByText("The published version remains live")).toBeVisible();
      await screenshot(page, "26-loyalty-studio-published");
    });

    test("handles two-editor conflicts, publishes v2, preserves history, and completes lifecycle actions", async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await login(page, ownerEmail, initialPassword);
      await page.goto("/en/dashboard/programs");
      const programCard = page
        .locator(".program-list__card")
        .filter({ hasText: "Browser Studio Rewards Updated" });
      await programCard.getByRole("button", { name: "Open card" }).click();
      await expect(page.getByText("The published version remains live")).toBeVisible();

      const billingResponse = await page.request.get(
        `http://localhost:4000/v1/organizations/${browserOrganizationId}`,
      );
      expect(billingResponse.ok()).toBe(true);
      const billingEnvelope = (await billingResponse.json()) as {
        data: {
          billingProfile: {
            subscriptionStatus: string;
            trialStart: string | null;
            trialTriggeringProgramId: string | null;
          };
        };
      };
      expect(billingEnvelope.data.billingProfile.subscriptionStatus).toBe("TRIALING");
      expect(billingEnvelope.data.billingProfile.trialStart).toBeTruthy();
      expect(billingEnvelope.data.billingProfile.trialTriggeringProgramId).toBeTruthy();

      await page.getByRole("button", { name: "Create draft from live card" }).click();
      await expect(page.getByText(/LOYALTY STUDIO.*v2/)).toBeVisible();
      await expect(
        page.getByText("Unpublished changes are isolated from the live version"),
      ).toBeVisible();

      const otherPage = await page.context().newPage();
      await otherPage.goto("/en/dashboard/programs");
      const otherCard = otherPage
        .locator(".program-list__card")
        .filter({ hasText: "Browser Studio Rewards Updated" });
      await otherCard.getByRole("button", { name: "Open card" }).click();
      await expect(otherPage.getByText(/LOYALTY STUDIO.*v2/)).toBeVisible();

      const otherSave = otherPage.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes("/programs/") &&
          response.status() === 200,
      );
      await otherPage
        .locator(".studio-editor-panel input")
        .first()
        .fill("Browser Studio v2 remote");
      await otherSave;
      await expect(otherPage.locator(".studio-save-state")).toContainText("Saved");

      await page.locator(".studio-editor-panel input").first().fill("Browser Studio v2 local");
      const conflictDialog = page.getByRole("dialog").filter({ hasText: "Edited elsewhere" });
      await expect(conflictDialog).toBeVisible();
      await expect(page.getByText("Your local edits are preserved")).toBeVisible();
      await expect(page.getByText(/Local revision .*server revision/)).toBeVisible();
      await screenshot(page, "27-loyalty-studio-conflict");

      const reapplySave = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes("/programs/") &&
          response.status() === 200,
      );
      await page.getByRole("button", { name: "Reapply deliberately" }).click();
      await reapplySave;
      await expect(conflictDialog).toBeHidden();
      await expect(page.locator(".studio-save-state")).toContainText("Saved");
      await otherPage.close();

      await page
        .locator(".studio-section-nav")
        .getByRole("button", { name: /Overview/ })
        .click();
      const changeSummary = page.getByPlaceholder("What changed in this version?");
      const summarySave = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes("/programs/") &&
          response.status() === 200,
      );
      await changeSummary.fill("Conflict-safe v2 replacement");
      await summarySave;

      await page
        .locator(".studio-section-nav")
        .getByRole("button", { name: /Validation/ })
        .click();
      await page.getByRole("button", { name: "Run validation" }).click();
      await expect(page.getByText(/0 errors/)).toBeVisible();
      await page
        .locator(".studio-section-nav")
        .getByRole("button", { name: /Test Mode/ })
        .click();
      await page.getByRole("button", { name: "Start Test Mode" }).click();
      await page.getByRole("button", { name: "+5 stamps" }).click();
      for (let stamp = 0; stamp < 3; stamp += 1) {
        await page.getByRole("button", { name: "+1 stamp" }).click();
      }
      await page.getByRole("button", { name: "Synthetic redeem" }).click();
      await expect(page.getByText("COMPLETED", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Pause card" }).click();
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByRole("button", { name: "Resume card" })).toBeVisible();
      await expect(
        page.getByText("Unpublished changes are isolated from the paused published version."),
      ).toBeVisible();
      await page.getByRole("button", { name: "Publish card" }).click();
      await expect(
        page.getByText(
          "The new version will be published, but the card will remain paused. Use Resume separately when you are ready to make it live.",
        ),
      ).toBeVisible();
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByText("The published version remains paused")).toBeVisible();
      await expect(page.getByRole("button", { name: "Resume card" })).toBeVisible();
      await screenshot(page, "61-r5-paused-replacement-remains-paused");

      const history = page.locator(".studio-version-history");
      await expect(history).toContainText("v2");
      await expect(history).toContainText("PUBLISHED");
      await expect(history).toContainText("v1");
      await expect(history).toContainText("SUPERSEDED");
      await history.getByRole("button").filter({ hasText: "v1" }).click();
      await expect(page.getByText("Immutable historical version")).toBeVisible();
      await expect(page.getByText("Historical versions cannot be edited.")).toBeVisible();
      await page.getByRole("button", { name: "Close" }).click();
      await screenshot(page, "28-loyalty-studio-v2-history");

      await screenshot(page, "29-loyalty-studio-paused");

      await page.getByRole("button", { name: "Resume card" }).click();
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByRole("button", { name: "Pause card" })).toBeVisible();
      await expect(page.getByText("The published version remains live")).toBeVisible();
      await screenshot(page, "62-r5-explicit-resume-after-paused-replacement");

      await page.getByRole("button", { name: "Archive card" }).click();
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByRole("button", { name: "Restore card", exact: true })).toBeVisible();
      await screenshot(page, "30-loyalty-studio-archived");

      await page.getByRole("button", { name: "Restore card", exact: true }).click();
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByRole("button", { name: "Pause card" })).toBeVisible();
      await screenshot(page, "31-loyalty-studio-restored");
    });

    test("shows versioned concept templates, switch confirmation, background capability truth, and pagination", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.context().clearCookies();
      await login(page, "owner@waflo.local", "Waflo-Development-2026");
      const switcher = page.locator(".wf-org-switcher select");
      const growthOrganizationId = await switcher.locator("option").nth(1).getAttribute("value");
      expect(growthOrganizationId).toBeTruthy();
      await switcher.selectOption(growthOrganizationId as string);
      await page.goto("/en/dashboard/programs?create=quick");

      const cookies = page.locator(".template-card").filter({ hasText: "Cookies & bakery" });
      await cookies.click();
      await expect(cookies).toHaveClass(/template-card--selected/);
      await expect(cookies.locator("img")).toHaveCount(2);
      await expect(cookies.getByAltText("Cookies & bakery filled stamp")).toBeVisible();
      await expect(cookies.getByAltText("Cookies & bakery empty stamp")).toBeVisible();
      await screenshot(page, "33-w2r3-cookies-colored-outline");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("8 stamps", { exact: true })).toBeVisible();
      await expect(page.locator(".quick-step input").nth(2)).toHaveValue(/cookie stamp/i);
      await page.getByPlaceholder("Weekend rewards").fill(`Round 3 edited ${runId}`);
      await page.getByRole("button", { name: "Back" }).click();

      await page.locator(".template-card").filter({ hasText: "Coffee" }).click();
      const replacementDialog = page
        .getByRole("dialog")
        .filter({ hasText: "Replace template settings?" })
        .last();
      await expect(replacementDialog).toBeVisible();
      await expect(replacementDialog).toContainText("stamp goal and earning rule");
      await expect(replacementDialog).toContainText("English and Arabic customer copy");
      await expect(replacementDialog).toContainText("colors and stamp artwork");
      await screenshot(page, "34-w2r3-template-switch-warning");
      await replacementDialog.getByRole("button", { name: "Replace settings" }).click();

      const coffee = page.locator(".template-card").filter({ hasText: "Coffee" });
      await expect(coffee).toHaveClass(/template-card--selected/);
      await screenshot(page, "35-w2r3-coffee-cup-template");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.locator(".quick-step input").nth(2)).toHaveValue(/cup stamp/i);
      await page.getByRole("button", { name: "Back" }).click();

      const carWash = page.locator(".template-card").filter({ hasText: "Car wash" });
      await carWash.click();
      await expect(carWash).toHaveClass(/template-card--selected/);
      await expect(carWash.getByAltText("Car wash filled stamp")).toBeVisible();
      await expect(carWash.getByAltText("Car wash milestone artwork")).toHaveCount(0);
      await screenshot(page, "36-w2r3-car-wash-car-water");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("6 stamps", { exact: true })).toBeVisible();
      await expect(page.locator(".quick-step input").nth(2)).toHaveValue(/car stamp/i);
      await page.getByRole("button", { name: "Back" }).click();

      const barbershop = page.locator(".template-card").filter({ hasText: "Barbershop" });
      await barbershop.click();
      await expect(barbershop).toHaveClass(/template-card--selected/);
      await screenshot(page, "37-w2r3-barbershop-scissors");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("6 stamps", { exact: true })).toBeVisible();
      await expect(page.locator(".quick-step input").nth(2)).toHaveValue(/scissors stamp/i);
      await page.getByPlaceholder("Weekend rewards").fill(`Round 3 Barbershop ${runId}`);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.locator(".studio-check-grid input[type=checkbox]").first().check();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Save and open Studio" }).click();
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: `Round 3 Barbershop ${runId}`,
        }),
      ).toBeVisible();

      await page
        .locator(".studio-section-nav")
        .getByRole("button", { name: /Artwork/ })
        .click();
      const backgroundPicker = page.locator(".studio-asset-picker").filter({
        has: page.getByRole("heading", { name: "Background" }),
      });
      await backgroundPicker.locator('input[type="file"]').setInputFiles({
        name: "round3-background.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAARklEQVRYhe3XwQ0AMAhC0U7EOuyfuIfdor28g3cTET5nmv05xwLjBCXCeMNlRMOKK4wijheQDCQrKA0sX8VkVLMqp3mugwtMYqCIQ8Mt0gAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
      const cropDialog = page.getByRole("dialog").filter({ hasText: "Crop image safely" });
      await expect(cropDialog).toBeVisible();
      const uploaded = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().includes("/assets") &&
          response.status() === 201,
      );
      const backgroundSave = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes("/programs/") &&
          response.status() === 200,
      );
      await cropDialog.getByRole("button", { name: "Process and upload" }).click();
      await uploaded;
      await backgroundSave;
      await expect(cropDialog).toBeHidden();
      await expect(page.locator(".studio-save-state")).toContainText("Saved");

      await page
        .locator(".studio-section-nav")
        .getByRole("button", { name: /Customer Web/ })
        .click();
      await expect(page.locator('img[alt="CUSTOMER_WEB preview"]')).toBeVisible();
      await screenshot(page, "38-w2r3-customer-background-preview");
      await page
        .locator(".studio-section-nav")
        .getByRole("button", { name: /Apple Wallet/ })
        .click();
      await expect(page.locator('img[alt="APPLE_WALLET preview"]')).toBeVisible();
      await page.locator(".studio-capability-summary summary").click();
      await expect(page.locator(".studio-capability-summary")).toContainText(
        "selected background artwork is not used",
      );
      await expect(page.locator(".studio-preview-panel")).toContainText(
        "selected background artwork is not used",
      );
      await screenshot(page, "39-w2r3-platform-capability-warning");

      const { createPrismaClient } = await import("../../packages/database/dist/src/client.js");
      const database = createPrismaClient(
        process.env.DATABASE_URL ??
          "postgresql://waflo:waflo_dev_password@localhost:5432/waflo?schema=public",
      );
      try {
        const member = await database.organizationMember.findFirstOrThrow({
          where: {
            organizationId: growthOrganizationId as string,
            role: "OWNER",
          },
        });
        await database.loyaltyProgram.createMany({
          data: Array.from({ length: 22 }, (_, index) => ({
            organizationId: growthOrganizationId as string,
            internalName: `Round 3 pagination ${runId}-${String(index).padStart(2, "0")}`,
            programType: "STAMP" as const,
            status: "DRAFT" as const,
            createdByUserId: member.userId,
          })),
        });
      } finally {
        await database.$disconnect();
      }
      await page.goto("/en/dashboard/programs");
      await expect(page.getByRole("button", { name: "Load more loyalty cards" })).toBeVisible();
      const firstPageCount = await page.locator(".program-list__card").count();
      expect(firstPageCount).toBe(20);
      await page.getByRole("button", { name: "Load more loyalty cards" }).click();
      await expect.poll(() => page.locator(".program-list__card").count()).toBeGreaterThan(20);
      await screenshot(page, "40-w2r3-program-pagination-loaded");
    });

    test("completes password reset from a #token fragment and clears it before submission", async ({
      page,
    }) => {
      await signup(page, resetEmail, initialPassword);
      await verifyLatestEmail(page, resetEmail);
      await page.goto("/en/forgot-password");
      await page.locator('input[name="email"]').fill(resetEmail);
      await page.getByRole("button", { name: "Send instructions" }).click();
      await expect(
        page.getByText("If the account exists, reset instructions have been sent."),
      ).toBeVisible();
      const resetUrl = await latestMailAction(
        page.request,
        resetEmail,
        "Reset your Waflo password",
      );
      expect(new URL(resetUrl).hash).toMatch(/^#token=.+/);
      const resetParsed = new URL(resetUrl);
      resetParsed.searchParams.set("round3", "fragment");
      await page.goto(resetParsed.toString());
      await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
      await expect.poll(() => new URL(page.url()).hash).toBe("");
      await page.locator('input[name="password"]').fill(resetPassword);
      await page.locator('input[name="confirmPassword"]').fill(resetPassword);
      await page.getByRole("button", { name: "Save password" }).click();
      await expect(page.getByText("Password changed", { exact: true })).toBeVisible();
    });

    test("edits settings, reaches the location limit, upgrades setup plan, and creates a location", async ({
      page,
    }) => {
      await login(page, ownerEmail, initialPassword);
      await expect(page).toHaveURL(/\/en\/dashboard/);

      await page.goto("/en/dashboard/settings");
      await expect(page.getByRole("main").getByRole("heading", { name: "Settings" })).toBeVisible();
      await page.locator('input[name="category"]').fill("Specialty café");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("Settings saved.")).toBeVisible();

      await page.goto("/en/dashboard/locations");
      await expect(page.getByText("Location limit reached")).toBeVisible();
      await expect(page.getByText(/Upgrade to growth/)).toBeVisible();
      await screenshot(page, "12-locations-limit");

      await page.goto("/en/dashboard/billing");
      await expect(
        page.getByRole("main").getByRole("heading", { name: "Billing and plans" }),
      ).toBeVisible();
      await expect(page.getByText("Stripe test configuration required")).toBeVisible();
      await screenshot(page, "13-billing");
      const growthCard = page.locator(".wf-plan-card").filter({ hasText: "Growth" });
      await growthCard.getByRole("button", { name: "Choose plan" }).click();
      await expect(growthCard.getByRole("button", { name: "Selected" })).toBeDisabled();

      await page.goto("/en/dashboard/locations");
      await page.getByRole("button", { name: "Add location" }).click();
      await page.locator('input[name="name"]').fill("Browser Second Branch");
      await page.locator('input[name="city"]').fill("Basra");
      await page.getByRole("button", { name: "Create location" }).click();
      await expect(page.getByText("Browser Second Branch")).toBeVisible();
      await screenshot(page, "14-locations");
    });

    test("sends a Checkout command ID, suppresses double clicks, and reuses uncertain retries", async ({
      page,
    }) => {
      await login(page, ownerEmail, initialPassword);
      const checkoutKeys: string[] = [];
      let checkoutCalls = 0;
      let uncertainRetry = false;
      await page.route("**/v1/organizations/*/billing", async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        const upstream = await route.fetch();
        const body = (await upstream.json()) as {
          data: { stripeConfigured: boolean; profile: { stripeCustomerId: string | null } };
        };
        body.data.stripeConfigured = true;
        body.data.profile.stripeCustomerId = "cus_browser_checkout";
        await route.fulfill({ response: upstream, json: body });
      });
      await page.route("**/v1/organizations/*/billing/checkout", async (route) => {
        checkoutCalls += 1;
        const key = route.request().headers()["x-idempotency-key"];
        if (key) checkoutKeys.push(key);
        if (checkoutCalls === 2 && uncertainRetry) {
          await route.abort("failed");
          return;
        }
        if (checkoutCalls === 1) await new Promise((resolve) => setTimeout(resolve, 150));
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              sessionId: `cs_browser_${checkoutCalls}`,
              url: "http://localhost:3001/en/dashboard/billing?checkout=returned",
            },
            requestId: `browser-checkout-${runId}`,
          }),
        });
      });

      await page.goto("/en/dashboard/billing");
      const checkout = page.getByRole("button", { name: "Continue to Stripe Checkout" });
      await expect(checkout).toBeEnabled();
      await checkout.dblclick();
      await expect.poll(() => checkoutCalls).toBe(1);
      expect(checkoutKeys[0]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      uncertainRetry = true;
      await page.goto("/en/dashboard/billing");
      await checkout.click();
      await expect(page.getByText("Waflo could not reach the server. Try again.")).toBeVisible();
      await checkout.click();
      await expect.poll(() => checkoutCalls).toBe(3);
      expect(checkoutKeys[2]).toBe(checkoutKeys[1]);
      await expect(page).toHaveURL(/checkout=returned/);

      await page.goto("/en/dashboard/billing");
      await checkout.click();
      await expect.poll(() => checkoutCalls).toBe(4);
      expect(checkoutKeys[3]).not.toBe(checkoutKeys[2]);
      await expect(page).toHaveURL(/checkout=returned/);
    });

    test("invites a Staff user who registers, verifies, and accepts the invitation", async ({
      browser,
      page,
    }) => {
      await login(page, ownerEmail, initialPassword);
      await page.goto("/en/dashboard/team");
      await page.getByRole("button", { name: "Invite member" }).click();
      await page.locator('input[name="email"]').fill(staffEmail);
      await screenshot(page, "15-invitation-dialog");
      await page.getByRole("button", { name: "Send invitation" }).click();
      await expect(page.getByText(staffEmail)).toBeVisible();
      await screenshot(page, "16-team");

      const invitationUrl = await latestMailAction(
        page.request,
        staffEmail,
        "invited to a Waflo team",
      );
      const staffContext = await browser.newContext();
      const staffPage = await staffContext.newPage();
      await signup(staffPage, staffEmail, initialPassword);
      await verifyLatestEmail(staffPage, staffEmail);
      await login(staffPage, staffEmail, initialPassword);
      await expect(staffPage).toHaveURL(/\/en\/onboarding\/business/);
      const invitationParsed = new URL(invitationUrl);
      invitationParsed.searchParams.set("round3", "fragment");
      await staffPage.goto(invitationParsed.toString());
      await expect(staffPage.getByRole("heading", { name: /Join Browser Coffee/ })).toBeVisible();
      await staffPage.getByRole("button", { name: "Accept invitation" }).click();
      await expect(staffPage.getByText("Invitation accepted")).toBeVisible();
      await screenshot(staffPage, "17-invitation-accepted");
      await staffPage.getByRole("button", { name: "Open dashboard" }).click();
      await expect(staffPage).toHaveURL(/\/en\/dashboard/);
      await expect(staffPage.locator(".dashboard-nav-link", { hasText: "Locations" })).toHaveCount(
        0,
      );
      await staffPage.goto("/en/dashboard/locations");
      await expect(staffPage.getByText("Your role does not allow this action.")).toBeVisible();
      await staffPage.goto("/en/dashboard/programs");
      await expect(
        staffPage.getByText("Your role does not allow access to Loyalty Studio."),
      ).toBeVisible();
      await page.reload();
      const roleSelect = page.getByRole("combobox", { name: "Role for Browser Staff" });
      await expect(roleSelect).toBeVisible();
      await roleSelect.selectOption("MANAGER");
      await expect(roleSelect).toHaveValue("MANAGER");
      await staffPage.goto("/en/dashboard/programs");
      await expect(
        staffPage.getByRole("main").getByRole("heading", { name: "Loyalty cards" }),
      ).toBeVisible();
      await expect(staffPage.getByRole("button", { name: "Create loyalty card" })).toBeVisible();
      await staffContext.close();
    });

    test("shows audit history, manages sessions, changes slug and password, and resolves the new host", async ({
      browser,
      page,
    }) => {
      await login(page, ownerEmail, initialPassword);
      const otherContext = await browser.newContext();
      const otherPage = await otherContext.newPage();
      await login(otherPage, ownerEmail, initialPassword);
      await expect(otherPage).toHaveURL(/\/en\/dashboard/);

      await page.goto("/en/dashboard/audit");
      await expect(
        page.getByRole("main").getByRole("heading", { name: "Audit log" }),
      ).toBeVisible();
      await expect(page.getByText("location.created").first()).toBeVisible();
      await screenshot(page, "18-audit");

      await page.goto("/en/dashboard/security");
      await expect(
        page.getByRole("main").getByRole("heading", { name: "Sessions and password" }),
      ).toBeVisible();
      const sessionRows = page.locator("table").first().locator("tbody tr");
      await expect.poll(() => sessionRows.count()).toBeGreaterThanOrEqual(2);
      const initialSessionCount = await sessionRows.count();
      await screenshot(page, "19-security-sessions");
      const otherSessionRow = page
        .locator("table")
        .first()
        .locator("tbody tr")
        .filter({ hasNotText: "Current" })
        .first();
      await otherSessionRow.getByRole("button", { name: "Revoke" }).click();
      await expect(sessionRows).toHaveCount(initialSessionCount - 1);

      await page.goto("/en/dashboard/settings");
      await page.locator('input[name="slug"]').fill(changedSlug);
      await page.locator('input[name="password"]').fill(initialPassword);
      await page.getByRole("button", { name: "Change merchant URL" }).click();
      await expect(page.getByText(/previous slug is temporarily reserved/)).toBeVisible();

      await page.goto(`http://localhost:3002/?tenant=${changedSlug}`);
      await expect(page).toHaveURL(
        new RegExp(`/join/browser-studio-rewards\\?tenant=${changedSlug}&lang=en$`),
      );
      await expect(
        page.getByRole("heading", { name: "Browser Studio Rewards", exact: true }),
      ).toBeVisible();
      await screenshot(page, "20-merchant-placeholder");

      const { createPrismaClient } = await import("../../packages/database/dist/src/client.js");
      const database = createPrismaClient(
        process.env.DATABASE_URL ??
          "postgresql://waflo:waflo_dev_password@localhost:5432/waflo?schema=public",
      );
      try {
        await database.organization.update({
          where: { merchantSlug: changedSlug },
          data: { status: "SUSPENDED" },
        });
        await page.goto(`http://localhost:3002/?tenant=${changedSlug}`);
        await expect(page.getByRole("heading", { name: "This page is unavailable" })).toBeVisible();
        await expect(page.getByText(`Browser Coffee ${runId}`, { exact: true })).toHaveCount(0);
        await database.organization.update({
          where: { merchantSlug: changedSlug },
          data: { status: "ACTIVE" },
        });
      } finally {
        await database.$disconnect();
      }

      await page.goto(`http://localhost:3002/?tenant=unknown-${runId}`);
      await expect(page.getByRole("heading", { name: "This page is unavailable" })).toBeVisible();
      await screenshot(page, "21-unknown-merchant");

      await page.goto("http://localhost:3001/en/dashboard/security");
      await page.locator('input[name="currentPassword"]').fill(initialPassword);
      await page.locator('input[name="newPassword"]').fill(changedPassword);
      await page.locator('input[name="confirmPassword"]').fill(changedPassword);
      await page.getByRole("button", { name: "Change password" }).click();
      await expect(page.getByText("Password changed and session rotated.")).toBeVisible();
      await otherContext.close();
    });

    test("enforces Manager billing restrictions and supports organization/language switching", async ({
      page,
    }) => {
      await login(page, "staff@waflo.local", "Waflo-Development-2026");
      await expect(page).toHaveURL(/\/en\/dashboard/);
      await expect(page.locator(".dashboard-nav-link", { hasText: "Billing" })).toHaveCount(0);
      await page.goto("/en/dashboard/billing");
      await expect(page.getByText("Your role does not allow this action.")).toBeVisible();

      await page.context().clearCookies();
      await login(page, "owner@waflo.local", "Waflo-Development-2026");
      await expect(page).toHaveURL(/\/en\/dashboard/);
      const switcher = page.locator(".wf-org-switcher select");
      const options = await switcher.locator("option").allTextContents();
      expect(options).toContain("Today Coffee");
      expect(options).toContain("مخبز النهر");
      await switcher.selectOption({ label: "Today Coffee" });
      await expect(page.getByRole("heading", { name: "Welcome to Today Coffee" })).toBeVisible();
      await switcher.selectOption({ label: "مخبز النهر" });
      await expect(page.getByRole("heading", { name: "Welcome to مخبز النهر" })).toBeVisible();

      await page.getByRole("button", { name: "العربية" }).click();
      await expect(page).toHaveURL(/\/ar\/dashboard/);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator(".wf-sidebar")).toBeVisible();
      await page.goto("/ar/dashboard/team");
      await expect(page.locator("table").first()).toBeVisible();
      await page.getByRole("button", { name: "دعوة عضو" }).click();
      await expect(page.getByRole("dialog")).toHaveCSS("direction", "rtl");
      await screenshot(page, "22-dashboard-ar-rtl");
    });

    test("explains Starter Pro restrictions and blocks a second active program", async ({
      page,
    }) => {
      const { createPrismaClient } = await import("../../packages/database/dist/src/client.js");
      const database = createPrismaClient();
      const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      await Promise.all([
        database.organization.update({
          where: { id: organizationId },
          data: { selectedPlan: "STARTER" },
        }),
        database.organizationBillingProfile.update({
          where: { organizationId },
          data: { selectedPlan: "STARTER" },
        }),
      ]);
      try {
        await page.context().clearCookies();
        await login(page, "owner@waflo.local", "Waflo-Development-2026");
        const switcher = page.locator(".wf-org-switcher select");
        await switcher.selectOption({ label: "Today Coffee" });
        await page.goto("/en/dashboard/programs");
        await expect
          .poll(
            async () =>
              (await page.locator(".program-list__card").count()) +
              (await page.getByText("Create your first loyalty card").count()),
          )
          .toBeGreaterThan(0);

        if ((await page.locator(".program-list__card").count()) === 0) {
          await page.getByRole("button", { name: "Create loyalty card" }).click();
          const proMode = page.getByRole("radio", { name: /Pro Mode/ });
          await proMode.click();
          await expect(proMode).not.toBeChecked();
          await expect(page.getByText("Pro Mode is available on Growth")).toBeVisible();
          await finishQuickWizard(page, `Starter first ${runId}`);
          await expect(page.getByText("The published version remains live")).toHaveCount(0);
          await expect(
            page.locator(".studio-toolbar").getByRole("heading", { level: 1 }),
          ).toContainText("Starter first");
          await page.getByRole("button", { name: "Loyalty Cards" }).click();
        }

        await page.getByRole("button", { name: "Create loyalty card" }).click();
        await finishQuickWizard(page, `Starter blocked ${runId}`);
        await expect(
          page.getByText("Your plan has reached its active program limit."),
        ).toBeVisible();
        await expect(page.getByRole("dialog")).toBeVisible();
        await screenshot(page, "32-starter-program-limit");
      } finally {
        await Promise.all([
          database.organization.update({
            where: { id: organizationId },
            data: { selectedPlan: "SCALE" },
          }),
          database.organizationBillingProfile.update({
            where: { organizationId },
            data: { selectedPlan: "SCALE" },
          }),
        ]);
        await database.$disconnect();
      }
    });

    test("captures the Round 4 lifecycle, asset, PATCH, publication, and entitlement evidence", async ({
      page,
    }) => {
      test.setTimeout(240_000);
      const round4Email = `round4-${runId}@waflo.local`;
      const round4Password = "Round 4 Browser Waflo 2026!";
      const firstProgramName = `Round 4 archived ${runId}`;
      const secondProgramName = `Round 4 active ${runId}`;
      const updatedProgramName = `Round 4 active updated ${runId}`;
      const sameImage = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAARklEQVRYhe3XwQ0AMAhC0U7EOuyfuIfdor28g3cTET5nmv05xwLjBCXCeMNlRMOKK4wijheQDCQrKA0sX8VkVLMqp3mugwtMYqCIQ8Mt0gAAAABJRU5ErkJggg==",
        "base64",
      );

      await signup(page, round4Email, round4Password);
      await verifyLatestEmail(page, round4Email);
      await page.getByRole("button", { name: "Continue to sign in" }).click();
      await login(page, round4Email, round4Password);
      await page.locator('input[name="name"]').fill(`Round 4 Coffee ${runId}`);
      await page.locator('input[name="slug"]').fill(`round4-${runId}`);
      await page.getByRole("button", { name: "Save and continue" }).click();
      await expect(page).toHaveURL(/\/en\/onboarding\/location/);
      await page.locator('input[name="name"]').fill("Round 4 Main Branch");
      await page.getByRole("button", { name: "Create location and finish setup" }).click();
      await expect(page).toHaveURL(/\/en\/onboarding\/complete/);
      const round4OrganizationId = new URL(page.url()).searchParams.get("organization");
      expect(round4OrganizationId).toBeTruthy();
      await page.getByRole("button", { name: "Continue to dashboard" }).click();
      await page.goto("/en/dashboard/programs");

      await page.getByRole("button", { name: "Create loyalty card" }).click();
      await finishQuickWizard(page, firstProgramName);
      await expect(page.getByRole("button", { name: "Archive card" })).toBeVisible();
      await page
        .locator(".studio-section-nav")
        .getByRole("button", { name: /Version history/ })
        .click();
      await expect(page.getByText("Initial draft is preserved")).toBeVisible();
      await screenshot(page, "52-r4-initial-unpublished-archive-action");
      await page.getByRole("button", { name: "Archive card" }).click();
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByRole("button", { name: "Restore card", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Loyalty Cards" }).click();
      await expect(page.getByRole("button", { name: "Create loyalty card" })).toBeEnabled();
      await screenshot(page, "53-r4-starter-slot-released-after-archive");

      await page.getByRole("button", { name: "Create loyalty card" }).click();
      await finishQuickWizard(page, secondProgramName);
      await page.getByRole("button", { name: "Loyalty Cards" }).click();
      const archivedCard = page
        .locator(".program-list__card")
        .filter({ hasText: firstProgramName });
      await archivedCard.getByRole("button", { name: "Open card" }).click();
      await expect(page.getByText("Restore required before publishing")).toBeVisible();
      await expect(
        page.getByText(
          "Restore this card before publishing. Its preserved draft will remain available.",
        ),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Publish card" })).toBeDisabled();
      await screenshot(page, "59-r5-archived-publication-blocked-restore-guidance");
      await page.getByRole("button", { name: "Restore card", exact: true }).click();
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(
        page.getByText("Your plan cannot restore another active program."),
      ).toBeVisible();
      await screenshot(page, "54-r4-restore-blocked-at-program-limit");
      await page.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: "Loyalty Cards" }).click();
      const activeCard = page.locator(".program-list__card").filter({ hasText: secondProgramName });
      await activeCard.getByRole("button", { name: "Open card" }).click();

      await page
        .locator(".studio-section-nav")
        .getByRole("button", { name: /Rewards & milestones/ })
        .click();
      const instructionSave = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes("/programs/") &&
          response.status() === 200,
      );
      await page
        .getByLabel("English redemption instructions")
        .fill("Round 4 preserved redemption instructions.");
      await instructionSave;
      await page
        .locator(".studio-section-nav")
        .getByRole("button", { name: /Overview/ })
        .click();
      const nameSave = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes("/programs/") &&
          response.status() === 200,
      );
      await page.locator(".studio-editor-panel input").first().fill(updatedProgramName);
      await nameSave;
      await page
        .locator(".studio-section-nav")
        .getByRole("button", { name: /Rewards & milestones/ })
        .click();
      await expect(page.getByLabel("English redemption instructions")).toHaveValue(
        "Round 4 preserved redemption instructions.",
      );
      await screenshot(page, "57-r4-partial-name-patch-preserves-reward-instructions");

      await page
        .locator(".studio-section-nav")
        .getByRole("button", { name: /Artwork/ })
        .click();
      const uploadToPicker = async (label: "Logo" | "Background", expectProgramSave = true) => {
        const picker = page.locator(".studio-asset-picker").filter({
          has: page.getByRole("heading", { name: label }),
        });
        await picker.locator('input[type="file"]').setInputFiles({
          name: "round4-same-image.png",
          mimeType: "image/png",
          buffer: sameImage,
        });
        const cropDialog = page.getByRole("dialog").filter({ hasText: "Crop image safely" });
        await expect(cropDialog).toBeVisible();
        const uploaded = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            response.url().includes("/assets") &&
            response.status() === 201,
        );
        const saved = expectProgramSave
          ? page.waitForResponse(
              (response) =>
                response.request().method() === "PATCH" &&
                response.url().includes("/programs/") &&
                response.status() === 200,
            )
          : null;
        await cropDialog.getByRole("button", { name: "Process and upload" }).click();
        const response = await uploaded;
        if (saved) await saved;
        const envelope = (await response.json()) as {
          data: { id: string; uploadDisposition: string };
        };
        return envelope.data;
      };
      const logoAsset = await uploadToPicker("Logo");
      const backgroundAsset = await uploadToPicker("Background");
      expect(logoAsset.id).not.toBe(backgroundAsset.id);
      await screenshot(page, "55-r4-identical-image-two-visual-categories");

      const { createPrismaClient } = await import("../../packages/database/dist/src/client.js");
      const database = createPrismaClient(
        process.env.DATABASE_URL ??
          "postgresql://waflo:waflo_dev_password@localhost:5432/waflo?schema=public",
      );
      try {
        await database.merchantAsset.update({
          where: { id: backgroundAsset.id },
          data: { archivedAt: new Date(), processingStatus: "ARCHIVED" },
        });
        const restoredBackground = await uploadToPicker("Background", false);
        expect(restoredBackground).toMatchObject({
          id: backgroundAsset.id,
          uploadDisposition: "RESTORED",
        });
        await expect(
          page.getByText("The archived matching asset was restored and repaired."),
        ).toBeVisible();
        await screenshot(page, "56-r4-archived-image-reupload-restored");

        for (const section of ["Customer Web", "Apple Wallet", "Google Wallet"]) {
          await page
            .locator(".studio-section-nav")
            .getByRole("button", { name: new RegExp(section) })
            .click();
          await expect(page.locator('img[alt$="preview"]')).toBeVisible();
        }
        await page
          .locator(".studio-section-nav")
          .getByRole("button", { name: /Validation/ })
          .click();
        await page.getByRole("button", { name: "Run validation" }).click();
        await expect(page.getByText(/0 errors/)).toBeVisible();
        await page
          .locator(".studio-section-nav")
          .getByRole("button", { name: /Test Mode/ })
          .click();
        await page.getByRole("button", { name: "Start Test Mode" }).click();
        await page.getByRole("button", { name: "+5 stamps" }).click();
        for (let stamp = 0; stamp < 3; stamp += 1) {
          await page.getByRole("button", { name: "+1 stamp" }).click();
        }
        await page.getByRole("button", { name: "Synthetic redeem" }).click();
        await expect(page.getByText("COMPLETED", { exact: true })).toBeVisible();

        const storedProgram = await database.loyaltyProgram.findFirstOrThrow({
          where: {
            organizationId: round4OrganizationId as string,
            internalName: updatedProgramName,
          },
          include: {
            currentDraftVersion: {
              include: {
                visualTheme: true,
                locations: true,
              },
            },
          },
        });
        const draft = storedProgram.currentDraftVersion;
        expect(draft?.visualTheme).toBeTruthy();
        const locationId = draft?.locations[0]?.locationId as string;
        const publicationAssetId = backgroundAsset.id;

        await database.loyaltyProgram.update({
          where: { id: storedProgram.id },
          data: { status: "SUSPENDED" },
        });
        await page.getByRole("button", { name: "Loyalty Cards" }).click();
        await page
          .locator(".program-list__card")
          .filter({ hasText: secondProgramName })
          .getByRole("button", { name: "Open card" })
          .click();
        await expect(page.getByText("Publishing is unavailable")).toBeVisible();
        await expect(
          page.getByText(
            "This card cannot be published in its current state. Contact support for assistance.",
          ),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "Publish card" })).toBeDisabled();
        await screenshot(page, "60-r5-suspended-publication-blocked");
        await database.loyaltyProgram.update({
          where: { id: storedProgram.id },
          data: { status: "TEST" },
        });
        await page.getByRole("button", { name: "Loyalty Cards" }).click();
        await page
          .locator(".program-list__card")
          .filter({ hasText: secondProgramName })
          .getByRole("button", { name: "Open card" })
          .click();

        await database.location.update({
          where: { id: locationId },
          data: { status: "ARCHIVED" },
        });
        await page.getByRole("button", { name: "Publish card" }).click();
        await page.getByRole("button", { name: "Confirm" }).click();
        await expect(
          page.getByText(
            "Every selected location must still belong to the organization and be active.",
          ),
        ).toBeVisible();
        await page.getByRole("button", { name: "Cancel" }).click();
        await screenshot(page, "49-r4-publication-blocked-inactive-location");
        await database.location.update({
          where: { id: locationId },
          data: { status: "ACTIVE" },
        });

        await database.merchantAsset.update({
          where: { id: publicationAssetId },
          data: { archivedAt: new Date(), processingStatus: "ARCHIVED" },
        });
        await page.getByRole("button", { name: "Publish card" }).click();
        await page.getByRole("button", { name: "Confirm" }).click();
        await expect(page.getByText(/asset is no longer publication-ready/)).toBeVisible();
        await page.getByRole("button", { name: "Cancel" }).click();
        await screenshot(page, "50-r4-publication-blocked-unavailable-asset");
        await database.merchantAsset.update({
          where: { id: publicationAssetId },
          data: { archivedAt: null, processingStatus: "READY" },
        });

        await database.organization.update({
          where: { id: round4OrganizationId as string },
          data: { selectedPlan: "GROWTH" },
        });
        await database.organizationBillingProfile.update({
          where: { organizationId: round4OrganizationId as string },
          data: { selectedPlan: "GROWTH" },
        });
        await database.loyaltyProgramVersion.update({
          where: { id: draft?.id as string },
          data: { editingMode: "PRO" },
        });
        await database.programVisualTheme.update({
          where: { versionId: draft?.id as string },
          data: { layoutType: "PATH" },
        });
        await database.organization.update({
          where: { id: round4OrganizationId as string },
          data: { selectedPlan: "STARTER" },
        });
        await database.organizationBillingProfile.update({
          where: { organizationId: round4OrganizationId as string },
          data: { selectedPlan: "STARTER" },
        });
        await page.getByRole("button", { name: "Publish card" }).click();
        await page.getByRole("button", { name: "Confirm" }).click();
        await expect(
          page.getByText("The draft uses features that are unavailable on the current plan."),
        ).toBeVisible();
        await page.getByRole("button", { name: "Cancel" }).click();
        await screenshot(page, "51-r4-publication-blocked-growth-to-starter");

        await database.loyaltyProgramVersion.update({
          where: { id: draft?.id as string },
          data: { editingMode: "QUICK" },
        });
        await database.programVisualTheme.update({
          where: { versionId: draft?.id as string },
          data: { layoutType: "GRID" },
        });
        await page.getByRole("button", { name: "Publish card" }).click();
        await page.getByRole("button", { name: "Confirm" }).click();
        await expect(page.getByText("The published version remains live")).toBeVisible();
        await screenshot(page, "58-r4-final-valid-publication");
      } finally {
        await database.$disconnect();
      }
    });

    test("blocks unauthenticated dashboard access", async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto("http://localhost:3001/en/dashboard");
      await expect(page).toHaveURL(/\/en\/session-expired/);
      await expect(page.getByText("Your session expired")).toBeVisible();
      await context.close();
    });
  });
