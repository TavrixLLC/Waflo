import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

const reviewDirectory = path.resolve(
  process.env.WAFLO_REVIEW_DIRECTORY ?? path.join("artifacts", "merchant-design-review"),
);
const seedPassword = "Waflo-Development-2026";
const mapboxReviewConfigured = /^pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim() ?? "",
);

test.use({ trace: "off", video: "off" });

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
}

async function capture(page: Page, name: string, fullPage = false): Promise<void> {
  await mkdir(reviewDirectory, { recursive: true });
  await settle(page);
  await page.screenshot({
    path: path.join(reviewDirectory, name),
    fullPage,
    animations: "disabled",
    caret: "hide",
  });
}

async function captureElement(page: Page, selector: string, name: string): Promise<void> {
  await settle(page);
  const element = page.locator(selector).first();
  await expect(element).toBeVisible();
  await element.screenshot({
    path: path.join(reviewDirectory, name),
    animations: "disabled",
    caret: "hide",
  });
}

async function loginSeedOwner(page: Page): Promise<void> {
  await page.goto("/en/login");
  await page.locator('input[name="email"]').fill("owner@waflo.local");
  await page.locator('input[name="password"]').fill(seedPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/dashboard(?:\/|$)/);
}

async function selectReviewOrganization(page: Page): Promise<void> {
  const trigger = page.getByRole("button", { name: "Choose organization" });
  if ((await trigger.textContent())?.includes("Today Coffee")) return;
  await trigger.click();
  await page.getByRole("option", { name: "Today Coffee", exact: true }).click();
  await expect(trigger).toContainText("Today Coffee");
}

async function openDashboard(page: Page, locale: "en" | "ar", section = ""): Promise<void> {
  await page.goto(`/${locale}/dashboard${section ? `/${section}` : ""}`);
  await expect(page.locator("main h1").first()).toBeVisible();
  await expect(page.locator(".dashboard-route-loading")).toHaveCount(0);
}

async function waitForMapbox(dialog: ReturnType<Page["getByRole"]>): Promise<void> {
  const picker = dialog.locator(".location-picker");
  await expect(picker).toHaveAttribute("data-mapbox-token-status", "SET");
  await expect(dialog.locator(".mapboxgl-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(dialog.locator(".mapboxgl-ctrl-logo")).toBeVisible();
  await expect(dialog.locator(".mapboxgl-ctrl-attrib")).toHaveCount(1);
}

async function selectMapboxSearchResult(
  dialog: ReturnType<Page["getByRole"]>,
  locale: "en" | "ar",
  query: string,
): Promise<void> {
  const search = dialog.getByRole("combobox", {
    name: locale === "ar" ? "البحث عن موقع الفرع" : "Search for the branch location",
  });
  await search.fill(query);
  const firstResult = dialog.getByRole("option").first();
  await expect(firstResult).toBeVisible({ timeout: 20_000 });
  await firstResult.click();
  await expect(dialog.locator(".location-map-marker")).toBeVisible({ timeout: 20_000 });
  await expect(dialog.locator(".location-picker__selection")).toBeVisible();
  await expect(dialog.locator(".location-picker__selection small")).not.toContainText("· —");
}

async function csrfToken(page: Page): Promise<string> {
  const response = await page.request.get("http://localhost:4000/v1/auth/csrf");
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: { csrfToken: string } }).data.csrfToken;
}

