import { mkdir } from "node:fs/promises";
import { expect, type Page, type Route, test } from "@playwright/test";
import { templateGalleryOrganizationId, mockTemplateGalleryApi } from "./template-gallery-fixtures";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: a manual local browser run chooses its evidence destination.
const stagingRepairEvidenceDirectory = process.env.WAFLO_STAGING_REPAIR_EVIDENCE_DIR;

async function captureStagingRepairEvidence(page: Page, filename: string): Promise<void> {
  if (!stagingRepairEvidenceDirectory) return;
  await mkdir(stagingRepairEvidenceDirectory, { recursive: true });
  await page.screenshot({
    path: `${stagingRepairEvidenceDirectory}/${filename}`,
    animations: "disabled",
  });
}

async function fulfill(
  route: Route,
  data: unknown,
  requestId = "staging-repair-browser",
): Promise<void> {
  const origin = route.request().headers().origin ?? "http://localhost:3001";
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
    },
    body: JSON.stringify({ data, requestId }),
  });
}

async function reject(route: Route, code: string, backendMessage: string): Promise<void> {
  const origin = route.request().headers().origin ?? "http://localhost:3001";
  await route.fulfill({
    status: 401,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
    },
    body: JSON.stringify({
      error: { code, message: backendMessage, requestId: "staging-repair-security" },
    }),
  });
}

function billingFixture(downgradeOptions: Array<Record<string, unknown>>) {
  return {
    selectedPlan: "GROWTH",
    canManageBilling: true,
    selectedCadence: "quarterly",
    profile: {
      subscriptionStatus: "ACTIVE",
      trialStart: "2026-07-01T09:00:00.000Z",
      trialEnd: "2026-07-15T09:00:00.000Z",
    },
    customerPortalAvailable: false,
    subscriptions: [
      {
        id: "staging-repair-subscription",
        status: "ACTIVE",
        planCode: "GROWTH",
        cadence: "QUARTERLY",
        currentPeriodEnd: "2026-10-01T09:00:00.000Z",
        cancelAtPeriodEnd: false,
        createdAt: "2026-07-01T09:00:00.000Z",
      },
    ],
    stripeConfigured: false,
    cadenceAvailability: { monthly: true, quarterly: true, yearly: true },
    catalog: {
      marketCode: "GLOBAL",
      terms: [
        { plan: "STARTER", cadence: "monthly", amountMinor: "2900", currency: "USD" },
        { plan: "GROWTH", cadence: "quarterly", amountMinor: "18975", currency: "USD" },
        { plan: "SCALE", cadence: "yearly", amountMinor: "129000", currency: "USD" },
      ],
    },
    paymentMethod: {
      status: "saved",
      brand: "visa",
      last4: "4242",
      expMonth: 8,
      expYear: 2029,
      isDefault: true,
    },
    billingIdentity: {
      name: "Gallery Coffee",
      email: "billing@gallery.example.test",
      countryCode: "IQ",
      addressLine1: "Al Karrada",
      addressLine2: null,
      city: "Baghdad",
      region: "Baghdad",
      postalCode: "10001",
      locale: "ar",
      timezone: "Asia/Baghdad",
      syncedAt: "2026-08-12T10:00:00.000Z",
    },
    authoritativeState: {
      subscriptionStatus: "ACTIVE",
      trialStart: "2026-07-01T09:00:00.000Z",
      trialEnd: "2026-07-15T09:00:00.000Z",
      renewalDate: "2026-10-01T09:00:00.000Z",
      nextExpectedChargeDate: "2026-10-01T09:00:00.000Z",
      nextExpectedAmount: 18975,
      currency: "USD",
      latestPaymentStatus: "paid",
      gracePeriodEnd: null,
      outstandingInvoice: null,
    },
    invoices: [],
    downgradeOptions,
  };
}

async function installSettingsRoutes(page: Page): Promise<void> {
  await page.route("**/v1/auth/external/identities", (route) =>
    fulfill(route, { accountEmail: "gallery@example.test", passwordEnabled: true, identities: [] }),
  );
  await page.route("**/v1/auth/external/reauthentication", (route) =>
    fulfill(route, { status: "VERIFIED", expiresAt: "2026-09-08T12:00:00.000Z" }),
  );
}

