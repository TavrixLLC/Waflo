import { expect, test } from "@playwright/test";

test("keeps the authenticated Merchant shell stable across primary routes", async ({ page }) => {
  await page.goto("/en/login");
  await page.locator('input[name="email"]').fill("owner@waflo.local");
  await page.locator('input[name="password"]').fill("Waflo-Development-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/dashboard(?:\/|$)/);

  const sidebar = page.locator(".wf-sidebar");
  const organization = page.getByRole("button", { name: "Choose organization" });
  await expect(sidebar).toBeVisible();
  await expect(organization).toBeVisible();
  const organizationName = (await organization.textContent())?.trim();
  expect(organizationName).toBeTruthy();

  await sidebar.evaluate((element) => {
    element.setAttribute("data-navigation-sentinel", "persistent-shell");
  });

  let documentNavigations = 0;
  let meRequests = 0;
  const browserErrors: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      documentNavigations += 1;
    }
    if (new URL(request.url()).pathname === "/v1/auth/me") meRequests += 1;
  });
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  const routes = [
    { link: "Loyalty Cards", path: "/en/dashboard/programs", heading: "Loyalty Cards" },
    { link: "Customers", path: "/en/dashboard/customers", heading: "Customers" },
    { link: "Team", path: "/en/dashboard/team", heading: "Team" },
    { link: "Analytics", path: "/en/dashboard/analytics", heading: "Analytics" },
    { link: "Billing", path: "/en/dashboard/billing", heading: "Billing" },
    { link: "Settings", path: "/en/dashboard/settings", heading: "Settings" },
    { link: "Security", path: "/en/dashboard/security", heading: "Security" },
  ] as const;

  for (const route of routes) {
    const link = sidebar.getByRole("link", { name: route.link, exact: true });
    await link.click();
    await expect(page).toHaveURL(route.path);
    await expect(
      page.getByRole("main").getByRole("heading", { name: new RegExp(`^${route.heading}$`, "i") }),
    ).toBeVisible();
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(sidebar).toHaveAttribute("data-navigation-sentinel", "persistent-shell");
    await expect(organization).toContainText(organizationName ?? "");
    await expect(page.locator(".dashboard-route-loading")).toHaveCount(0);
  }

  expect(documentNavigations).toBe(0);
  expect(meRequests).toBe(0);
  expect(browserErrors).toEqual([]);
});

test("keeps desktop navigation viewport-bound while long page content scrolls", async ({
  page,
}) => {
  await page.goto("/en/login");
  await page.locator('input[name="email"]').fill("owner@waflo.local");
  await page.locator('input[name="password"]').fill("Waflo-Development-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/dashboard(?:\/|$)/);

  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/en/dashboard/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    const geometry = await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>(".wf-sidebar");
      const footer = document.querySelector<HTMLElement>(".wf-sidebar__footer");
      const main = document.querySelector<HTMLElement>("main.dashboard-content");
      if (!sidebar || !footer || !main)
        throw new Error("Dashboard shell structure is unavailable.");

      const extension = document.createElement("div");
      extension.setAttribute("data-e2e-long-page", "true");
      extension.style.height = "2600px";
      main.append(extension);
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });

      const sidebarBox = sidebar.getBoundingClientRect();
      const footerBox = footer.getBoundingClientRect();
      return {
        viewportHeight: window.innerHeight,
        sidebarHeight: sidebar.clientHeight,
        sidebarTop: sidebarBox.top,
        footerBottom: footerBox.bottom,
        documentScrollable: document.documentElement.scrollHeight > window.innerHeight,
      };
    });

    expect(geometry.documentScrollable).toBe(true);
    expect(Math.abs(geometry.sidebarHeight - geometry.viewportHeight)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.sidebarTop)).toBeLessThanOrEqual(1);
    expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  }

  await page.setViewportSize({ width: 768, height: 900 });
  await expect(page.locator(".wf-sidebar")).toBeHidden();
  await expect(page.locator(".dashboard-mobile-tabs")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("uses registry-defined Kurdish locales in the shared language menu", async ({ page }) => {
  await page.goto("/en/login");
  await page.locator('input[name="email"]').fill("owner@waflo.local");
  await page.locator('input[name="password"]').fill("Waflo-Development-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/dashboard(?:\/|$)/);

  await page.getByRole("button", { name: "Language" }).click();
  const menu = page.getByRole("menu", { name: "Language" });
  await expect(menu).toBeVisible();
  await expect(menu.getByText("Kurdish", { exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "کوردی بادینی" })).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "کوردی سۆرانی" })).toBeVisible();

  await menu.getByRole("menuitemradio", { name: "کوردی سۆرانی" }).click();
  await expect(page).toHaveURL(/\/ku-sorani\/dashboard(?:\/|$)/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ckb-Arab-IQ");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("button", { name: "زمان" })).toBeVisible();
});

