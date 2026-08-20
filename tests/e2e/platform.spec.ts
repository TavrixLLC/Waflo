import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

const screenshots = "test-results/evidence/handoff-w2-round-5/screenshots";
const runId = randomUUID().slice(0, 8);
const ownerEmail = `browser-owner-${runId}@waflo.local`;
const localStaffName = "Layla Abbas";
const resetEmail = `browser-reset-${runId}@waflo.local`;
const initialPassword = "Browser Waflo 2026!";
const changedPassword = "Browser Waflo Changed 2026!";
const resetPassword = "Browser Waflo Reset 2026!";
const initialSlug = `browser-${runId}`;
const changedSlug = `flow-${runId}`;
const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
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

async function csrfToken(page: Page): Promise<string> {
  const response = await page.request.get(`${apiOrigin}/v1/auth/csrf`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: { csrfToken: string } }).data.csrfToken;
}

async function postOrganizationWithExactLocation(
  page: Page,
  name: string,
  slug: string,
  locationName: string,
): Promise<string> {
  const token = await csrfToken(page);
  const response = await page.request.post(`${apiOrigin}/v1/organizations`, {
    headers: { origin: "http://localhost:3001", "x-csrf-token": token },
    data: {
      name,
      merchantSlug: slug,
      businessCategory: "Cafe",
      defaultLocale: "en",
      timezone: "UTC",
      selectedPlan: "starter",
      commandId: randomUUID(),
      firstLocation: {
        name: locationName,
        addressLine1: "Main Street, Baghdad, Iraq",
        city: "Baghdad",
        countryCode: "IQ",
        timezone: "UTC",
        latitude: 33.3152,
        longitude: 44.3661,
        coordinatesConfirmed: true,
      },
    },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

async function switchOrganization(page: Page, organizationName: string): Promise<void> {
  const trigger = page.getByRole("button", { name: "Choose organization" });
  await trigger.click();
  await page.getByRole("option", { name: organizationName, exact: true }).click();
  await expect(trigger).toContainText(organizationName);
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
    await page.getByRole("button", { name: /^Basics/u }).click();
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
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "Turn every visit into a reason to return.",
      );
      await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
      await screenshot(page, "01-marketing-home-en");

      await page.goto("http://localhost:3000/ar");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await screenshot(page, "02-marketing-home-ar");

      await page.goto("http://localhost:3000/en/pricing");
      await expect(page.locator(".wf-plan-card__price")).toHaveText([
        /\$24\.17\/month/u,
        /\$57\.50\/month/u,
        /\$107\.50\/month/u,
      ]);
      await expect(page.locator(".wf-plan-card__cadence")).toHaveText([
        /\$290\.00 billed yearly/u,
        /\$690\.00 billed yearly/u,
        /\$1290\.00 billed yearly/u,
      ]);
      await expect(page.getByText(/Save 8\.33%/u).first()).toBeVisible();
      await expect(page.getByText(/2 months free · Save 16\.67%/u).first()).toBeVisible();
      await screenshot(page, "03-pricing");

      await page.goto("http://localhost:3000/en/refunds");
      await expect(
        page.getByRole("heading", { name: "Waflo Billing & Refund Policy" }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Stops renewal according to the subscription state; it does not automatically reverse a past payment.",
          { exact: true },
        ),
      ).toBeVisible();
      await page.goto("http://localhost:3000/ar/refunds");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    });

    test("keeps signup state while Terms and Privacy open safely in new tabs", async ({ page }) => {
      await page.goto("/en/signup");
      await page.locator('input[name="displayName"]').fill("Legal State Preserved");
      await page.locator('input[name="email"]').fill(`legal-state-${runId}@waflo.local`);
      await expect(page.locator('input[name="terms"]')).not.toBeChecked();
      await expect(page.locator('input[name="privacy"]')).not.toBeChecked();

      for (const [name, path] of [
        ["Terms of Service", "/en/terms"],
        ["Privacy Policy", "/en/privacy"],
      ] as const) {
        const link = page.getByRole("link", { name });
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", "noopener noreferrer");
        const opened = page.context().waitForEvent("page");
        await link.click();
        const legalPage = await opened;
        await legalPage.waitForLoadState("domcontentloaded");
        await expect(legalPage).toHaveURL(new RegExp(`${path}$`));
        await legalPage.close();
        await expect(page.locator('input[name="displayName"]')).toHaveValue(
          "Legal State Preserved",
        );
        await expect(page.locator('input[name="email"]')).toHaveValue(
          `legal-state-${runId}@waflo.local`,
        );
      }
    });

    test("registers, verifies email, and reaches payment-gated onboarding", async ({ page }) => {
      await page.goto("/en/signup");
      await screenshot(page, "04-signup");
      await signup(page, ownerEmail, initialPassword);
      await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
      await screenshot(page, "05-email-verification-pending");

      await verifyLatestEmail(page, ownerEmail);
      await screenshot(page, "06-email-verification-complete");
      await page.getByRole("link", { name: "Continue to sign in" }).click();
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
      await page.locator('input[name="locationName"]').fill("Browser Main Branch");
      await expect(page.getByText("The map is unavailable right now")).toBeVisible();
      await expect(page.getByRole("button", { name: "Save and continue" })).toBeDisabled();

      browserOrganizationId = await postOrganizationWithExactLocation(
        page,
        `Browser Coffee ${runId}`,
        initialSlug,
        "Browser Main Branch",
      );
      await page.goto(`/en/onboarding/business?organization=${browserOrganizationId}`);
      await expect(page.getByRole("heading", { name: "Choose your plan" })).toBeVisible();
      expect(browserOrganizationId).toBeTruthy();
      const organizationResponse = await page.request.get(
        `${apiOrigin}/v1/organizations/${browserOrganizationId}`,
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
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("heading", { name: "Billing details" })).toBeVisible();
      await page.locator('input[name="billingName"]').fill(`Browser Coffee ${runId}`);
      await page.locator('input[name="billingEmail"]').fill(ownerEmail);
      await page.locator('input[name="addressLine1"]').fill("Main Street");
      await page.locator('input[name="billingCity"]').fill("Baghdad");
      await screenshot(page, "10-onboarding-billing-details");

      await page.getByRole("button", { name: "Continue to payment" }).click();
      await expect(
        page.getByText(
          "Billing setup is not configured right now. Try again or contact Waflo support.",
        ),
      ).toBeVisible();
      const paymentGatedOrganizationResponse = await page.request.get(
        `${apiOrigin}/v1/organizations/${browserOrganizationId}`,
      );
      const paymentGatedOrganizationEnvelope = (await paymentGatedOrganizationResponse.json()) as {
        data: {
          billingProfile: {
            subscriptionStatus: string;
            trialStart: string | null;
            trialEnd: string | null;
          };
        };
      };
      expect(paymentGatedOrganizationEnvelope.data.billingProfile).toMatchObject({
        subscriptionStatus: "PENDING_ACTIVATION",
        trialStart: null,
        trialEnd: null,
      });

      // The browser CI deliberately has no Stripe credentials. Downstream
      // loyalty lifecycle tests use an explicit existing-trial fixture; the
      // product path above remains payment-gated and is covered end-to-end at
      // the service boundary by the embedded-trial concurrency suite.
      const { createPrismaClient } = await import("../../packages/database/dist/src/client.js");
      const database = createPrismaClient(
        process.env.DATABASE_URL ??
          "postgresql://waflo:waflo_dev_password@localhost:5432/waflo?schema=public",
      );
      const trialStart = new Date();
      const trialEnd = new Date(trialStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      try {
        await database.$transaction([
          database.organization.update({
            where: { id: browserOrganizationId },
            data: { onboardingState: "COMPLETE", onboardingCompletedAt: trialStart },
          }),
          database.organizationBillingProfile.update({
            where: { organizationId: browserOrganizationId },
            data: { subscriptionStatus: "TRIALING", trialStart, trialEnd },
          }),
        ]);
      } finally {
        await database.$disconnect();
      }

      await page.goto("/en/dashboard");
      await expect(page.getByText("Free trial", { exact: true })).toBeVisible();
      await expect(page.getByText(/Choose a plan and add a payment method/)).toHaveCount(0);
      await expect(page.getByText(/stamps issued/i)).toHaveCount(0);
      await screenshot(page, "11-dashboard-en");
    });

    test("completes Quick Mode, autosaves Studio, validates, and publishes", async ({ page }) => {
      await login(page, ownerEmail, initialPassword);
      await page.goto("/en/dashboard/programs");
      await expect(
        page.getByRole("main").getByRole("heading", { name: "Loyalty cards" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Create loyalty card" }).click();
      await chooseGalleryTemplate(page, "Simple Visits");
      await page
        .getByRole("button", { name: /^Basics/u })
        .first()
        .click();
      await page.getByLabel("Card name in your dashboard").fill("Browser Studio Rewards Updated");
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Review card" }).click();
      await expect(
        page.getByText("Readiness checks passed", { exact: true }).first(),
      ).toBeVisible();
      await page.getByRole("button", { name: "Continue to Studio" }).click();

      await expect(
        page.getByRole("heading", { level: 1, name: "Browser Studio Rewards Updated" }),
      ).toBeVisible();
      await expect(
        page.getByRole("navigation", { name: "Studio sections" }).getByRole("button"),
      ).toHaveCount(6);
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

      await expect(
        page.locator(".studio-section-nav").getByRole("button", { name: /^Test/u }),
      ).toHaveCount(0);
      await screenshot(page, "25-loyalty-studio-automatic-checks");

      await page
        .locator(".studio-section-nav")
        .getByRole("button", { name: /^(?:Review & launch|Launch)/u })
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
        `${apiOrigin}/v1/organizations/${browserOrganizationId}`,
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
      expect(billingEnvelope.data.billingProfile.trialTriggeringProgramId).toBeNull();

      await page
        .getByRole("navigation", { name: "Studio sections" })
        .getByRole("button", { name: /^How it works/u })
        .click();
      await page.getByRole("button", { name: "Create update" }).click();
      await expect(page.getByText(/Live .* Unpublished changes/u).first()).toBeVisible();
      await page.getByRole("button", { name: "Edit design" }).click();
      await expect(page.locator(".builder-shell")).toBeVisible();
      await page.getByRole("button", { name: "Review card" }).click();
      await expect(
        page.getByText("Readiness checks passed", { exact: true }).first(),
      ).toBeVisible();
      await page.getByRole("button", { name: "Continue to Studio" }).click();

      const studioNavigation = page.getByRole("navigation", { name: "Studio sections" });
      await expect(studioNavigation.getByRole("button", { name: /^Test/u })).toHaveCount(0);

      await studioNavigation.getByRole("button", { name: /^(?:Review & launch|Launch)/u }).click();
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
      const growthOrganizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      await switchOrganization(page, "مخبز النهر");
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

    test("edits settings and keeps plan-limited operations blocked without billing configuration", async ({
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
      await expect(page.getByText(/Change plan or archive a location/)).toBeVisible();
      await screenshot(page, "12-locations-limit");

      await page.goto("/en/dashboard/billing");
      await expect(
        page.getByRole("main").getByRole("heading", { name: "Billing", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("Billing configuration is incomplete")).toBeVisible();
      await screenshot(page, "13-billing");
      const growthCard = page.locator(".wf-plan-card").filter({ hasText: "Growth" });
      await expect(growthCard.getByRole("button", { name: "Choose plan" })).toHaveCount(0);

      await page.goto("/en/dashboard/locations");
      await expect(page.getByText("Location limit reached")).toBeVisible();
      await expect(page.getByRole("button", { name: "Add location" })).toBeDisabled();
      await screenshot(page, "14-locations");
    });

    test("keeps routine billing inside Waflo and removes hosted Checkout from the UI", async ({
      page,
    }) => {
      await login(page, ownerEmail, initialPassword);
      await page.goto("/en/dashboard/billing");
      await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
      await expect(page.getByText(/Stripe Checkout/i)).toHaveCount(0);
      await expect(page.getByRole("link", { name: /customer portal/i })).toHaveCount(0);
      await expect(page.getByText("Payment method", { exact: true }).first()).toBeVisible();
    });

    test("shows authoritative Billing details and submits a bounded refund review", async ({
      page,
    }) => {
      await login(page, ownerEmail, initialPassword);
      let refundRequested = false;
      let refundPosts = 0;
      const invoiceId = "f1111111-1111-4111-8111-111111111111";
      await page.route("**/v1/organizations/*/billing", async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        const refund = refundRequested
          ? [
              {
                id: "f2222222-2222-4222-8222-222222222222",
                status: "REQUESTED",
                reason: "INCORRECT_CHARGE",
                explanation: "The billed amount needs review.",
                requestedAmount: 1700,
                approvedAmount: null,
                currency: "USD",
                requestedAt: "2026-08-12T12:00:00.000Z",
                completedAt: null,
                failureCode: null,
              },
            ]
          : [];
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              selectedPlan: "GROWTH",
              canManageBilling: true,
              selectedCadence: "quarterly",
              profile: {
                subscriptionStatus: "ACTIVE",
                trialStart: "2026-07-01T09:00:00.000Z",
                trialEnd: "2026-07-15T09:00:00.000Z",
              },
              customerPortalAvailable: true,
              subscriptions: [
                {
                  id: "sub_local_browser",
                  status: "ACTIVE",
                  planCode: "GROWTH",
                  cadence: "QUARTERLY",
                  currentPeriodEnd: "2026-10-01T09:00:00.000Z",
                  cancelAtPeriodEnd: false,
                  createdAt: "2026-07-01T09:00:00.000Z",
                },
              ],
              stripeConfigured: true,
              cadenceAvailability: { monthly: true, quarterly: true, yearly: true },
              paymentMethod: {
                status: "saved",
                brand: "visa",
                last4: "4242",
                expMonth: 8,
                expYear: 2029,
                isDefault: true,
              },
              billingIdentity: {
                name: "Browser Coffee",
                email: ownerEmail,
                countryCode: "IQ",
                addressLine1: "Main Street",
                addressLine2: null,
                city: "Baghdad",
                region: "Baghdad",
                postalCode: "10001",
                locale: "en",
                timezone: "Asia/Baghdad",
                syncedAt: "2026-08-12T10:00:00.000Z",
              },
              authoritativeState: {
                subscriptionStatus: "ACTIVE",
                trialStart: "2026-07-01T09:00:00.000Z",
                trialEnd: "2026-07-15T09:00:00.000Z",
                renewalDate: "2026-10-01T09:00:00.000Z",
                nextExpectedChargeDate: "2026-10-01T09:00:00.000Z",
                nextExpectedAmount: 19251,
                currency: "USD",
                latestPaymentStatus: "paid",
                gracePeriodEnd: null,
                outstandingInvoice: null,
              },
              invoices: [
                {
                  id: invoiceId,
                  number: "WF-2026-0042",
                  status: "paid",
                  paymentStatus: "paid",
                  amountDue: 19251,
                  amountPaid: 19251,
                  amountRemaining: 0,
                  currency: "USD",
                  date: "2026-07-01T09:00:00.000Z",
                  periodStart: "2026-07-01T09:00:00.000Z",
                  periodEnd: "2026-10-01T09:00:00.000Z",
                  paidAt: "2026-07-01T09:00:00.000Z",
                  hostedInvoiceUrl: "https://invoice.stripe.test/hosted",
                  invoicePdfUrl: "https://invoice.stripe.test/invoice.pdf",
                  refundable: !refundRequested,
                  amountRefunded: 0,
                  remainingRefundableAmount: refundRequested ? 17551 : 19251,
                  paymentMethod: {
                    brand: "visa",
                    last4: "4242",
                    expMonth: 8,
                    expYear: 2029,
                  },
                  refunds: refund,
                },
              ],
              downgradeOptions: [
                {
                  plan: "starter",
                  violations: [
                    {
                      code: "TEAM_SEATS",
                      actual: 4,
                      limit: 3,
                      message:
                        "Remove or cancel Staff and Manager seats until the team fits the target plan.",
                    },
                  ],
                },
              ],
            },
            requestId: `billing-browser-${runId}`,
          }),
        });
      });
      await page.route("**/v1/organizations/*/billing/invoices/*/refunds", async (route) => {
        refundPosts += 1;
        expect(route.request().method()).toBe("POST");
        expect(route.request().headers()["x-idempotency-key"]).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
        expect(route.request().postDataJSON()).toMatchObject({
          reason: "incorrect_charge",
          amount: 1700,
          explanation: "The billed amount needs review.",
        });
        refundRequested = true;
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              id: "f2222222-2222-4222-8222-222222222222",
              status: "REQUESTED",
            },
            requestId: `refund-browser-${runId}`,
          }),
        });
      });

      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto("/en/dashboard/billing");
      await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
      await expect(page.getByText("$189.75").first()).toBeVisible();
      await expect(page.getByText(/VISA .*4242/).first()).toBeVisible();
      await expect(page.getByText("Expires 08/2029", { exact: false }).first()).toBeVisible();
      await expect(page.getByText("WF-2026-0042")).toBeVisible();
      await expect(page.getByRole("link", { name: "Invoice / receipt" })).toHaveAttribute(
        "target",
        "_blank",
      );
      await expect(page.getByText(/8\.33%/u).first()).toBeVisible();
      await expect(page.getByText(/2 months free/u).first()).toBeVisible();
      await expect(
        page.getByText("You need to resolve these items before downgrading."),
      ).toBeVisible();
      await expect(
        page.getByText("Remove or cancel Staff and Manager seats", { exact: false }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Request refund for invoice WF-2026-0042" }).click();
      const refundDialog = page.getByRole("dialog", { name: "Request a refund review" });
      await expect(refundDialog.getByText("Originally paid")).toBeVisible();
      await expect(refundDialog.getByText("Remaining refundable")).toBeVisible();
      const refundReason = refundDialog.getByRole("combobox", { name: "Reason" });
      await refundReason.click();
      await page.getByRole("option", { name: "Incorrect charge", exact: true }).click();
      await expect(refundReason).toHaveValue("Incorrect charge");
      await refundDialog.getByRole("spinbutton", { name: "Amount (USD)" }).fill("17.00");
      await refundDialog
        .getByRole("textbox", { name: "Optional explanation" })
        .fill("The billed amount needs review.");
      await refundDialog.getByRole("button", { name: "Submit refund request" }).click();
      await expect(page.getByText("Requested", { exact: true })).toBeVisible();
      expect(refundPosts).toBe(1);

      for (const width of [768, 390, 360]) {
        await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        ).toBe(true);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(() => {
        document.documentElement.style.zoom = "2";
      });
      await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
      await screenshot(page, "13b-billing-refund-responsive");
    });

    test("creates a local Staff identity and generates its only valid sign-in QR", async ({
      page,
    }) => {
      await login(page, ownerEmail, initialPassword);
      await page.goto("/en/dashboard/team");
      await page.getByRole("button", { name: "Add staff" }).click();
      await page.locator('input[name="name"]').fill(localStaffName);
      await expect(page.getByText(/No email is needed/)).toBeVisible();
      await screenshot(page, "15-local-staff-dialog");
      await page.getByRole("button", { name: "Create staff" }).click();
      const staffRow = page.getByRole("row").filter({ hasText: localStaffName });
      await expect(staffRow).toContainText("QR sign-in · no email");
      await screenshot(page, "16-team");

      await staffRow.getByRole("button", { name: "Pair phone" }).click();
      await expect(page.getByText("Regeneration signs out prior access")).toBeVisible();
      await page.getByRole("button", { name: "Generate QR" }).click();
      const pairingDialog = page.getByRole("dialog", { name: "Pair staff device" });
      await expect(pairingDialog.getByText("This is the only valid code")).toBeVisible();
      const pairingImage = pairingDialog.locator("img");
      await expect(pairingImage).toBeVisible();
      await expect
        .poll(() => pairingImage.evaluate((image) => image.naturalWidth))
        .toBeGreaterThan(0);
      await screenshot(page, "17-staff-sign-in-qr");
      await page.getByRole("button", { name: "Done" }).click();

      await staffRow.getByText("More", { exact: true }).click();
      await staffRow.getByRole("button", { name: "Change role to Manager" }).click();
      await expect(staffRow).toContainText("Manager");
    });

    test("removes standalone audit UI, manages sessions, changes slug and password, and resolves the new host", async ({
      browser,
      page,
    }) => {
      await login(page, ownerEmail, initialPassword);
      const otherContext = await browser.newContext();
      const otherPage = await otherContext.newPage();
      await login(otherPage, ownerEmail, initialPassword);
      await expect(otherPage).toHaveURL(/\/en\/dashboard/);

      for (const removedScreen of ["Manager approvals", "Risk", "Audit"]) {
        await expect(page.getByRole("link", { name: removedScreen })).toHaveCount(0);
      }
      for (const removedRoute of ["approvals", "risk", "audit"]) {
        const response = await page.goto(`/en/dashboard/${removedRoute}`);
        expect(response?.status()).toBe(404);
      }

      await page.goto("/en/dashboard/security");
      await expect(page.getByRole("main").getByRole("heading", { name: "Security" })).toBeVisible();
      await page.getByText("Other devices", { exact: true }).click();
      const sessionRows = page.locator("table").first().locator("tbody tr");
      await expect.poll(() => sessionRows.count()).toBeGreaterThanOrEqual(1);
      const initialSessionCount = await sessionRows.count();
      await screenshot(page, "19-security-sessions");
      const otherSessionRow = page.locator("table").first().locator("tbody tr").first();
      await otherSessionRow.getByRole("button", { name: "Sign out" }).click();
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
      await switchOrganization(page, "Today Coffee");
      await expect(page.getByRole("heading", { name: "Welcome, Today Coffee" })).toBeVisible();
      await switchOrganization(page, "مخبز النهر");
      await expect(page.getByRole("heading", { name: "Welcome, مخبز النهر" })).toBeVisible();

      await page.getByRole("button", { name: "Language" }).click();
      await page.getByRole("menuitemradio", { name: "العربية" }).click();
      await expect(page).toHaveURL(/\/ar\/dashboard/);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator(".wf-sidebar")).toBeVisible();
      await page.goto("/ar/dashboard/team");
      await expect(page.locator("table").first()).toBeVisible();
      await page.getByRole("button", { name: "إضافة موظف" }).click();
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
        await switchOrganization(page, "Today Coffee");
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
      await page.getByRole("link", { name: "Continue to sign in" }).click();
      await login(page, round4Email, round4Password);
      await page.locator('input[name="name"]').fill(`Round 4 Coffee ${runId}`);
      await page.locator('input[name="slug"]').fill(`round4-${runId}`);
      await expect(page.getByText("URL is available")).toBeVisible();
      await page.locator('input[name="locationName"]').fill("Round 4 Main Branch");
      await expect(page.getByText("The map is unavailable right now")).toBeVisible();
      const createdRound4OrganizationId = await postOrganizationWithExactLocation(
        page,
        `Round 4 Coffee ${runId}`,
        `round4-${runId}`,
        "Round 4 Main Branch",
      );
      await page.goto(`/en/onboarding/business?organization=${createdRound4OrganizationId}`);
      await expect(page.getByRole("heading", { name: "Choose your plan" })).toBeVisible();
      const round4OrganizationId = new URL(page.url()).searchParams.get("organization");
      expect(round4OrganizationId).toBeTruthy();
      const { createPrismaClient: createSetupPrismaClient } = await import(
        "../../packages/database/dist/src/client.js"
      );
      const setupDatabase = createSetupPrismaClient(
        process.env.DATABASE_URL ??
          "postgresql://waflo:waflo_dev_password@localhost:5432/waflo?schema=public",
      );
      const round4TrialStart = new Date();
      const round4TrialEnd = new Date(round4TrialStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      try {
        await setupDatabase.$transaction([
          setupDatabase.organization.update({
            where: { id: round4OrganizationId as string },
            data: { onboardingState: "COMPLETE", onboardingCompletedAt: round4TrialStart },
          }),
          setupDatabase.organizationBillingProfile.update({
            where: { organizationId: round4OrganizationId as string },
            data: {
              subscriptionStatus: "TRIALING",
              trialStart: round4TrialStart,
              trialEnd: round4TrialEnd,
            },
          }),
        ]);
      } finally {
        await setupDatabase.$disconnect();
      }
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
      const uploadStampToPicker = async (expectProgramSave = true) => {
        const picker = page.locator(".studio-asset-picker").filter({
          has: page.getByRole("heading", { name: "Stamped icon" }),
        });
        await picker.locator('input[type="file"]').setInputFiles({
          name: "round4-same-image.png",
          mimeType: "image/png",
          buffer: sameImage,
        });
        const cropDialog = page.getByRole("dialog").filter({ hasText: "Crop image safely" });
        await expect(cropDialog).toBeVisible();
        await expect(cropDialog.getByText("Horizontal position")).toHaveCount(0);
        await expect(cropDialog.getByText("Vertical position")).toHaveCount(0);
        const cropSurface = cropDialog.getByRole("button", { name: /Crop area/ });
        const cropBounds = await cropSurface.boundingBox();
        if (!cropBounds) throw new Error("Crop surface bounds are unavailable.");
        await page.mouse.move(
          cropBounds.x + cropBounds.width / 2,
          cropBounds.y + cropBounds.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          cropBounds.x + cropBounds.width * 0.6,
          cropBounds.y + cropBounds.height * 0.6,
        );
        await page.mouse.up();
        await cropDialog.getByRole("slider").fill("1.5");
        await expect(cropDialog.getByRole("slider")).toHaveValue("1.5");
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
      const stampAsset = await uploadStampToPicker();
      const builderPath = new URL(page.url()).pathname;
      await expect(
        page.locator(".studio-asset-picker").filter({
          has: page.getByRole("heading", { name: "Logo" }),
        }),
      ).toHaveCount(0);

      await page.goto("/en/dashboard/settings");
      const merchantBrandPicker = page.locator(".studio-asset-picker").filter({
        has: page.getByRole("heading", { name: "Merchant logo" }),
      });
      await merchantBrandPicker.locator('input[type="file"]').setInputFiles({
        name: "round4-same-image.png",
        mimeType: "image/png",
        buffer: sameImage,
      });
      const merchantCropDialog = page.getByRole("dialog", { name: "Crop image safely" });
      await expect(merchantCropDialog).toBeVisible();
      const merchantLogoUploaded = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().includes("/assets") &&
          response.status() === 201,
      );
      await merchantCropDialog.getByRole("button", { name: "Process and upload" }).click();
      await merchantLogoUploaded;
      await expect(
        page.getByText(/Your merchant logo is saved\. Existing Wallet passes will refresh safely/u),
      ).toBeVisible();
      await page.goto(builderPath);
      await page
        .getByRole("button", { name: /^Appearance/u })
        .first()
        .click();
      await screenshot(page, "55-r4-merchant-brand-and-stamp-identity");

      const { createPrismaClient } = await import("../../packages/database/dist/src/client.js");
      const database = createPrismaClient(
        process.env.DATABASE_URL ??
          "postgresql://waflo:waflo_dev_password@localhost:5432/waflo?schema=public",
      );
      try {
        const storedOrganization = await database.organization.findUniqueOrThrow({
          where: { id: round4OrganizationId as string },
        });
        expect(storedOrganization.brandLogoAssetId).toBeTruthy();
        expect(storedOrganization.brandLogoAssetId).not.toBe(stampAsset.id);
        await database.merchantAsset.update({
          where: { id: stampAsset.id },
          data: { archivedAt: new Date(), processingStatus: "ARCHIVED" },
        });
        const restoredStamp = await uploadStampToPicker(false);
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
        await expect(studioNavigation.getByRole("button", { name: /^Test/u })).toHaveCount(0);

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
          .getByRole("button", { name: /^(?:Review & launch|Launch)/u })
          .click();
        await expect(page.getByText("Launch unavailable", { exact: true })).toBeVisible();
        await expect(
          page.getByText("This card is unavailable under the existing suspension rule.").first(),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "Launch loyalty card" })).toHaveCount(0);
        await screenshot(page, "60-r5-suspended-publication-blocked");
        await database.loyaltyProgram.update({
          where: { id: storedProgram.id },
          data: { status: "VALIDATED" },
        });
        await page.getByRole("button", { name: /^Loyalty cards$/iu }).click();
        await page
          .locator(".program-list__card")
          .filter({ hasText: updatedProgramName })
          .getByRole("button", { name: "Open card" })
          .click();
        await page
          .getByRole("navigation", { name: "Studio sections" })
          .getByRole("button", { name: /^(?:Review & launch|Launch)/u })
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