async function latestVerificationUrl(page: Page, email: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const response = await page.request.get("http://localhost:8025/api/v1/messages");
    const body = (await response.json()) as {
      messages: Array<{
        ID: string;
        Subject: string;
        To: Array<{ Address: string }>;
        Created: string;
      }>;
    };
    const message = body.messages
      .filter(
        (item) =>
          item.Subject.includes("Verify your Waflo email") &&
          item.To.some((recipient) => recipient.Address === email),
      )
      .sort((left, right) => right.Created.localeCompare(left.Created))[0];
    if (message) {
      const detail = (await (
        await page.request.get(`http://localhost:8025/api/v1/message/${message.ID}`)
      ).json()) as { HTML?: string; Text?: string };
      const action = `${detail.HTML ?? ""}\n${detail.Text ?? ""}`.match(/https?:\/\/[^"' <]+/)?.[0];
      if (action) return action.replaceAll("&amp;", "&");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Verification message was not received.");
}

async function createReviewOrganization(page: Page, id: string): Promise<string> {
  const csrf = await csrfToken(page);
  const response = await page.request.post("http://localhost:4000/v1/organizations", {
    headers: { origin: "http://localhost:3001", "x-csrf-token": csrf },
    data: {
      name: "Cedar Coffee",
      merchantSlug: `cedar-${id}`,
      businessCategory: "Cafe",
      defaultLocale: "en",
      timezone: "Asia/Baghdad",
      selectedPlan: "starter",
      commandId: randomUUID(),
      firstLocation: {
        name: "Main branch",
        addressLine1: "Al Karrada, Baghdad, Iraq",
        city: "Baghdad",
        countryCode: "IQ",
        timezone: "Asia/Baghdad",
        latitude: 33.3152,
        longitude: 44.3661,
        coordinatesConfirmed: true,
      },
    },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

async function installBillingFixture(
  page: Page,
  options: {
    plan?: "STARTER" | "GROWTH" | "SCALE";
    cadence?: "monthly" | "quarterly" | "yearly";
    nextExpectedAmount?: number | null;
    paymentMethodAvailable?: boolean;
  } = {},
): Promise<void> {
  const plan = options.plan ?? "GROWTH";
  const cadence = options.cadence ?? "quarterly";
  const nextExpectedAmount =
    options.nextExpectedAmount === undefined ? 18_975 : options.nextExpectedAmount;
  const paymentMethodAvailable = options.paymentMethodAvailable ?? true;
  await page.route("**/v1/organizations/*/billing", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          selectedPlan: plan,
          canManageBilling: true,
          selectedCadence: cadence,
          profile: {
            subscriptionStatus: "ACTIVE",
            trialStart: "2026-07-01T09:00:00.000Z",
            trialEnd: "2026-07-08T09:00:00.000Z",
          },
          customerPortalAvailable: false,
          subscriptions: [
            {
              id: "review-subscription",
              status: "ACTIVE",
              planCode: plan,
              cadence: cadence.toLocaleUpperCase("en-US"),
              currentPeriodEnd: "2026-10-01T09:00:00.000Z",
              cancelAtPeriodEnd: false,
              createdAt: "2026-07-01T09:00:00.000Z",
            },
          ],
          stripeConfigured: false,
          cadenceAvailability: { monthly: true, quarterly: true, yearly: true },
          paymentMethod: paymentMethodAvailable
            ? {
                status: "saved",
                brand: "visa",
                last4: "4242",
                expMonth: 8,
                expYear: 2029,
                isDefault: true,
              }
            : { status: "unavailable" },
          billingIdentity: {
            name: "Cedar Coffee",
            email: "billing@cedar.example",
            countryCode: "IQ",
            addressLine1: "Al Karrada",
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
            trialEnd: "2026-07-08T09:00:00.000Z",
            renewalDate: "2026-10-01T09:00:00.000Z",
            nextExpectedChargeDate: "2026-10-01T09:00:00.000Z",
            nextExpectedAmount,
            currency: "USD",
            latestPaymentStatus: "paid",
            gracePeriodEnd: null,
            outstandingInvoice: null,
          },
          invoices: [
            {
              id: "review-invoice",
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
              hostedInvoiceUrl: "https://example.com/invoice",
              invoicePdfUrl: "https://example.com/invoice.pdf",
              refundable: true,
              amountRefunded: 0,
              remainingRefundableAmount: 19251,
              paymentMethod: { brand: "visa", last4: "4242", expMonth: 8, expYear: 2029 },
              refunds: [],
            },
          ],
          downgradeOptions: [],
        },
        requestId: "design-review-billing",
      }),
    });
  });
}

test("keeps Arabic Billing values aligned to the logical start edge without breaking mixed bidi", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginSeedOwner(page);
  await installBillingFixture(page, {
    plan: "SCALE",
    cadence: "monthly",
    nextExpectedAmount: null,
    paymentMethodAvailable: false,
  });

  await openDashboard(page, "ar", "billing");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  for (const summary of ["next-renewal", "current-catalog-rate"] as const) {
    const cell = page.locator(`[data-billing-summary="${summary}"]`);
    const label = cell.locator("dt");
    const value = cell.locator("dd").first();
    const [labelBox, valueBox] = await Promise.all([label.boundingBox(), value.boundingBox()]);
    expect(labelBox).not.toBeNull();
    expect(valueBox).not.toBeNull();
    expect(Math.abs((labelBox?.x ?? 0) - (valueBox?.x ?? 0))).toBeLessThanOrEqual(2);
    await expect(value).toHaveCSS("text-align", "start");
  }

  const nextRenewal = page.locator('[data-billing-summary="next-renewal"] dd').first();
  const catalogRate = page.locator('[data-billing-summary="current-catalog-rate"] dd').first();
  await expect(nextRenewal).toHaveText("غير متوفر");
  await expect(nextRenewal).toHaveCSS("direction", "rtl");
  await expect(catalogRate.locator("bdi")).toHaveText("$129.00");
  await expect(catalogRate).toContainText("/شهر");
  await expect(catalogRate.locator("bdi")).toHaveAttribute("dir", "ltr");

  const paymentMethod = page.locator(".billing-overview__facts > div").filter({
    has: page.getByText("طريقة الدفع", { exact: true }),
  });
  await expect(paymentMethod.locator("dd").first()).toHaveText("غير متاحة");
  await expect(paymentMethod.locator("dd").first()).toHaveCSS("direction", "rtl");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);

  await openDashboard(page, "en", "billing");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator('[data-billing-summary="next-renewal"] dd').first()).toHaveText(
    "Not available",
  );
  await expect(page.locator('[data-billing-summary="current-catalog-rate"] dd bdi')).toHaveText(
    "$129.00",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
});

