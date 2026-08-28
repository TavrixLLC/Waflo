import { expect, test } from "@playwright/test";

const adminEmail = "browser-admin@waflo.local";
const adminPassword = "Browser Admin Password 2026!";
let database: {
  adminUser: { upsert(input: unknown): Promise<unknown> };
  $disconnect(): Promise<void>;
};

async function provisionBrowserAdmin() {
  const [{ hashPassword, normalizeEmail }, { createPrismaClient }] = await Promise.all([
    import("../../packages/auth/dist/index.js"),
    import("../../packages/database/dist/src/client.js"),
  ]);
  database = createPrismaClient(process.env.DATABASE_URL);
  const passwordHash = await hashPassword(adminPassword);
  await database.adminUser.upsert({
    where: { normalizedEmail: normalizeEmail(adminEmail) },
    update: {
      displayName: "Browser Administrator",
      passwordHash,
      preferredLocale: "EN",
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      disabledAt: null,
    },
    create: {
      displayName: "Browser Administrator",
      email: adminEmail,
      normalizedEmail: normalizeEmail(adminEmail),
      passwordHash,
      preferredLocale: "EN",
      role: "SUPER_ADMIN",
    },
  });
}

test.beforeAll(async () => {
  await provisionBrowserAdmin();
});

test.afterAll(async () => {
  await database.$disconnect();
});

test("a provisioned administrator can sign in, reach the operations surfaces, and sign out", async ({
  page,
}) => {
  await page.goto("http://localhost:3003/en/login");
  await page.locator('input[name="email"]').fill(adminEmail);
  await page.locator('input[name="password"]').fill(adminPassword);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL("http://localhost:3003/en");
  await expect(page.getByRole("navigation", { name: "Internal operations" })).toBeVisible();

  for (const [label, pathname] of [
    ["Customers", "/en/customers"],
    ["Pricing", "/en/pricing"],
    ["Annual repricing", "/en/repricing"],
    ["Stripe health", "/en/stripe-health"],
  ] as const) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(`http://localhost:3003${pathname}`);
    await expect(page.locator(".admin-shell")).toBeVisible();
  }

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("http://localhost:3003/en/login");
});

test("merchant credentials cannot authenticate to the isolated administrator session", async ({
  page,
}) => {
  await page.goto("http://localhost:3003/en/login");
  await page.locator('input[name="email"]').fill("owner@waflo.local");
  await page.locator('input[name="password"]').fill("Waflo-Development-2026");
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL("http://localhost:3003/en/login");
  await expect(page.getByRole("alert").filter({ hasText: /email or password/i })).toBeVisible();
});

test("the admin shell preserves Arabic RTL navigation for an authenticated administrator", async ({
  page,
}) => {
  await page.goto("http://localhost:3003/ar/login");
  await page.locator('input[name="email"]').fill(adminEmail);
  await page.locator('input[name="password"]').fill(adminPassword);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL("http://localhost:3003/ar");
  await expect(page.locator(".admin-shell")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".admin-sidebar nav a").first()).toBeVisible();
});
