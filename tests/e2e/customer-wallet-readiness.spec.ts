import { expect, type Page, type Route, test } from "@playwright/test";

function cardFixture(googleStatus: string, appleStatus = "READY") {
  return {
    publicMembershipId: "wallet-readiness-member",
    customer: { displayName: "Wallet Member", preferredLocale: "en", maskedPhone: null },
    merchant: { name: "Wallet Coffee", slug: "wallet-coffee" },
    program: {
      defaultLocale: "en",
      enabledLocales: ["en"],
      contentLocale: "en",
      name: "Wallet Rewards",
      description: "Collect stamps.",
      rewardSummary: "Free coffee",
      pausedMessage: null,
    },
    membership: {
      status: "ACTIVE",
      credentialStatus: "ACTIVE",
      state: "ACTIVE",
      enrolledAt: "2026-09-08T09:00:00.000Z",
    },
    progress: {
      currentCycleStampCount: 0,
      completedCycleCount: 0,
      rewardReady: false,
      goal: 8,
      stamps: ["EMPTY", "EMPTY", "EMPTY", "EMPTY", "EMPTY", "EMPTY", "EMPTY", "EMPTY"],
      render: {
        dataUri:
          "data:image/svg+xml;base64," +
          Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="520" height="180"/>',
          ).toString("base64"),
        contentDigest: "wallet-readiness",
        configurationDigest: "wallet-readiness",
        width: 520,
        height: 180,
      },
    },
    theme: {
      backgroundColor: "#FFF8EE",
      foregroundColor: "#4A2818",
      accentColor: "#C2410C",
      secondaryColor: "#F59E0B",
    },
    membershipQr: null,
    wallet: {
      apple: { mode: "REAL", status: appleStatus, testAdapter: false, safeErrorCode: null },
      google: { mode: "REAL", status: googleStatus, testAdapter: false, safeErrorCode: null },
    },
    transfer: {
      allowed: true,
      emailConfirmationRequired: false,
      transferWithoutEmailAllowed: true,
    },
  };
}

async function fulfillCard(route: Route, data: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data, requestId: "customer-wallet-readiness" }),
  });
}

async function routeCard(page: Page, next: () => { google: string; apple: string }) {
  await page.route("**/v1/customer/card/wallet-readiness-member**", (route) => {
    const state = next();
    return fulfillCard(route, cardFixture(state.google, state.apple));
  });
}

test("converges Wallet readiness during original Android navigation without exposing preparation", async ({
  browser,
}) => {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
  });
  const page = await context.newPage();
  let reads = 0;
  await routeCard(page, () => ({ google: ++reads === 1 ? "PREPARING" : "READY", apple: "READY" }));
  try {
    await page.goto("http://localhost:3002/card/wallet-readiness-member");
    await expect(page.getByRole("button", { name: "Add to Google Wallet" })).toBeVisible({
      timeout: 8_000,
    });
    expect(reads).toBeGreaterThanOrEqual(2);
    await expect(page.getByRole("link", { name: "Add to Apple Wallet" })).toHaveCount(0);
    await expect(page.getByText(/Google Wallet.*Preparing/u)).toHaveCount(0);
    expect(page.url()).toContain("/card/wallet-readiness-member");
  } finally {
    await context.close();
  }
});

test("shows exactly one provider CTA on supported devices and guidance otherwise", async ({
  browser,
}) => {
  const ios = await browser.newContext({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  });
  const android = await browser.newContext({
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
  });
  const desktop = await browser.newContext();
  try {
    for (const [context, expected] of [
      [ios, "apple"],
      [android, "google"],
      [desktop, "desktop"],
    ] as const) {
      const page = await context.newPage();
      await routeCard(page, () => ({ google: "READY", apple: "READY" }));
      await page.goto("http://localhost:3002/card/wallet-readiness-member");
      if (expected === "apple") {
        await expect(page.getByRole("link", { name: "Add to Apple Wallet" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Add to Google Wallet" })).toHaveCount(0);
      } else if (expected === "google") {
        await expect(page.getByRole("button", { name: "Add to Google Wallet" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Add to Apple Wallet" })).toHaveCount(0);
      } else {
        await expect(page.getByText(/Open this card on iPhone or Android/u)).toBeVisible();
        await expect(page.getByRole("link", { name: "Add to Apple Wallet" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Add to Google Wallet" })).toHaveCount(0);
      }
    }
  } finally {
    await Promise.all([ios.close(), android.close(), desktop.close()]);
  }
});