async function installSecurityFixture(page: Page): Promise<void> {
  await page.route("**/v1/auth/sessions", async (route) => {
    const now = "2026-08-13T19:30:00.000Z";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "review-current-session",
            deviceLabel: "Chrome on Windows",
            createdAt: "2026-08-13T18:00:00.000Z",
            lastActiveAt: now,
            expiresAt: "2026-09-12T18:00:00.000Z",
            current: true,
          },
          {
            id: "review-phone-session",
            deviceLabel: "Safari on iPhone",
            createdAt: "2026-08-12T10:00:00.000Z",
            lastActiveAt: "2026-08-13T17:15:00.000Z",
            expiresAt: "2026-09-11T10:00:00.000Z",
            current: false,
          },
          {
            id: "review-tablet-session",
            deviceLabel: "Chrome on Android tablet",
            createdAt: "2026-08-11T09:00:00.000Z",
            lastActiveAt: "2026-08-12T20:05:00.000Z",
            expiresAt: "2026-09-10T09:00:00.000Z",
            current: false,
          },
        ],
        requestId: "design-review-sessions",
      }),
    });
  });
}

test("captures recipient-filtered Mailpit verification evidence", async ({ page }) => {
  const evidenceId = randomUUID().slice(0, 8);
  const evidenceEmail = `design-review-${evidenceId}@waflo.local`;
  await page.goto("/en/signup");
  await page.locator('input[name="displayName"]').fill("Mail delivery evidence");
  await page.locator('input[name="email"]').fill(evidenceEmail);
  await page.locator('input[name="password"]').fill("Mail evidence password 2026!");
  await page.locator('input[name="confirmPassword"]').fill("Mail evidence password 2026!");
  await page.locator('input[name="terms"]').check();
  await page.locator('input[name="privacy"]').check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const response = await page.request.get("http://localhost:8025/api/v1/messages");
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    messages: Array<{
      Subject: string;
      To: Array<{ Address: string }>;
      Created: string;
    }>;
  };
  const verificationRecipients = body.messages
    .filter((message) => message.Subject === "Verify your Waflo email")
    .flatMap((message) =>
      message.To.map((address) => ({ address: address.Address, created: message.Created })),
    )
    .filter((item) => /^design-review-[a-z0-9-]+@waflo\.local$/u.test(item.address));
  const recipientCounts = new Map<string, { count: number; latest: string }>();
  for (const item of verificationRecipients) {
    const current = recipientCounts.get(item.address);
    recipientCounts.set(item.address, {
      count: (current?.count ?? 0) + 1,
      latest: current && current.latest > item.created ? current.latest : item.created,
    });
  }
  const capturedRecipient = [...recipientCounts.entries()].sort(
    ([, left], [, right]) => right.count - left.count || right.latest.localeCompare(left.latest),
  )[0];
  const recipient = capturedRecipient?.[0];
  expect(recipient).toBeTruthy();
  expect(capturedRecipient?.[1].count).toBeGreaterThanOrEqual(1);

  await page.goto("http://localhost:8025");
  const mailboxSearch = page.getByPlaceholder("Search mailbox");
  await mailboxSearch.fill(recipient ?? "no-test-recipient");
  await mailboxSearch.press("Enter");
  await expect(page.getByText(recipient ?? "no-test-recipient").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("@gmail.com");
  await expect(page.locator("body")).not.toContainText("token=");
  await expect(page.getByText("Verify your Waflo email").first()).toBeVisible();
  await capture(page, "mailpit-verification-captured.png");
});