async function openStudioLaunch(page: Page): Promise<void> {
  await page.goto("/en/dashboard/programs/new");
  await page
    .locator(".template-gallery__section--recommended .template-gallery-card__preview")
    .first()
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Use this template" }).click();
  const review = page.getByRole("button", { name: "Review card" });
  const continueToStudio = page.getByRole("button", { name: "Continue to Studio" });
  await expect(review.or(continueToStudio)).toBeVisible();
  if (await review.isVisible()) await review.click();
  await continueToStudio.click();
  await page
    .getByRole("navigation", { name: "Studio sections" })
    .getByRole("button", { name: /^Review & launch/u })
    .click();
  await expect(page.locator(".publication-wallet-list")).toBeVisible();
}

test("maps the Arabic billing downgrade violation from its stable code and retains usage facts", async ({
  page,
}) => {
  const rawBackendProse =
    "Archive loyalty cards until the active card count fits the target plan. Current: 7; allowed: 3.";
  const responseData = billingFixture([
    {
      plan: "STARTER",
      violations: [{ code: "ACTIVE_PROGRAMS", actual: 7, limit: 3, message: rawBackendProse }],
    },
  ]);
  let observedResponse: unknown;
  await mockTemplateGalleryApi(page);
  await page.route(
    `**/v1/organizations/${templateGalleryOrganizationId}/billing`,
    async (route) => {
      await fulfill(route, responseData, "billing-stable-code");
    },
  );
  page.on("response", async (response) => {
    if (!response.url().endsWith(`/v1/organizations/${templateGalleryOrganizationId}/billing`))
      return;
    observedResponse = await response.json();
  });

  await page.goto("/ar/dashboard/billing");
  const downgradeCard = page.locator(".billing-downgrade-card");
  await expect(downgradeCard).toBeVisible();
  await expect(downgradeCard).toContainText("7");
  await expect(downgradeCard).toContainText("3");
  const renderedText = await downgradeCard.textContent();
  expect(renderedText).toMatch(/[\u0600-\u06FF]/u);
  expect(renderedText).not.toContain(rawBackendProse);
  expect(JSON.stringify(observedResponse)).toContain('"code":"ACTIVE_PROGRAMS"');
  expect(JSON.stringify(observedResponse)).toContain('"actual":7');
  expect(JSON.stringify(observedResponse)).toContain('"limit":3');
  await expect(page.getByRole("button").first()).toBeEnabled();
  await captureStagingRepairEvidence(page, "08-billing-arabic-error.png");
});

test("uses themed keyboard-accessible SearchableSelect controls for Activity Type and Default Language", async ({
  page,
}) => {
  let savedSettings: Record<string, unknown> = {};
  await mockTemplateGalleryApi(page, {
    businessCategory: "LegacyActivityValue",
    onOrganizationPatch: (body) => {
      savedSettings = body;
    },
  });
  await installSettingsRoutes(page);
  await page.goto("/ar/dashboard/settings");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  const activity = page
    .locator(".wf-search-select")
    .filter({ has: page.locator('input[name="category"]') });
  const activityInput = activity.getByRole("combobox");
  await expect(activityInput).toBeVisible();
  await expect(activityInput).not.toHaveJSProperty("tagName", "SELECT");
  await expect(activityInput).toHaveValue("LegacyActivityValue");
  await activityInput.focus();
  await activityInput.press("ArrowDown");
  const activityListbox = page.getByRole("listbox");
  await expect(activityListbox).toBeVisible();
  await expect(activityListbox).toHaveAttribute("dir", "rtl");
  await captureStagingRepairEvidence(page, "09-activity-select-themed.png");
  await activityInput.press("ArrowDown");
  await activityInput.press("Enter");
  await expect(activityListbox).toBeHidden();
  await activityInput.focus();
  await activityInput.press("ArrowUp");
  await expect(activityListbox).toBeVisible();
  await activityInput.press("Escape");
  await expect(activityListbox).toBeHidden();
  const selectedActivity = await page.locator('input[name="category"]').inputValue();
  expect(selectedActivity).not.toBe("");

  const language = page
    .locator(".wf-search-select")
    .filter({ has: page.locator('input[name="locale"]') });
  const languageInput = language.getByRole("combobox");
  await expect(languageInput).toBeVisible();
  await languageInput.focus();
  await languageInput.press("ArrowDown");
  const languageListbox = page.getByRole("listbox");
  await expect(languageListbox).toBeVisible();
  await expect(languageListbox).toHaveAttribute("dir", "rtl");
  await captureStagingRepairEvidence(page, "10-default-language-select-themed.png");
  await languageListbox
    .getByRole("option", { name: /^\u0627\u0644\u0639\u0631\u0628\u064a\u0629/u })
    .click();
  await expect(page.locator('input[name="locale"]')).toHaveValue("ar");

  await activity
    .locator("xpath=ancestor::form")
    .getByRole("button", { name: /\u062d\u0641\u0638/u })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect.poll(() => savedSettings.businessCategory).toBe(selectedActivity);
  await expect.poll(() => savedSettings.defaultLocale).toBe("ar");
  await page.reload();
  await expect(page.locator('input[name="category"]')).toHaveValue(selectedActivity);
  await expect(page.locator('input[name="locale"]')).toHaveValue("ar");
});