test("recovers an already completed trial after a browser retry", async ({ page }) => {
  await page.goto("/en/login");
  await page.locator('input[name="email"]').fill("owner@waflo.local");
  await page.locator('input[name="password"]').fill("Waflo-Development-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/dashboard(?:\/|$)/);

  const organizationId = "review-recovered-organization";
  const checkoutSessionId = "cs_review_recovered";
  const commandId = "00000000-0000-4000-8000-000000000031";
  let setupRequests = 0;
  let completionRequests = 0;
  let onboardingRequests = 0;

  await page.route(`**/v1/organizations/${organizationId}/billing`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          billingIdentity: {
            name: "Recovered Coffee",
            email: "billing@recovered.example",
            countryCode: "IQ",
            addressLine1: "Al Karrada",
            addressLine2: null,
            city: "Baghdad",
            region: "Baghdad",
            postalCode: "10001",
          },
          onboardingSetup: null,
        },
        requestId: "trial-recovery-billing",
      }),
    });
  });

  await page.route(`**/v1/organizations/${organizationId}/billing/trial/setup`, async (route) => {
    setupRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          completed: true,
          clientSecret: null,
          checkoutSessionId,
          publishableKey: "pk_test_not_loaded_for_completed_trial",
          trialDays: 15,
          amount: 2900,
          currency: "USD",
          expectedTrialStart: "2026-08-13T09:00:00.000Z",
          expectedFirstChargeAt: "2026-08-20T09:00:00.000Z",
        },
        requestId: "trial-recovery-setup",
      }),
    });
  });
  await page.route(
    `**/v1/organizations/${organizationId}/billing/trial/complete`,
    async (route) => {
      completionRequests += 1;
      expect(route.request().headers()["x-idempotency-key"]).toBe(commandId);
      expect(route.request().postDataJSON()).toEqual({ checkoutSessionId });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            status: "trialing",
            trialStart: "2026-08-13T09:00:00.000Z",
            trialEnd: "2026-08-20T09:00:00.000Z",
            firstChargeAt: "2026-08-20T09:00:00.000Z",
            amount: 2900,
            currency: "USD",
            initialInvoiceAmount: 0,
            paymentMethod: { brand: "visa", last4: "4242", expMonth: 8, expYear: 2029 },
          },
          requestId: "trial-recovery-complete",
        }),
      });
    },
  );
  await page.route(`**/v1/organizations/${organizationId}/complete-onboarding`, async (route) => {
    onboardingRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: {}, requestId: "trial-recovery-onboarding" }),
    });
  });

  await page.evaluate(
    ({ commandId: billingCommand, organizationId: organization }) => {
      window.sessionStorage.setItem("waflo:onboarding-billing-command", billingCommand);
      window.sessionStorage.setItem(
        "waflo:onboarding-wizard",
        JSON.stringify({
          organizationId: organization,
          step: 4,
          plan: "starter",
          cadence: "monthly",
        }),
      );
    },
    { commandId, organizationId },
  );

  await page.goto(`/en/onboarding/business?organization=${organizationId}`);
  await expect(page).toHaveURL(`/en/onboarding/complete?organization=${organizationId}`);
  await expect(page.getByRole("heading", { name: "Your free trial has started" })).toBeVisible();
  expect(setupRequests).toBe(1);
  expect(completionRequests).toBe(1);
  expect(onboardingRequests).toBe(1);
});

test("keeps trial review information separate from its confirmation action across RTL and mobile", async ({
  page,
}) => {
  await page.goto("/en/login");
  await page.locator('input[name="email"]').fill("owner@waflo.local");
  await page.locator('input[name="password"]').fill("Waflo-Development-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/dashboard(?:\/|$)/);

  const organizationId = "trial-review-layout-organization";
  const checkoutSessionId = "cs_trial_review_layout";
  await page.route(`**/v1/organizations/${organizationId}/billing`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          billingIdentity: {
            name: "Review Coffee",
            email: "billing@review.example",
            countryCode: "IQ",
            addressLine1: "Al Karrada",
            addressLine2: null,
            city: "Baghdad",
            region: "Baghdad",
            postalCode: "10001",
          },
          onboardingSetup: { status: "SETUP_COMPLETED", checkoutSessionId },
        },
        requestId: "trial-review-layout",
      }),
    });
  });
  await page.route(`**/v1/organizations/${organizationId}/billing/trial/preview`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          plan: "growth",
          cadence: "monthly",
          trialDays: 15,
          amount: 2900,
          currency: "USD",
          expectedTrialStart: "2026-09-05T00:00:00.000Z",
          expectedFirstChargeAt: "2026-09-20T00:00:00.000Z",
          paymentMethod: { brand: "mastercard", last4: "4444", expMonth: 12, expYear: 2030 },
        },
        requestId: "trial-review-preview",
      }),
    });
  });

  const openReview = async (locale: "en" | "ar") => {
    await page.goto(
      `/${locale}/onboarding/business?organization=${organizationId}&resume=trial_confirmation_required`,
    );
    await expect(page.locator(".onboarding-trial-review__summary")).toBeVisible();
  };

  await openReview("en");
  const summary = page.locator(".onboarding-trial-review__summary");
  const action = page.locator(".onboarding-trial-review__actions .wf-button");
  await expect(summary.getByRole("button")).toHaveCount(0);
  await expect(action).toBeVisible();
  await expect(page.locator(".onboarding-card-summary bdi")).toHaveAttribute("dir", "ltr");

  for (const width of [1440, 1366, 430, 390, 375, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => {
      const summaryCard = document.querySelector<HTMLElement>(".onboarding-trial-review__summary");
      const confirmation = document.querySelector<HTMLElement>(
        ".onboarding-trial-review__actions .wf-button",
      );
      if (!summaryCard || !confirmation) throw new Error("Trial review layout is unavailable.");
      const dimensions = {
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        summaryWidth: summaryCard.getBoundingClientRect().width,
        actionWidth: confirmation.getBoundingClientRect().width,
      };
      return dimensions;
    });
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    if (width <= 430) {
      expect(Math.abs(dimensions.actionWidth - dimensions.summaryWidth)).toBeLessThanOrEqual(1);
    }
  }

  // The durable setup record, rather than browser state, must recover the
  // review in a second locale as well.
  await page.evaluate(() => window.sessionStorage.clear());
  await openReview("ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".onboarding-trial-review__summary").getByRole("button")).toHaveCount(
    0,
  );
  await expect(page.locator(".onboarding-trial-review__actions .wf-button")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
});