test("captures public, authentication, and marketing review states", async ({ page }) => {
  test.setTimeout(120_000);
  await mkdir(reviewDirectory, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/v1/auth/external/providers", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { googleSignInAvailable: true },
        requestId: "design-review-google-capability",
      }),
    });
  });

  await page.goto("/en/signup");
  await expect(page.getByRole("heading", { name: "Create your merchant account" })).toBeVisible();
  await capture(page, "28-signup-account.png");
  await capture(page, "signup-desktop-en.png");
  await page.locator('input[name="terms"]').check();
  await page.locator('input[name="privacy"]').check();
  await capture(page, "29-signup-legal-consent.png");
  await capture(page, "37-signup-google-consent.png");

  await page.goto("/en/login");
  await expect(page.getByRole("link", { name: /Google/ })).toBeVisible();
  await capture(page, "35-login-google-existing-user.png");
  await page.goto("/ar/login");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await capture(page, "login-desktop-ar.png");
  await page.goto("/en/oauth/callback?result=no_account");
  await expect(page.getByText("No Waflo account found")).toBeVisible();
  await capture(page, "36-login-google-no-account-error.png");

  await page.goto("http://localhost:3000/en");
  await expect(page.locator("h1")).toBeVisible();
  await capture(page, "48-marketing-home-desktop-en.png", true);
  await captureElement(page, ".landing-hero-demo", "marketing-loyalty-preview.png");
  await page.goto("http://localhost:3000/ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await capture(page, "49-marketing-home-desktop-ar.png", true);
  await page.goto("http://localhost:3000/en/pricing");
  await expect(page.getByRole("heading", { name: /Pricing without hidden math/i })).toBeVisible();
  await capture(page, "marketing-pricing-desktop-en.png", true);
  await page.goto("http://localhost:3000/ar/pricing");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await capture(page, "marketing-pricing-desktop-ar.png", true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:3000/en");
  await capture(page, "50-marketing-home-mobile-en.png", true);
  await page.goto("http://localhost:3000/ar");
  await capture(page, "51-marketing-home-mobile-ar.png", true);
  await page.goto("http://localhost:3000/en/pricing");
  await capture(page, "marketing-pricing-mobile-en.png", true);
  await page.goto("http://localhost:3000/ar/pricing");
  await capture(page, "marketing-pricing-mobile-ar.png", true);
  await page.goto("/en/signup");
  await capture(page, "signup-mobile-en.png", true);
  await page.goto("/ar/signup");
  await capture(page, "signup-mobile-ar.png", true);

  for (const width of [360, 430] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://localhost:3000/en");
    await capture(page, `marketing-home-mobile-${width}-en.png`, true);
    await page.goto("/en/signup");
    await capture(page, `signup-mobile-${width}-en.png`, true);
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://localhost:3000/en");
  const badge = page.getByRole("img", { name: "Get it on Google Play" });
  await expect(badge).toBeVisible();
  await badge.screenshot({ path: path.join(reviewDirectory, "52-google-play-badge.png") });
});

test("captures Merchant dashboards, responsive views, and component states", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginSeedOwner(page);
  await selectReviewOrganization(page);
  await installBillingFixture(page);
  await installSecurityFixture(page);
  await page.route("**/v1/organizations/*/exports?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { items: [] }, requestId: "design-review-exports" }),
    });
  });

  const desktopEnglish = [
    ["", "01-overview-desktop-en.png"],
    ["programs", "02-loyalty-cards-desktop-en.png"],
    ["customers", "03-customers-desktop-en.png"],
    ["locations", "04-locations-desktop-en.png"],
    ["team", "05-team-desktop-en.png"],
    ["analytics", "06-analytics-desktop-en.png"],
    ["exports", "07-exports-desktop-en.png"],
    ["billing", "08-billing-desktop-en.png"],
    ["settings", "09-settings-desktop-en.png"],
    ["security", "10-security-desktop-en.png"],
  ] as const;
  for (const [section, filename] of desktopEnglish) {
    await openDashboard(page, "en", section);
    await capture(page, filename);
    if (section === "billing") await capture(page, "billing-desktop-active.png");
  }

  const desktopArabic = [
    ["", "11-overview-desktop-ar.png"],
    ["programs", "12-loyalty-cards-desktop-ar.png"],
    ["customers", "13-customers-desktop-ar.png"],
    ["locations", "locations-desktop-ar.png"],
    ["team", "14-team-desktop-ar.png"],
    ["analytics", "analytics-desktop-ar.png"],
    ["exports", "exports-desktop-ar.png"],
    ["billing", "15-billing-desktop-ar.png"],
    ["settings", "16-settings-desktop-ar.png"],
    ["security", "17-security-desktop-ar.png"],
  ] as const;
  for (const [section, filename] of desktopArabic) {
    await openDashboard(page, "ar", section);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await capture(page, filename);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileEnglish = [
    ["", "18-overview-mobile-en.png"],
    ["programs", "19-loyalty-cards-mobile-en.png"],
    ["customers", "20-customers-mobile-en.png"],
    ["locations", "locations-mobile-en.png"],
    ["team", "21-team-mobile-en.png"],
    ["analytics", "analytics-mobile-en.png"],
    ["exports", "exports-mobile-en.png"],
    ["billing", "22-billing-mobile-en.png"],
    ["settings", "23-settings-mobile-en.png"],
    ["security", "24-security-mobile-en.png"],
  ] as const;
  for (const [section, filename] of mobileEnglish) {
    await openDashboard(page, "en", section);
    await capture(page, filename);
  }
  for (const [section, filename] of [
    ["", "25-overview-mobile-ar.png"],
    ["programs", "loyalty-cards-mobile-ar.png"],
    ["customers", "customers-mobile-ar.png"],
    ["locations", "locations-mobile-ar.png"],
    ["team", "26-team-mobile-ar.png"],
    ["analytics", "analytics-mobile-ar.png"],
    ["exports", "exports-mobile-ar.png"],
    ["billing", "27-billing-mobile-ar.png"],
    ["settings", "settings-mobile-ar.png"],
    ["security", "security-mobile-ar.png"],
  ] as const) {
    await openDashboard(page, "ar", section);
    await capture(page, filename);
  }

  for (const width of [360, 430] as const) {
    await page.setViewportSize({ width, height: 900 });
    await openDashboard(page, "en");
    await capture(page, `overview-mobile-${width}-en.png`);
    await openDashboard(page, "ar");
    await capture(page, `overview-mobile-${width}-ar.png`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page, "en");
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
  await capture(page, "47-mobile-navigation.png");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await openDashboard(page, "en", "team");
  await page.getByRole("button", { name: "Add staff" }).click();
  const staffDialog = page.getByRole("dialog", { name: "Add staff member" });
  await staffDialog.locator('input[name="name"]').fill("Layla Hassan");
  await capture(page, "38-add-staff-dialog.png");
  await staffDialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Pair phone" }).first().click();
  const pairingDialog = page.getByRole("dialog", { name: "Pair staff device" });
  await pairingDialog.getByRole("button", { name: "Generate QR" }).click();
  await expect(pairingDialog.getByText("This is the only valid code")).toBeVisible();
  await expect
    .poll(() => pairingDialog.locator("img").evaluate((image) => image.naturalWidth))
    .toBeGreaterThan(0);
  await capture(page, "39-staff-qr-state.png");
  await pairingDialog.getByRole("button", { name: "Done" }).click();

  await openDashboard(page, "en", "billing");
  await captureElement(page, ".dashboard-section-grid--plans", "40-plan-comparison.png");
  await captureElement(page, ".dashboard-metric-grid--billing", "41-payment-method.png");
  await captureElement(page, ".billing-invoice-history", "42-invoice-history.png");
  await page.getByRole("button", { name: "Request refund for invoice WF-2026-0042" }).click();
  await expect(page.getByRole("dialog", { name: "Request a refund review" })).toBeVisible();
  await capture(page, "43-refund-action.png");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  await openDashboard(page, "en", "settings");
  const timezone = page.getByRole("combobox", { name: "Timezone" });
  await timezone.fill("Baghdad");
  await expect(page.getByRole("listbox")).toBeVisible();
  await capture(page, "45-timezone-dropdown-open.png");

  await openDashboard(page, "en", "exports");
  await expect(page.getByRole("heading", { name: "No export jobs" })).toBeVisible();
  await capture(page, "46-empty-state.png");
});

