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

async function exhaustWalletRetries(page: Page, reads: () => number): Promise<void> {
  await expect.poll(reads).toBe(1);
  for (const [index, delay] of [250, 500, 1_000, 2_000, 4_000, 8_000, 8_000].entries()) {
    await page.clock.fastForward(delay);
    await expect.poll(reads).toBe(index + 2);
  }
}

test("converges Wallet readiness during original Android navigation without exposing preparation", async ({
  browser,
}) => {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
    viewport: { width: 320, height: 720 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  let reads = 0;
  await routeCard(page, () => ({ google: ++reads <= 4 ? "PREPARING" : "READY", apple: "READY" }));
  try {
    await page.goto("http://localhost:3002/card/wallet-readiness-member");
    await expect(page.getByRole("button", { name: "Add to Google Wallet" })).toBeVisible({
      timeout: 8_000,
    });
    // The fifth canonical card read exceeds the old first-load retry window;
    // the button must still arrive without a browser refresh.
    expect(reads).toBeGreaterThanOrEqual(5);
    await expect(page.getByRole("link", { name: "Add to Apple Wallet" })).toHaveCount(0);
    await expect(page.getByText(/Google Wallet.*Preparing/u)).toHaveCount(0);
    await expect(page.getByText("Your card is ready to add to Wallet.")).toBeVisible();
    const googleBadge = page.getByRole("button", { name: "Add to Google Wallet" }).locator("img");
    await expect(googleBadge).toHaveAttribute("src", "/wallet-buttons/google-add-to-wallet-en.svg");
    const badgeBox = await googleBadge.boundingBox();
    expect(badgeBox?.width).toBeLessThanOrEqual(256);
    expect(page.url()).toContain("/card/wallet-readiness-member");
  } finally {
    await context.close();
  }
});

test("shows the CTA when Wallet becomes ready on the final bounded revalidation", async ({
  browser,
}) => {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
    viewport: { width: 320, height: 720 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.clock.install();
  let reads = 0;
  await routeCard(page, () => ({ google: ++reads < 8 ? "PREPARING" : "READY", apple: "READY" }));
  try {
    await page.goto("http://localhost:3002/card/wallet-readiness-member");
    await exhaustWalletRetries(page, () => reads);
    await expect(page.getByRole("button", { name: "Add to Google Wallet" })).toBeVisible({
      timeout: 8_000,
    });
    // One initial card read plus all seven delays is the exact end of the
    // current 23.75-second automatic revalidation window.
    expect(reads).toBe(8);
  } finally {
    await context.close();
  }
});

test("recovers from exhaustion when Check again observes a ready Wallet pass", async ({
  browser,
}) => {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
    viewport: { width: 320, height: 720 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.clock.install();
  let reads = 0;
  await routeCard(page, () => ({ google: ++reads === 9 ? "READY" : "PREPARING", apple: "READY" }));
  try {
    await page.goto("http://localhost:3002/card/wallet-readiness-member");
    await exhaustWalletRetries(page, () => reads);
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(page.getByRole("button", { name: "Add to Google Wallet" })).toBeVisible();
    expect(reads).toBe(9);
    await expect(page.getByRole("button", { name: "Check again" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("starts one fresh bounded cycle when Check again remains preparing", async ({ browser }) => {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
    viewport: { width: 320, height: 720 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.clock.install();
  let reads = 0;
  await routeCard(page, () => ({ google: ++reads === 10 ? "READY" : "PREPARING", apple: "READY" }));
  try {
    await page.goto("http://localhost:3002/card/wallet-readiness-member");
    await exhaustWalletRetries(page, () => reads);
    await page.getByRole("button", { name: "Check again" }).click();
    await expect.poll(() => reads).toBe(9);
    await expect(
      page.getByText("The Google Wallet button will appear automatically when your pass is ready."),
    ).toBeVisible();
    await page.clock.fastForward(250);
    await expect.poll(() => reads).toBe(10);
    await expect(page.getByRole("button", { name: "Add to Google Wallet" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("guards rapid Check again activation so it makes one canonical request", async ({
  browser,
}) => {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
    viewport: { width: 320, height: 720 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.clock.install();
  let reads = 0;
  let releaseManualResponse: (() => void) | undefined;
  await page.route("**/v1/customer/card/wallet-readiness-member**", async (route) => {
    reads += 1;
    if (reads === 9) {
      await new Promise<void>((resolve) => {
        releaseManualResponse = resolve;
      });
    }
    await fulfillCard(route, cardFixture(reads === 9 ? "READY" : "PREPARING", "READY"));
  });
  try {
    await page.goto("http://localhost:3002/card/wallet-readiness-member");
    await exhaustWalletRetries(page, () => reads);
    await page.getByRole("button", { name: "Check again" }).evaluate((button) => {
      button.click();
      button.click();
    });
    await expect.poll(() => reads).toBe(9);
    expect(releaseManualResponse).toBeDefined();
    releaseManualResponse?.();
    await expect(page.getByRole("button", { name: "Add to Google Wallet" })).toBeVisible();
    expect(reads).toBe(9);
  } finally {
    await context.close();
  }
});

test("stops when Check again returns a terminal Wallet state", async ({ browser }) => {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
    viewport: { width: 320, height: 720 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.clock.install();
  let reads = 0;
  await routeCard(page, () => ({
    google: ++reads === 9 ? "UNAVAILABLE" : "PREPARING",
    apple: "READY",
  }));
  try {
    await page.goto("http://localhost:3002/card/wallet-readiness-member");
    await exhaustWalletRetries(page, () => reads);
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(
      page.getByText("This card cannot be added to Google Wallet right now."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Check again" })).toHaveCount(0);
    await page.clock.fastForward(8_500);
    expect(reads).toBe(9);
  } finally {
    await context.close();
  }
});

test("stops after the final bounded revalidation while Wallet remains preparing", async ({
  browser,
}) => {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
    viewport: { width: 320, height: 720 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.clock.install();
  let reads = 0;
  await routeCard(page, () => {
    reads += 1;
    return { google: "PREPARING", apple: "READY" };
  });
  try {
    await page.goto("http://localhost:3002/card/wallet-readiness-member");
    await exhaustWalletRetries(page, () => reads);
    await expect(page.getByRole("button", { name: "Add to Google Wallet" })).toHaveCount(0);
    await expect(
      page.getByText(
        "Your Wallet pass is taking longer than expected. Check again to see if it's ready.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();
    await expect(
      page.getByText("The Google Wallet button will appear automatically when your pass is ready."),
    ).toHaveCount(0);

    // The next automatic read would be due within eight seconds if this ever
    // became an unbounded chain.
    await page.clock.fastForward(8_500);
    expect(reads).toBe(8);
  } finally {
    await context.close();
  }
});

test("cancels a scheduled readiness read when the card page unmounts", async ({ browser }) => {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
    viewport: { width: 320, height: 720 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  let reads = 0;
  await routeCard(page, () => {
    reads += 1;
    return { google: "PREPARING", apple: "READY" };
  });
  try {
    await page.goto("http://localhost:3002/card/wallet-readiness-member");
    await expect(
      page.getByText("The Google Wallet button will appear automatically when your pass is ready."),
    ).toBeVisible();
    await page.goto("http://localhost:3002/privacy");
    const readsAtUnmount = reads;
    await page.waitForTimeout(800);
    expect(reads).toBe(readsAtUnmount);
  } finally {
    await context.close();
  }
});

test("abandons an in-flight card request when navigation supersedes it", async ({ browser }) => {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
    viewport: { width: 320, height: 720 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  let reads = 0;
  let releaseOlderResponse: (() => void) | undefined;
  await page.route("**/v1/customer/card/wallet-readiness-member**", async (route) => {
    reads += 1;
    if (reads === 1) {
      await new Promise<void>((resolve) => {
        releaseOlderResponse = resolve;
      });
      await fulfillCard(route, cardFixture("PREPARING", "READY"));
      return;
    }
    await fulfillCard(route, cardFixture("READY", "READY"));
  });
  try {
    await page.goto("http://localhost:3002/card/wallet-readiness-member");
    await expect.poll(() => reads).toBe(1);
    await page.goto("http://localhost:3002/privacy");
    await page.goto("http://localhost:3002/card/wallet-readiness-member");
    await expect(page.getByRole("button", { name: "Add to Google Wallet" })).toBeVisible();
    expect(reads).toBe(2);

    releaseOlderResponse?.();
    await page.waitForTimeout(300);
    await expect(page.getByRole("button", { name: "Add to Google Wallet" })).toBeVisible();
    expect(reads).toBe(2);
  } finally {
    releaseOlderResponse?.();
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
        const appleButton = page.getByRole("link", { name: "Add to Apple Wallet" });
        await expect(appleButton).toBeVisible();
        await expect(appleButton.locator("img")).toHaveAttribute(
          "src",
          "/wallet-buttons/apple-add-to-wallet-en.svg",
        );
        await expect(appleButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await expect(appleButton).toHaveCSS("border-top-width", "0px");
        await expect(page.getByRole("button", { name: "Add to Google Wallet" })).toHaveCount(0);
      } else if (expected === "google") {
        const googleButton = page.getByRole("button", { name: "Add to Google Wallet" });
        await expect(googleButton).toBeVisible();
        await expect(googleButton.locator("img")).toHaveAttribute(
          "src",
          "/wallet-buttons/google-add-to-wallet-en.svg",
        );
        await expect(googleButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        await expect(googleButton).toHaveCSS("border-top-width", "0px");
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