test("keeps Google linking secure while presenting a localized inline wrong-password error", async ({
  page,
}) => {
  const rawBackendProse = "Incorrect Waflo password. This must never be displayed in Arabic UI.";
  let rejectedCode = "";
  await mockTemplateGalleryApi(page);
  await page.route("**/v1/auth/sessions", (route) => fulfill(route, []));
  await page.route("**/v1/security/events", (route) => fulfill(route, { items: [] }));
  await page.route("**/v1/auth/external/identities", (route) =>
    fulfill(route, { accountEmail: "gallery@example.test", passwordEnabled: true, identities: [] }),
  );
  await page.route("**/v1/auth/external/providers", (route) =>
    fulfill(route, { googleSignInAvailable: true }),
  );
  await page.route("**/v1/auth/external/google/link", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    expect(payload.currentPassword).toBe("not-the-real-password");
    rejectedCode = "REAUTHENTICATION_REQUIRED";
    await reject(route, rejectedCode, rawBackendProse);
  });

  await page.goto("/ar/dashboard/security");
  const googleSection = page.locator(".security-section").filter({ hasText: "Google" });
  const password = googleSection.locator('input[autocomplete="current-password"]');
  await expect(password).toBeVisible();
  await password.fill("not-the-real-password");
  const linkButton = googleSection.getByRole("button", { name: /Google/u });
  await linkButton.click();
  await expect(password).toHaveAttribute("aria-invalid", "true");
  const inlineError = googleSection.getByRole("alert");
  await expect(inlineError).toBeVisible();
  const errorText = await inlineError.textContent();
  expect(errorText).toMatch(/[\u0600-\u06FF]/u);
  expect(errorText).not.toContain(rawBackendProse);
  expect(rejectedCode).toBe("REAUTHENTICATION_REQUIRED");
  await expect(linkButton).toBeEnabled();
  await captureStagingRepairEvidence(page, "11-google-link-wrong-password.png");
  await password.fill("corrected-password");
  await expect(inlineError).toBeHidden();
  await expect(password).not.toHaveAttribute("aria-invalid", "true");
});

test("renders one server-derived Google reauthentication state after session rotation", async ({
  page,
}) => {
  let status: "REQUIRED" | "VERIFIED" = "REQUIRED";
  await mockTemplateGalleryApi(page);
  await page.route("**/v1/auth/external/identities", (route) =>
    fulfill(route, {
      accountEmail: "google-only@example.test",
      passwordEnabled: false,
      identities: [],
    }),
  );
  await page.route("**/v1/auth/external/reauthentication", (route) =>
    fulfill(route, {
      status,
      expiresAt: status === "VERIFIED" ? "2026-09-08T12:00:00.000Z" : null,
    }),
  );

  await page.goto("/en/dashboard/settings");
  await expect(page.getByText("Verify with Google before changing the URL.")).toBeVisible();
  await expect(page.getByText("Verified with Google")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change merchant URL" })).toBeDisabled();

  // This route fixture represents the completed, securely rotated server
  // session. The screen still has to obtain authorization from the canonical
  // status endpoint after navigating back from OAuth.
  status = "VERIFIED";
  await page.reload();
  await expect(page.getByText("Verified with Google")).toBeVisible();
  await expect(page.getByText("Verify with Google before changing the URL.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change merchant URL" })).toBeEnabled();
  await expect(
    page.getByText("The previous URL stays reserved for 90 days after it is changed."),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByText("Verified with Google")).toBeVisible();

  status = "REQUIRED";
  await page.reload();
  await expect(page.getByText("Verified with Google")).toHaveCount(0);
  await expect(page.getByText("Verify with Google before changing the URL.")).toBeVisible();

  await page.goto("/ar/dashboard/settings");
  const settingsText = await page.locator(".dashboard-settings").textContent();
  expect(settingsText).toMatch(/[\u0600-\u06FF]/u);
  expect(settingsText).not.toContain("Verify with Google before changing the URL.");
});