test("captures live Mapbox location review states when configured", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginSeedOwner(page);
  await selectReviewOrganization(page);
  await openDashboard(page, "en", "locations");
  await page.getByRole("button", { name: "Add location" }).click();
  let dialog = page.getByRole("dialog", { name: "Add location" });

  if (!mapboxReviewConfigured) {
    await expect(dialog.locator(".location-picker")).toHaveAttribute(
      "data-mapbox-token-status",
      /^(?:UNSET|INVALID_FORMAT)$/u,
    );
    await expect(dialog.getByText("The map is unavailable right now")).toBeVisible();
    await capture(page, "location-mapbox-token-unset.png");
    return;
  }

  await waitForMapbox(dialog);
  const canvas = dialog.locator(".mapboxgl-canvas");
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 33.3152, longitude: 44.3661 });
  const currentLocationButton = dialog.getByRole("button", { name: "Use my current location" });
  await expect(currentLocationButton).toBeEnabled();
  await currentLocationButton.click();
  await expect(dialog.locator(".location-picker__selection small")).toContainText(
    "33.315200, 44.366100",
  );

  await canvas.click({ position: { x: 420, y: 210 } });
  const clickedMarker = dialog.locator(".location-map-marker");
  await expect(clickedMarker).toBeVisible({ timeout: 20_000 });
  await expect(clickedMarker).toHaveCSS("position", "absolute");
  const canvasAfterClick = await canvas.boundingBox();
  const markerAfterClick = await clickedMarker.boundingBox();
  expect(canvasAfterClick).not.toBeNull();
  expect(markerAfterClick).not.toBeNull();
  expect(
    Math.abs(
      (markerAfterClick?.x ?? 0) +
        (markerAfterClick?.width ?? 0) / 2 -
        ((canvasAfterClick?.x ?? 0) + 420),
    ),
  ).toBeLessThan(8);
  expect(
    Math.abs(
      (markerAfterClick?.y ?? 0) +
        (markerAfterClick?.height ?? 0) -
        ((canvasAfterClick?.y ?? 0) + 210),
    ),
  ).toBeLessThan(8);
  await expect(dialog.locator(".location-picker__selection")).toBeVisible();

  const search = dialog.getByRole("combobox", { name: "Search for the branch location" });
  await search.fill("Baghdad International Airport");
  await expect(dialog.getByRole("option").first()).toBeVisible({ timeout: 20_000 });
  await capture(page, "mapbox-search-results-open.png");
  await dialog.getByRole("option").first().click();
  await expect(dialog.locator(".location-map-marker")).toBeVisible({ timeout: 20_000 });
  await expect(dialog.locator(".location-picker__selection small")).not.toContainText("· —");
  await capture(page, "location-add-map-desktop-en.png");

  const coordinate = dialog.locator(".location-picker__selection small");
  const coordinateBeforeDrag = await coordinate.textContent();
  const marker = dialog.locator(".location-map-marker");
  const markerBox = await marker.boundingBox();
  expect(markerBox).not.toBeNull();
  await page.mouse.move(
    (markerBox?.x ?? 0) + (markerBox?.width ?? 0) / 2,
    (markerBox?.y ?? 0) + (markerBox?.height ?? 0) / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    (markerBox?.x ?? 0) + (markerBox?.width ?? 0) / 2 + 24,
    (markerBox?.y ?? 0) + (markerBox?.height ?? 0) / 2 + 12,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect.poll(() => coordinate.textContent()).not.toBe(coordinateBeforeDrag);
  await dialog.getByRole("button", { name: "Confirm this location" }).click();
  await expect(dialog.getByText("Location confirmed")).toBeVisible();
  await capture(page, "location-map-pin-confirm-desktop-en.png");

  const reviewLocationName = `Mapbox review ${randomUUID().slice(0, 6)}`;
  await dialog.locator('input[name="name"]').fill(reviewLocationName);
  await dialog.getByRole("button", { name: "Add location", exact: true }).click();
  await expect(dialog).toBeHidden();
  const reviewLocationRow = page.getByRole("row").filter({ hasText: reviewLocationName });
  await expect(reviewLocationRow).toBeVisible();
  await capture(page, "location-list-desktop-en.png");
  await reviewLocationRow.getByRole("button", { name: "Edit" }).click();
  dialog = page.getByRole("dialog", { name: "Edit location" });
  await waitForMapbox(dialog);
  await expect(dialog.locator(".location-map-marker")).toBeVisible();
  await expect(dialog.getByText("Location confirmed")).toBeVisible();
  await capture(page, "location-edit-map-desktop-en.png");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await openDashboard(page, "ar", "locations");
  await page.getByRole("button", { name: "إضافة موقع" }).click();
  dialog = page.getByRole("dialog", { name: "إضافة موقع" });
  await waitForMapbox(dialog);
  await expect(dialog.getByRole("button", { name: "استخدام موقعي الحالي" })).toBeVisible();
  await expect(dialog.locator(".mapboxgl-ctrl-bottom-left .mapboxgl-ctrl-zoom-in")).toBeVisible();
  await selectMapboxSearchResult(dialog, "ar", "مطار بغداد الدولي");
  await capture(page, "location-add-map-desktop-ar.png");
  await dialog.getByRole("button", { name: "تأكيد هذا الموقع" }).click();
  await expect(dialog.getByText("تم تأكيد الموقع")).toBeVisible();
  await capture(page, "location-map-pin-confirm-desktop-ar.png");
  await dialog.getByRole("button", { name: "إلغاء" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page, "en", "locations");
  await page.getByRole("button", { name: "Add location" }).click();
  dialog = page.getByRole("dialog", { name: "Add location" });
  await waitForMapbox(dialog);
  await selectMapboxSearchResult(dialog, "en", "Baghdad International Airport");
  await capture(page, "location-add-map-mobile-en.png");
  await dialog.getByRole("button", { name: "Confirm this location" }).click();
  await expect(dialog.getByText("Location confirmed")).toBeVisible();
  await capture(page, "location-map-pin-confirm-mobile-en.png");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await openDashboard(page, "ar", "locations");
  await page.getByRole("button", { name: "إضافة موقع" }).click();
  dialog = page.getByRole("dialog", { name: "إضافة موقع" });
  await waitForMapbox(dialog);
  await selectMapboxSearchResult(dialog, "ar", "مطار بغداد الدولي");
  await capture(page, "location-add-map-mobile-ar.png");
  await dialog.getByRole("button", { name: "إلغاء" }).click();
});

