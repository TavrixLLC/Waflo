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
  await page.getByRole("searchbox", { name: "Search loyalty card templates" }).fill(templateName);
  await page.getByRole("button", { name: `Preview: ${templateName}, all templates` }).click();
  await page
    .getByRole("dialog", { name: templateName })
    .getByRole("button", {
      name: templateName === "Start from scratch" ? "Start from scratch" : "Use this template",
    })
    .click();
}

async function finishQuickWizard(page: Page, name: string): Promise<void> {
  const galleryHeading = page.getByRole("heading", {
    level: 1,
    name: "Choose a starting design",
  });
  const builderHeading = page.getByRole("heading", {
    level: 1,
    name: "Customize your loyalty card",
  });
  await expect(
    galleryHeading.or(builderHeading).or(page.getByText("Editing mode", { exact: true })),
  ).toBeVisible();
  if ((await galleryHeading.count()) > 0) {
    await chooseGalleryTemplate(page, "Start from scratch");
    await expect(builderHeading).toBeVisible();
  }
  if ((await builderHeading.count()) > 0) {
    await page.getByLabel("Card name in your dashboard").fill(name);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Review card" }).click();
    await expect(page.getByText("Readiness checks passed", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Continue to Studio" }).click();
    await expect(page.getByRole("navigation", { name: "Studio sections" })).toBeVisible();
    return;
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

      await page.getByRole("link", { name: "Continue to dashboard" }).click();
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
      await chooseGalleryTemplate(page, "Simple Visits");
      await page.getByLabel("Card name in your dashboard").fill("Browser Studio Rewards Updated");
      await page
        .getByRole("button", { name: /^Languages/u })
        .first()
        .click();
      await page.getByRole("tab", { name: /العربية/u }).click();
      await page.getByLabel("اسم البطاقة").fill("مكافآت استوديو المتصفح");
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Review card" }).click();
      await expect(
        page.getByText("Readiness checks passed", { exact: true }).first(),
      ).toBeVisible();
      await page.getByRole("button", { name: "Continue to Studio" }).click();

      await expect(
        page.getByRole("heading", { level: 1, name: "Browser Studio Rewards Updated" }),
      ).toBeVisible();
      await expect(page.locator(".studio-section-nav button")).toHaveCount(6);
      await expect(page.locator(".studio-device-frame img")).toBeVisible();
      await screenshot(page, "23-loyalty-studio-customer-preview");
      const previewProgress = page.locator(".studio-preview-panel input[type=range]");
      await previewProgress.fill("0");
      await expect(page.locator(".studio-device-frame img")).toBeVisible();
      await screenshot(page, "41-r4-stamp-0-of-8-all-empty");
      await previewProgress.fill("5");
      await expect(page.locator(".studio-device-frame img")).toBeVisible();
      await screenshot(page, "42-r4-stamp-5-of-8-two-state");
      await previewProgress.fill("8");
      await expect(page.locator(".studio-device-frame img")).toBeVisible();
      await screenshot(page, "43-r4-stamp-8-of-8-reward-ready");
      await previewProgress.fill("0");

      await page.goto("/ar/dashboard/programs");
      const arabicProgramCard = page
        .locator(".program-list__card")
        .filter({ hasText: "Browser Studio Rewards Updated" });
      await arabicProgramCard.getByRole("button", { name: /فتح البطاقة/ }).click();
      await expect(page.locator(".studio-shell--p4")).toHaveAttribute("dir", "rtl");
      await page.locator(".studio-preview-panel input[type=range]").fill("8");
      await expect(page.locator(".studio-device-frame img")).toBeVisible();
      await screenshot(page, "47-r4-arabic-rtl-reward-ready");

      await page.goto("/en/dashboard/programs");
      const englishProgramCard = page
        .locator(".program-list__card")
        .filter({ hasText: "Browser Studio Rewards Updated" });
      await englishProgramCard.getByRole("button", { name: "Open card" }).click();

      await page.locator(".studio-section-nav").getByRole("button", { name: /^Test/u }).click();
      await page.getByRole("button", { name: "Start demo customer" }).click();
      await screenshot(page, "44-r4-test-mode-cycle-start-empty");
      await page.getByRole("button", { name: "+5 stamps" }).click();
      await page.getByRole("button", { name: "Correct latest stamp" }).click();
      await expect(page.locator(".test-mode-meter")).toContainText("4 / 8");
      for (let stamp = 0; stamp < 4; stamp += 1) {
        await page.getByRole("button", { name: "Add a stamp" }).click();
      }
      await expect(page.getByText("Reward ready", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Use demo reward" }).click();
      await expect(page.getByText("Reward ready", { exact: true })).toHaveCount(0);
      await expect(page.getByText("0 / 8", { exact: true })).toBeVisible();
      await screenshot(page, "48-r4-after-redemption-all-empty");
      await screenshot(page, "25-loyalty-studio-test-mode");

      await page
        .locator(".studio-section-nav")
        .getByRole("button", { name: /^Launch/u })
        .click();
      await page.getByRole("button", { name: "Launch loyalty card" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Launch card" }).click();
      await expect(page.getByRole("button", { name: "Share loyalty card" })).toBeVisible();
      await screenshot(page, "26-loyalty-studio-published");
    });

    test("publishes an update and completes the approved lifecycle actions", async ({ page }) => {
      test.setTimeout(180_000);
      await login(page, ownerEmail, initialPassword);
      await page.goto("/en/dashboard/programs");
      const programCard = page
        .locator(".program-list__card")
        .filter({ hasText: "Browser Studio Rewards Updated" });
      await programCard.getByRole("button", { name: "Open card" }).click();
      await expect(page.getByRole("button", { name: "Share loyalty card" })).toBeVisible();

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

      await page
        .getByRole("navigation", { name: "Studio sections" })
        .getByRole("button", { name: /^How it works/u })
        .click();
      await page.getByRole("button", { name: "Create update" }).click();
      await expect(page.getByText(/Saved changes .* Not live yet/u).first()).toBeVisible();
      await page.getByRole("button", { name: "Edit design" }).click();
      await expect(page.locator(".builder-shell")).toBeVisible();
      await page.getByRole("button", { name: "Review card" }).click();
      await expect(
        page.getByText("Readiness checks passed", { exact: true }).first(),
      ).toBeVisible();
      await page.getByRole("button", { name: "Continue to Studio" }).click();

      const studioNavigation = page.getByRole("navigation", { name: "Studio sections" });
      await studioNavigation.getByRole("button", { name: /^Test/u }).click();
      await page.getByRole("button", { name: "Start demo customer" }).click();
      await page.getByRole("button", { name: "+5 stamps" }).click();
      for (let stamp = 0; stamp < 3; stamp += 1) {
        await page.getByRole("button", { name: "Add a stamp" }).click();
      }
      await page.getByRole("button", { name: "Use demo reward" }).click();

      await studioNavigation.getByRole("button", { name: /^Launch/u }).click();
      await page.getByRole("button", { name: "Publish changes" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Publish changes" }).click();
      await expect(page.getByRole("heading", { name: "Changes published" })).toBeVisible();

      await studioNavigation.getByRole("button", { name: /^Settings/u }).click();
      await page.getByRole("button", { name: "Pause card" }).click();
      await page
        .getByRole("dialog", { name: "Pause card" })
        .getByRole("button", { name: "Pause card" })
        .click();
      await expect(page.getByRole("button", { name: "Resume card" })).toBeVisible();
      await screenshot(page, "29-loyalty-studio-paused");

      await page.getByRole("button", { name: "Resume card" }).click();
      await page
        .getByRole("dialog", { name: "Resume card" })
        .getByRole("button", { name: "Resume card" })
        .click();
      await expect(page.getByRole("button", { name: "Pause card" })).toBeVisible();
      await screenshot(page, "62-r5-explicit-resume-after-paused-replacement");

      await page.getByRole("button", { name: "Archive card" }).click();
      await page
        .getByRole("dialog", { name: "Archive card" })
        .getByRole("button", { name: "Archive card" })
        .click();
      await expect(page.getByRole("button", { name: "Restore card", exact: true })).toBeVisible();
      await screenshot(page, "30-loyalty-studio-archived");

      await page.getByRole("button", { name: "Restore card", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Restore card" })
        .getByRole("button", { name: "Restore card" })
        .click();
      await expect(page.getByRole("button", { name: "Pause card" })).toBeVisible();
      await screenshot(page, "31-loyalty-studio-restored");
    });

    test("keeps legacy create compatibility and real loyalty-card pagination", async ({ page }) => {
      test.setTimeout(120_000);
      await page.context().clearCookies();
      await login(page, "owner@waflo.local", "Waflo-Development-2026");
      const switcher = page.locator(".wf-org-switcher select");
      const growthOrganizationId = await switcher.locator("option").nth(1).getAttribute("value");
      expect(growthOrganizationId).toBeTruthy();
      await switcher.selectOption(growthOrganizationId as string);
      await page.goto("/en/dashboard/programs?create=quick");

      const legacyDialog = page.getByRole("dialog", { name: "Create a loyalty card" });
      await expect(legacyDialog).toBeVisible();
      const legacyTemplate = legacyDialog.locator(".template-card").first();
      await expect(legacyTemplate).toBeVisible();
      await legacyTemplate.click();
      await expect(legacyTemplate).toHaveClass(/template-card--selected/);
      await screenshot(page, "33-w2r3-legacy-create-compatible");

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
        staffPage.getByRole("main").getByRole("heading", { name: "Loyalty cards", exact: true }),
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
        new RegExp(`/join/simple-visits-rewards\\?tenant=${changedSlug}&lang=en$`),
      );
      await expect(
        page.getByRole("heading", { name: "Simple Visits rewards", exact: true }),
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
          await page.getByRole("button", { name: /^Loyalty cards$/iu }).click();
        }

        await page.getByRole("button", { name: "Create loyalty card" }).click();
        await chooseGalleryTemplate(page, "Start from scratch");
        await expect(
          page.getByText(
            "You have reached your plan's active loyalty-card limit. Archive a card or change plan to continue.",
          ),
        ).toBeVisible();
        await expect(page.getByRole("heading", { name: "Choose a starting design" })).toBeVisible();
        await expect(page.getByRole("button", { name: /Use .* template/ })).toHaveCount(0);
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
      await page.getByRole("link", { name: "Continue to dashboard" }).click();
      await page.goto("/en/dashboard/programs");

      await page.getByRole("button", { name: "Create loyalty card" }).click();
      await finishQuickWizard(page, firstProgramName);
      const firstStudioNavigation = page.getByRole("navigation", { name: "Studio sections" });
      await firstStudioNavigation.getByRole("button", { name: /^Settings/u }).click();
      await expect(page.getByRole("button", { name: "Archive card" })).toBeVisible();
      await expect(page.getByText("Initial draft is preserved")).toBeVisible();
      await screenshot(page, "52-r4-initial-unpublished-archive-action");
      await page.getByRole("button", { name: "Archive card" }).click();
      await page
        .getByRole("dialog", { name: "Archive card" })
        .getByRole("button", { name: "Archive card" })
        .click();
      await expect(page.getByRole("button", { name: "Restore card", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Return to Loyalty Cards" }).click();
      await expect(page.getByRole("button", { name: "Create loyalty card" })).toBeEnabled();
      await screenshot(page, "53-r4-starter-slot-released-after-archive");

      await page.getByRole("button", { name: "Create loyalty card" }).click();
      await finishQuickWizard(page, secondProgramName);
      await page.getByRole("button", { name: /^Loyalty cards$/iu }).click();
      const archivedCard = page
        .locator(".program-list__card")
        .filter({ hasText: firstProgramName });
      await archivedCard.getByRole("button", { name: "Open card" }).click();
      await expect(page.getByText("This loyalty card is archived", { exact: true })).toBeVisible();
      await expect(page.getByText(/Restore it to continue managing/u).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Launch loyalty card" })).toHaveCount(0);
      await screenshot(page, "59-r5-archived-publication-blocked-restore-guidance");
      await page.getByRole("button", { name: "Restore card", exact: true }).click();
      const blockedRestore = page.waitForResponse(
        (response) => response.url().endsWith("/restore") && response.status() === 409,
      );
      await page
        .getByRole("dialog", { name: "Restore card" })
        .getByRole("button", { name: "Restore card" })
        .click();
      await blockedRestore;
      await expect(page.getByText("This loyalty card is archived", { exact: true })).toBeVisible();
      await screenshot(page, "54-r4-restore-blocked-at-program-limit");
      await page.getByRole("button", { name: /^Loyalty cards$/iu }).click();
      const activeCard = page.locator(".program-list__card").filter({ hasText: secondProgramName });
      await activeCard.getByRole("button", { name: "Open card" }).click();

      await page.getByRole("button", { name: "Edit design" }).click();
      await expect(page.locator(".builder-shell")).toBeVisible();
      await page
        .getByRole("button", { name: /^Reward/u })
        .first()
        .click();
      const rewardSummary = page.locator('input[name="builder-reward-en"]');
      const preservedRewardSummary = await rewardSummary.inputValue();
      await page
        .getByRole("button", { name: /^Basics/u })
        .first()
        .click();
      const nameSave = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes("/programs/") &&
          response.status() === 200,
      );
      await page.getByLabel("Card name in your dashboard").fill(updatedProgramName);
      await nameSave;
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await page
        .getByRole("button", { name: /^Reward/u })
        .first()
        .click();
      await expect(rewardSummary).toHaveValue(preservedRewardSummary);
      await screenshot(page, "57-r4-partial-name-patch-preserves-reward-instructions");

      await page
        .getByRole("button", { name: /^Appearance/u })
        .first()
        .click();
      const uploadToPicker = async (label: "Logo" | "Stamped icon", expectProgramSave = true) => {
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
      const stampAsset = await uploadToPicker("Stamped icon");
      expect(logoAsset.id).not.toBe(stampAsset.id);
      await screenshot(page, "55-r4-identical-image-two-visual-categories");

      const { createPrismaClient } = await import("../../packages/database/dist/src/client.js");
      const database = createPrismaClient(
        process.env.DATABASE_URL ??
          "postgresql://waflo:waflo_dev_password@localhost:5432/waflo?schema=public",
      );
      try {
        await database.merchantAsset.update({
          where: { id: stampAsset.id },
          data: { archivedAt: new Date(), processingStatus: "ARCHIVED" },
        });
        const restoredStamp = await uploadToPicker("Stamped icon", false);
        expect(restoredStamp).toMatchObject({
          id: stampAsset.id,
          uploadDisposition: "RESTORED",
        });
        await expect(
          page.getByText("The archived matching asset was restored and repaired."),
        ).toBeVisible();
        await screenshot(page, "56-r4-archived-image-reupload-restored");

        for (const surface of ["Customer", "Apple Wallet", "Google Wallet"]) {
          await page.getByRole("tab", { name: surface, exact: true }).click();
          await expect(page.locator(".builder-preview-desktop img")).toBeVisible();
        }
        await page.getByRole("button", { name: "Review card" }).click();
        await expect(
          page.getByText("Readiness checks passed", { exact: true }).first(),
        ).toBeVisible();
        await page.getByRole("button", { name: "Continue to Studio" }).click();
        const studioNavigation = page.getByRole("navigation", { name: "Studio sections" });
        await studioNavigation.getByRole("button", { name: /^Test/u }).click();
        await page.getByRole("button", { name: "Start demo customer" }).click();
        await page.getByRole("button", { name: "+5 stamps" }).click();
        for (let stamp = 0; stamp < 3; stamp += 1) {
          await page.getByRole("button", { name: "Add a stamp" }).click();
        }
        await expect(page.getByText("Reward ready", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Use demo reward" }).click();
        await expect(page.getByText("0 / 8", { exact: true })).toBeVisible();

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
        const publicationAssetId = stampAsset.id;

        await database.loyaltyProgram.update({
          where: { id: storedProgram.id },
          data: { status: "SUSPENDED" },
        });
        await page.getByRole("button", { name: /^Loyalty cards$/iu }).click();
        await page
          .locator(".program-list__card")
          .filter({ hasText: updatedProgramName })
          .getByRole("button", { name: "Open card" })
          .click();
        await page
          .getByRole("navigation", { name: "Studio sections" })
          .getByRole("button", { name: /^Launch/u })
          .click();
        await expect(page.getByText("Launch unavailable", { exact: true })).toBeVisible();
        await expect(
          page.getByText("This card is unavailable under the existing suspension rule.").first(),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "Launch loyalty card" })).toHaveCount(0);
        await screenshot(page, "60-r5-suspended-publication-blocked");
        await database.loyaltyProgram.update({
          where: { id: storedProgram.id },
          data: { status: "TEST" },
        });
        await page.getByRole("button", { name: /^Loyalty cards$/iu }).click();
        await page
          .locator(".program-list__card")
          .filter({ hasText: updatedProgramName })
          .getByRole("button", { name: "Open card" })
          .click();
        await page
          .getByRole("navigation", { name: "Studio sections" })
          .getByRole("button", { name: /^Launch/u })
          .click();

        await database.location.update({
          where: { id: locationId },
          data: { status: "ARCHIVED" },
        });
        await page.getByRole("button", { name: "Launch loyalty card" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Launch card" }).click();
        await expect(
          page.getByText("Launch could not be completed", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("The participating location selection changed after your checks ran."),
        ).toBeVisible();
        await screenshot(page, "49-r4-publication-blocked-inactive-location");
        await database.location.update({
          where: { id: locationId },
          data: { status: "ACTIVE" },
        });

        await database.merchantAsset.update({
          where: { id: publicationAssetId },
          data: { archivedAt: new Date(), processingStatus: "ARCHIVED" },
        });
        await page.getByRole("button", { name: "Launch loyalty card" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Launch card" }).click();
        await expect(
          page.getByText("A required card asset is unavailable", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(/saved card assets is missing or is no longer ready/u),
        ).toBeVisible();
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
        await page.getByRole("button", { name: "Launch loyalty card" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Launch card" }).click();
        await expect(
          page.getByText("Your plan currently blocks publication", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(
            "The current plan or billing state no longer allows this card to be published.",
          ),
        ).toBeVisible();
        await screenshot(page, "51-r4-publication-blocked-growth-to-starter");

        await database.loyaltyProgramVersion.update({
          where: { id: draft?.id as string },
          data: { editingMode: "QUICK" },
        });
        await database.programVisualTheme.update({
          where: { versionId: draft?.id as string },
          data: { layoutType: "GRID" },
        });
        await page.getByRole("button", { name: "Launch loyalty card" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Launch card" }).click();
        await expect(page.getByRole("button", { name: "Share loyalty card" })).toBeVisible();
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
