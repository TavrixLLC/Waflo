import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, type Page, type APIRequestContext, test } from "@playwright/test";

const screenshots = "artifacts/screenshots";
const runId = randomUUID().slice(0, 8);
const ownerEmail = `browser-owner-${runId}@waflo.local`;
const staffEmail = `browser-staff-${runId}@waflo.local`;
const initialPassword = "Browser Waflo 2026!";
const changedPassword = "Browser Waflo Changed 2026!";
const initialSlug = `browser-${runId}`;
const changedSlug = `flow-${runId}`;

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
  await page.screenshot({
    path: `${screenshots}/${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
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
  await page.goto(verificationUrl);
  await expect(page.getByText("Email verified", { exact: true })).toBeVisible();
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/en/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/(?:dashboard(?:\/|$)|onboarding\/)/);
}

test.describe
  .serial("Waflo W1 browser flows", () => {
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
      const organizationId = new URL(page.url()).searchParams.get("organization");
      expect(organizationId).toBeTruthy();
      const organizationResponse = await page.request.get(
        `http://localhost:4000/v1/organizations/${organizationId}`,
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
      await staffPage.goto(invitationUrl);
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
      await page.reload();
      const roleSelect = page.getByRole("combobox", { name: "Role for Browser Staff" });
      await expect(roleSelect).toBeVisible();
      await roleSelect.selectOption("MANAGER");
      await expect(roleSelect).toHaveValue("MANAGER");
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
      await expect(
        page.getByRole("heading", { name: /loyalty experience is being prepared/i }),
      ).toBeVisible();
      await expect(page.getByText(`Browser Coffee ${runId}`, { exact: true })).toBeVisible();
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
        await expect(
          page.getByRole("heading", { name: "This page is temporarily unavailable" }),
        ).toBeVisible();
        await expect(page.getByText(`Browser Coffee ${runId}`, { exact: true })).toHaveCount(0);
        await database.organization.update({
          where: { merchantSlug: changedSlug },
          data: { status: "ACTIVE" },
        });
      } finally {
        await database.$disconnect();
      }

      await page.goto(`http://localhost:3002/?tenant=unknown-${runId}`);
      await expect(
        page.getByRole("heading", { name: "We could not find this merchant" }),
      ).toBeVisible();
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

    test("blocks unauthenticated dashboard access", async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto("http://localhost:3001/en/dashboard");
      await expect(page).toHaveURL(/\/en\/session-expired/);
      await expect(page.getByText("Your session expired")).toBeVisible();
      await context.close();
    });
  });
