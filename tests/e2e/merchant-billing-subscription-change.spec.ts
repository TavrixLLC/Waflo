import { expect, type Page, test } from "@playwright/test";

const ownerEmail = "owner@waflo.local";
const ownerPassword = "Waflo-Development-2026";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const previewId = "11111111-1111-4111-8111-111111111111";

function envelope(data: unknown) {
  return JSON.stringify({ data, requestId: "browser-billing-preview" });
}

async function loginMerchant(page: Page) {
  await page.goto("http://localhost:3001/en/login");
  await page.locator('input[name="email"]').fill(ownerEmail);
  await page.locator('input[name="password"]').fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/dashboard(?:\/|$)/);
}

async function mockSubscriptionChange(page: Page) {
  let previewRequests = 0;
  let confirmationRequests = 0;
  await page.route(`**/v1/organizations/${organizationId}/billing`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      contentType: "application/json",
      body: envelope({
        selectedPlan: "GROWTH",
        profile: {
          subscriptionStatus: "ACTIVE",
          trialStart: null,
          trialEnd: null,
          stripeCustomerId: "cus_browser_fixture",
        },
        subscriptions: [
          {
            id: "sub_browser_fixture",
            status: "ACTIVE",
            planCode: "GROWTH",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
        checkoutTerms: null,
        currentTerms: {
          marketCode: "SA",
          currency: "SAR",
          amountMinor: "9900",
          cadence: "MONTHLY",
          grandfathered: true,
        },
        scheduledPriceChange: {
          effectiveAt: "2026-10-01T00:00:00.000Z",
          noticeAt: "2026-09-01T00:00:00.000Z",
          marketCode: "SA",
          currency: "SAR",
          amountMinor: "11900",
        },
        stripeConfigured: true,
      }),
    });
  });
  await page.route(
    `**/v1/organizations/${organizationId}/billing/subscription-change/preview`,
    async (route) => {
      previewRequests += 1;
      expect(route.request().postDataJSON()).toEqual({
        targetPlan: "scale",
        targetCadence: "monthly",
      });
      await route.fulfill({
        contentType: "application/json",
        body: envelope({
          previewId,
          current: { plan: "growth", cadence: "monthly", amountMinor: "9900", currency: "SAR" },
          target: { plan: "scale", cadence: "monthly", amountMinor: "14900", currency: "SAR" },
          proration: {
            amountDueNow: "4300",
            creditAmount: "1100",
            nextRenewalAmount: null,
            nextRenewalAt: "2026-09-01T00:00:00.000Z",
            lines: [],
          },
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        }),
      });
    },
  );
  await page.route(
    `**/v1/organizations/${organizationId}/billing/subscription-change/${previewId}/confirm`,
    async (route) => {
      confirmationRequests += 1;
      expect(route.request().postDataJSON()).toEqual({});
      await route.fulfill({
        contentType: "application/json",
        body: envelope({
          previewId,
          status: "CONFIRMED",
          change: {
            fromPlan: "growth",
            fromCadence: "monthly",
            toPlan: "scale",
            toCadence: "monthly",
            currency: "SAR",
            targetAmountMinor: "14900",
          },
          confirmedAt: "2026-08-27T12:00:00.000Z",
          providerState: { subscriptionStatus: "active" },
        }),
      });
    },
  );
  return {
    previewRequests: () => previewRequests,
    confirmationRequests: () => confirmationRequests,
  };
}

test("an active regional subscriber reviews server-previewed terms and confirms with only the preview reference", async ({
  page,
}) => {
  await loginMerchant(page);
  const requests = await mockSubscriptionChange(page);
  await page.goto("http://localhost:3001/en/dashboard/billing");
  await expect(
    page.getByText("Current subscription price", { exact: true }).locator(".."),
  ).toContainText("SAR");
  await expect(page.getByText("Upcoming price change", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to Stripe Checkout" })).toBeHidden();

  const scaleCard = page.locator(".wf-plan-card").filter({ hasText: "Scale" });
  await expect(scaleCard.locator(".wf-plan-card__price")).toBeHidden();
  await scaleCard.getByRole("button", { name: "Choose plan" }).click();

  const dialog = page.getByRole("dialog", { name: "Review subscription change" });
  await expect(dialog).toContainText("SAR");
  await expect(dialog).toContainText("Due now");
  await expect(dialog).toContainText("Credit applied");
  await expect(dialog).toContainText("Final renewal total will be shown on your next invoice.");
  await expect(dialog).toContainText("New subscription");
  await dialog.getByRole("button", { name: "Confirm subscription change" }).click();
  await expect(page.getByText("Your plan change is being applied.", { exact: true })).toBeVisible();
  await expect.poll(requests.previewRequests).toBe(1);
  await expect.poll(requests.confirmationRequests).toBe(1);
});
