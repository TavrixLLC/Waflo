import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import sharp from "sharp";

const reviewDirectory = path.resolve("artifacts", "p1-final-review");
const seedPassword = "Waflo-Development-2026";
const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function capture(page: import("@playwright/test").Page, name: string): Promise<void> {
  await mkdir(reviewDirectory, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
  await page.screenshot({
    path: path.join(reviewDirectory, name),
    animations: "disabled",
    caret: "hide",
  });
}

async function captureElement(
  element: import("@playwright/test").Locator,
  name: string,
): Promise<void> {
  await mkdir(reviewDirectory, { recursive: true });
  await element.scrollIntoViewIfNeeded();
  await element.screenshot({
    path: path.join(reviewDirectory, name),
    animations: "disabled",
    caret: "hide",
  });
}

async function login(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/en/login");
  await page.locator('input[name="email"]').fill("owner@waflo.local");
  await page.locator('input[name="password"]').fill(seedPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/dashboard(?:\/|$)/u);
}

async function csrfToken(page: import("@playwright/test").Page): Promise<string> {
  const csrfResponse = await page.request.get(`${apiOrigin}/v1/auth/csrf`);
  expect(csrfResponse.ok()).toBe(true);
  return ((await csrfResponse.json()) as { data: { csrfToken: string } }).data.csrfToken;
}

async function selectTodayCoffee(page: import("@playwright/test").Page): Promise<string> {
  const meResponse = await page.request.get(`${apiOrigin}/v1/auth/me`);
  expect(meResponse.ok()).toBe(true);
  const me = (await meResponse.json()) as {
    data: { memberships: Array<{ organization: { id: string; name: string } }> };
  };
  const organization = me.data.memberships.find(
    (membership) => membership.organization.name === "Today Coffee",
  )?.organization;
  expect(organization).toBeTruthy();

  const csrf = await csrfToken(page);
  const selected = await page.request.post(
    `${apiOrigin}/v1/organizations/${organization?.id}/select`,
    { headers: { origin: "http://localhost:3001", "x-csrf-token": csrf } },
  );
  expect(
    selected.ok(),
    `organization selection returned ${selected.status()}: ${await selected.text()}`,
  ).toBe(true);
  return organization?.id ?? "";
}

async function createDraft(
  page: import("@playwright/test").Page,
  organizationId: string,
  programId: string,
): Promise<void> {
  const response = await page.request.post(
    `${apiOrigin}/v1/organizations/${organizationId}/programs/${programId}/draft`,
    {
      headers: { origin: "http://localhost:3001", "x-csrf-token": await csrfToken(page) },
    },
  );
  expect(
    response.ok(),
    `draft creation returned ${response.status()}: ${await response.text()}`,
  ).toBe(true);
}

async function uploadedMerchantLogo(): Promise<Buffer> {
  return sharp({
    create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><rect x="24" y="24" width="464" height="464" rx="120" fill="#0F5B71"/><path d="M146 150h220L256 374z" fill="#F5D89A"/><circle cx="256" cy="256" r="42" fill="#FFF8EA"/></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
}

test("captures real merchant-brand issuer identity across loyalty and Wallet previews", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  const organizationId = await selectTodayCoffee(page);
  await page.goto("/en/dashboard/programs");
  await expect(page.locator("main h1").first()).toBeVisible();

  const programsResponse = await page.request.get(
    `${apiOrigin}/v1/organizations/${organizationId}/programs`,
  );
  expect(programsResponse.ok()).toBe(true);
  const programs = (await programsResponse.json()) as { data: { items: Array<{ id: string }> } };
  const programId = programs.data.items[0]?.id;
  expect(programId).toBeTruthy();

  await page.goto(`/en/dashboard/programs/${programId}`);
  await expect(page.getByRole("region", { name: "Card preview" })).toBeVisible();
  await capture(page, "merchant-logo-fallback-studio-preview-desktop-en.png");

  await page.goto("/en/dashboard/settings");
  const picker = page.locator(".studio-asset-picker").filter({
    has: page.getByRole("heading", { name: "Merchant logo" }),
  });
  await picker.locator('input[type="file"]').setInputFiles({
    name: "today-coffee-brand.png",
    mimeType: "image/png",
    buffer: await uploadedMerchantLogo(),
  });
  const cropDialog = page.getByRole("dialog", { name: "Crop image safely" });
  await expect(cropDialog).toBeVisible();
  await cropDialog.getByRole("button", { name: "Process and upload" }).click();
  await expect(
    page.getByText(/Your merchant logo is saved\. Existing Wallet passes will refresh safely/u),
  ).toBeVisible();
  await expect(picker.locator(".studio-asset-current img")).toBeVisible();
  await captureElement(
    page.locator(".merchant-branding-card"),
    "merchant-logo-settings-desktop-en.png",
  );

  await createDraft(page, organizationId, programId);
  await page.goto(`/en/dashboard/programs/${programId}`);
  await expect(page.getByText(/unpublished changes/u)).toBeVisible();

  await page.goto(`/en/dashboard/programs/${programId}/edit`);
  await expect(page.locator(".builder-preview-desktop .builder-preview-canvas img")).toBeVisible({
    timeout: 20_000,
  });
  await capture(page, "merchant-logo-builder-preview-desktop-en.png");

  await page.goto(`/ar/dashboard/programs/${programId}/edit`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".builder-preview-desktop .builder-preview-canvas img")).toBeVisible({
    timeout: 20_000,
  });
  await capture(page, "merchant-logo-builder-preview-desktop-ar.png");

  await page.goto(`/en/dashboard/programs/${programId}`);
  const preview = page.getByRole("region", { name: "Card preview" });
  await expect(preview).toBeVisible();
  await expect(preview.locator(".studio-published-customer-preview__issuer-mark")).toHaveAttribute(
    "src",
    /^blob:/u,
    { timeout: 20_000 },
  );
  await capture(page, "merchant-logo-studio-preview-desktop-en.png");

  await page.getByRole("tab", { name: "Saved changes" }).click();
  await page.getByRole("tab", { name: "Apple" }).click();
  await expect(preview.locator("img")).toBeVisible({ timeout: 20_000 });
  await capture(page, "merchant-logo-apple-wallet-preview.png");

  await page.getByRole("tab", { name: "Google" }).click();
  await expect(preview.locator("img")).toBeVisible({ timeout: 20_000 });
  await capture(page, "merchant-logo-google-wallet-preview.png");

  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("http://today.localhost:3002/join/cookie-card");
  await expect(page.locator(".customer-merchant-identity__logo").first()).toBeVisible();
  await capture(page, "merchant-logo-customer-card-mobile-en.png");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/ar/dashboard/billing");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator('[data-billing-summary="next-renewal"]')).toBeVisible();
  await capture(page, "06-merchant-billing-desktop-1440-ar.png");
});