test("separates Wallet provider configuration, artifact readiness, and device eligibility on launch", async ({
  page,
}) => {
  const configuredIneligible = [
    {
      provider: "APPLE",
      mode: "REAL",
      status: "HEALTHY",
      safeMessage: "Configured",
      configured: true,
      providerConfigured: true,
      artifactAvailable: true,
      installationAvailable: true,
      deviceEligibility: "REQUIRES_COMPATIBLE_DEVICE",
      reason: "DEVICE",
    },
    {
      provider: "GOOGLE",
      mode: "REAL",
      status: "HEALTHY",
      safeMessage: "Configured",
      configured: true,
      providerConfigured: true,
      artifactAvailable: true,
      installationAvailable: true,
      deviceEligibility: "REQUIRES_COMPATIBLE_DEVICE",
      reason: "DEVICE",
    },
  ];
  await mockTemplateGalleryApi(page, { studioState: "READY", walletHealth: configuredIneligible });
  await openStudioLaunch(page);
  const wallets = page.locator(".publication-wallet-list");
  const apple = wallets.locator("section").filter({ hasText: "Apple Wallet" });
  const google = wallets.locator("section").filter({ hasText: "Google Wallet" });
  await expect(apple).toContainText("Configured");
  await expect(apple).toContainText("compatible Apple device");
  await expect(google).toContainText("Configured");
  await expect(google).toContainText("save link");
  await expect(wallets).not.toContainText(/Unavailable|disabled/u);
  await captureStagingRepairEvidence(page, "16-wallet-provider-device-state.png");

  await page.unrouteAll({ behavior: "ignoreErrors" });
  const configuredEligible = configuredIneligible.map((provider) => ({
    ...provider,
    deviceEligibility: "ELIGIBLE",
  }));
  await mockTemplateGalleryApi(page, { studioState: "READY", walletHealth: configuredEligible });
  await openStudioLaunch(page);
  const eligibleWallets = page.locator(".publication-wallet-list");
  await expect(
    eligibleWallets.locator("section").filter({ hasText: "Apple Wallet" }),
  ).toContainText("This device can complete the Add to Wallet action.");
  await expect(
    eligibleWallets.locator("section").filter({ hasText: "Google Wallet" }),
  ).toContainText("This browser can open the save link");

  await page.unrouteAll({ behavior: "ignoreErrors" });
  const unconfigured = [
    {
      provider: "APPLE",
      mode: "REAL",
      status: "NOT_CONFIGURED",
      safeMessage: "Configuration required",
      configured: false,
      providerConfigured: false,
      artifactAvailable: false,
      installationAvailable: false,
      deviceEligibility: "UNKNOWN",
      reason: "CONFIGURATION",
    },
    {
      provider: "GOOGLE",
      mode: "REAL",
      status: "NOT_CONFIGURED",
      safeMessage: "Configuration required",
      configured: false,
      providerConfigured: false,
      artifactAvailable: false,
      installationAvailable: false,
      deviceEligibility: "UNKNOWN",
      reason: "CONFIGURATION",
    },
  ];
  await mockTemplateGalleryApi(page, { studioState: "READY", walletHealth: unconfigured });
  await openStudioLaunch(page);
  await expect(page.locator(".publication-wallet-list")).toContainText("Configuration required");
});