test("captures plan, billing identity, country search, and completion visuals", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const id = randomUUID().slice(0, 8);
  const email = `design-review-${id}@waflo.local`;
  const password = "Design Review Waflo 2026!";

  await page.goto("/en/signup");
  await page.locator('input[name="displayName"]').fill("Cedar Coffee Owner");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirmPassword"]').fill(password);
  await page.locator('input[name="terms"]').check();
  await page.locator('input[name="privacy"]').check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const initialAction = new URL(await latestVerificationUrl(page, email));
  const resend = page.getByRole("button", { name: "Resend verification email" });
  await resend.click();
  const englishStatus = page.getByRole("status").filter({ hasText: "If the address is eligible" });
  await expect(englishStatus).toContainText(
    "If the address is eligible, the verification request was accepted.",
  );
  await resend.focus();
  await expect(resend).toBeFocused();
  const englishAlertBox = await englishStatus.boundingBox();
  const englishButtonBox = await resend.boundingBox();
  expect(englishAlertBox).not.toBeNull();
  expect(englishButtonBox).not.toBeNull();
  expect(
    (englishButtonBox?.y ?? 0) - ((englishAlertBox?.y ?? 0) + (englishAlertBox?.height ?? 0)),
  ).toBeGreaterThanOrEqual(20);
  await capture(page, "verify-email-desktop-en.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "verify-email-mobile-en.png", true);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/ar/verify-email");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const arabicResend = page.getByRole("button", { name: "إعادة إرسال الرسالة" });
  await arabicResend.click();
  const arabicStatus = page.getByRole("status").filter({ hasText: "إذا كان العنوان" });
  await expect(arabicStatus).toContainText(
    "إذا كان العنوان مؤهلاً، فقد قُبل طلب إرسال رسالة تأكيد جديدة.",
  );
  expect(
    await page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily),
  ).toContain("Cairo");
  expect(await page.locator("body").innerText()).not.toMatch(/[٠-٩۰-۹]/u);
  await capture(page, "verify-email-desktop-ar.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "verify-email-mobile-ar.png", true);

  const csrf = await csrfToken(page);
  const mutationHeaders = { origin: "http://localhost:3001", "x-csrf-token": csrf };
  const thirdResend = await page.request.post("http://localhost:4000/v1/auth/resend-verification", {
    headers: mutationHeaders,
    data: { email },
  });
  expect(thirdResend.ok()).toBe(true);
  const limitedResend = await page.request.post(
    "http://localhost:4000/v1/auth/resend-verification",
    { headers: mutationHeaders, data: { email } },
  );
  expect(limitedResend.status()).toBe(429);
  expect(((await limitedResend.json()) as { error: { code: string } }).error.code).toBe(
    "RATE_LIMITED",
  );

  const initialToken = decodeURIComponent(initialAction.hash.slice("#token=".length));
  const previousToken = await page.request.post("http://localhost:4000/v1/auth/verify-email", {
    headers: mutationHeaders,
    data: { token: initialToken },
  });
  expect(previousToken.status()).toBe(410);
  const invalidToken = await page.request.post("http://localhost:4000/v1/auth/verify-email", {
    headers: mutationHeaders,
    data: { token: "invalid-verification-token-000000000000000000000000" },
  });
  expect(invalidToken.status()).toBe(410);

  await page.goto("http://localhost:8025");
  const mailboxSearch = page.getByPlaceholder("Search mailbox");
  await mailboxSearch.fill(email);
  await mailboxSearch.press("Enter");
  await expect(page.getByText(email).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("@gmail.com");
  await expect(page.getByText("Verify your Waflo email").first()).toBeVisible();
  await capture(page, "mailpit-verification-captured.png");

  const action = new URL(await latestVerificationUrl(page, email));
  action.searchParams.set("review", "visual");
  await page.goto(action.toString());
  await expect(page.getByText("Email verified", { exact: true })).toBeVisible();
  const verifiedToken = decodeURIComponent(action.hash.slice("#token=".length));
  const replay = await page.request.post("http://localhost:4000/v1/auth/verify-email", {
    headers: mutationHeaders,
    data: { token: verifiedToken },
  });
  expect(replay.status()).toBe(410);
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await page.waitForLoadState("networkidle");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/onboarding\/business/);
  await capture(page, "onboarding-business-mobile.png", true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await capture(page, "onboarding-business.png", true);

  const organizationId = await createReviewOrganization(page, id);
  await page.goto(`/en/onboarding/business?organization=${organizationId}`);
  await expect(page.getByRole("heading", { name: "Choose your plan" })).toBeVisible();
  await capture(page, "30-signup-plan-cadence.png");
  await capture(page, "40-plan-comparison-onboarding.png");
  await page.goto(`/ar/onboarding/business?organization=${organizationId}`);
  await expect(page.getByRole("heading", { name: "اختر الباقة المناسبة" })).toBeVisible();
  await capture(page, "onboarding-plan-desktop-ar.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "onboarding-plan-mobile-ar.png", true);
  await page.goto(`/en/onboarding/business?organization=${organizationId}`);
  await expect(page.getByRole("heading", { name: "Choose your plan" })).toBeVisible();
  await capture(page, "onboarding-plan-mobile-en.png", true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/en/onboarding/business?organization=${organizationId}`);
  await expect(page.getByRole("heading", { name: "Choose your plan" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Billing details" })).toBeVisible();
  await page.locator('input[name="billingName"]').fill("Cedar Coffee");
  await page.locator('input[name="billingEmail"]').fill(email);
  await page.locator('input[name="addressLine1"]').fill("Al Karrada");
  await page.locator('input[name="billingCity"]').fill("Baghdad");
  await capture(page, "31-signup-billing-details.png");

  const country = page.getByRole("combobox", { name: "Billing country" });
  await country.fill("Iraq");
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(page.getByRole("option", { name: /Iraq/i })).toHaveCount(1);
  await expect(page.getByRole("option", { name: /Afghanistan/i })).toHaveCount(0);
  await capture(page, "44-country-dropdown-open.png");
  await country.press("Enter");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByText(/billing setup is not configured right now/i)).toBeVisible();
  await capture(page, "32-signup-payment-element-BLOCKED.png");

  await page.evaluate(() => {
    window.sessionStorage.setItem(
      "waflo:onboarding-trial-result",
      JSON.stringify({
        status: "trialing",
        trialStart: "2026-08-13T09:00:00.000Z",
        trialEnd: "2026-08-20T09:00:00.000Z",
        firstChargeAt: "2026-08-20T09:00:00.000Z",
        amount: 2900,
        currency: "USD",
        initialInvoiceAmount: 0,
        paymentMethod: { brand: "visa", last4: "4242", expMonth: 8, expYear: 2029 },
      }),
    );
  });
  await page.goto(`/en/onboarding/complete?organization=${organizationId}`);
  await expect(page.getByRole("heading", { name: "Your free trial has started" })).toBeVisible();
  await capture(page, "34-signup-success-trial.png");
});

test("captures product-integrity auth, entitlement, and publish recovery states", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.route("**/v1/auth/register", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "ACCOUNT_NOT_CREATED",
          message:
            "We couldn't create a new account with this email. If you've used Waflo before, sign in or reset your password.",
        },
        requestId: "product-integrity-duplicate",
      }),
    });
  });
  await page.goto("/en/signup");
  await page.locator('input[name="displayName"]').fill("Existing Merchant");
  await page.locator('input[name="email"]').fill("existing@example.test");
  await page.locator('input[name="password"]').fill("Screenshot-only password 2026!");
  await page.locator('input[name="confirmPassword"]').fill("Screenshot-only password 2026!");
  await page.locator('input[name="terms"]').check();
  await page.locator('input[name="privacy"]').check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/We couldn't create a new account/)).toBeVisible();
  await capture(page, "signup-duplicate-email-en.png");
  await page.unroute("**/v1/auth/register");

  await page.goto("/en/verify-email");
  await page.evaluate(() => {
    sessionStorage.setItem("waflo:verification-email", "delivery-check@example.test");
    sessionStorage.removeItem("waflo:verification-delivery-accepted");
  });
  await page.route("**/v1/auth/resend-verification", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "EMAIL_DELIVERY_UNAVAILABLE",
          message: "We couldn't send the verification email. Try again.",
        },
        requestId: "product-integrity-mail-failure",
      }),
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "Resend verification email" }).click();
  await expect(
    page.getByRole("alert").filter({
      hasText: "We couldn't send the verification email. Try again.",
    }),
  ).toBeVisible();
  await capture(page, "verify-email-send-failure-en.png");
  await page.unroute("**/v1/auth/resend-verification");

  await page.route("**/v1/auth/login", async (route) => {
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "EMAIL_VERIFICATION_REQUIRED",
          message: "Verify your email before continuing.",
        },
        requestId: "product-integrity-unverified",
      }),
    });
  });
  await page.goto("/en/login");
  await page.locator('input[name="email"]').fill("pending@example.test");
  await page.locator('input[name="password"]').fill("Screenshot-only password 2026!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/verify-email$/u);
  await capture(page, "login-unverified-redirect.png");
  await page.unroute("**/v1/auth/login");

  await loginSeedOwner(page);
  await selectReviewOrganization(page);
  const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await page.goto(
    `/en/onboarding/business?organization=${organizationId}&resume=billing_identity_required`,
  );
  await expect(page.getByRole("heading", { name: "Billing details" })).toBeVisible();
  await capture(page, "login-onboarding-resume.png");

  const { createPrismaClient } = await import("../../packages/database/dist/src/client.js");
  const prisma = createPrismaClient();
  const originalBilling = await prisma.organizationBillingProfile.findUniqueOrThrow({
    where: { organizationId },
    select: { subscriptionStatus: true, gracePeriodEnd: true },
  });
  try {
    await page.goto("/en/dashboard/billing");
    await expect(page.locator("main h1").first()).toBeVisible();
    await expect(page.locator(".wf-skeleton")).toHaveCount(0);
    await capture(page, "billing-desktop-active.png");

    const program = await prisma.loyaltyProgram.findFirstOrThrow({
      where: { organizationId, status: "PUBLISHED" },
      select: { id: true },
    });
    await page.goto("/en/dashboard/programs/new");
    await expect(page.getByRole("heading", { name: "Choose a starting design" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Test/u })).toHaveCount(0);
    await capture(page, "loyalty-card-create-no-test-stage.png");

    await page.goto(`/en/dashboard/programs/${program.id}/launch`);
    await expect(page.getByText("Automated checks", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Run checks" })).toHaveCount(0);
    await capture(page, "loyalty-card-prepublish-validation.png");

    await prisma.organizationBillingProfile.update({
      where: { organizationId },
      data: {
        subscriptionStatus: "GRACE_PERIOD",
        gracePeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    await page.goto("/en/dashboard/billing?evidence=action-required");
    await expect(page.locator(".billing-attention-banner")).toBeVisible();
    await expect(page.locator(".wf-skeleton")).toHaveCount(0);
    await capture(page, "billing-action-required.png");

    await prisma.organizationBillingProfile.update({
      where: { organizationId },
      data: { subscriptionStatus: "PAST_DUE", gracePeriodEnd: new Date(Date.now() - 60_000) },
    });
    await page.goto("/en/dashboard?evidence=restricted");
    await expect(page.locator(".billing-attention-banner")).toBeVisible();
    await capture(page, "dashboard-billing-restricted-banner.png");

    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, "dashboard-billing-restricted-mobile.png", true);
    await page.goto("/en/dashboard/billing?evidence=recovery");
    await expect(page.locator(".billing-attention-banner")).toBeVisible();
    await expect(page.locator(".wf-skeleton")).toHaveCount(0);
    await capture(page, "billing-recovery-mobile.png", true);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/ar/dashboard/billing?evidence=restricted");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator(".billing-attention-banner")).toBeVisible();
    await expect(page.locator(".wf-skeleton")).toHaveCount(0);
    await capture(page, "billing-restricted-ar.png");
  } finally {
    await prisma.organizationBillingProfile.update({
      where: { organizationId },
      data: originalBilling,
    });
    await prisma.$disconnect();
  }
});
