import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const adminEmail = "browser-a11y-admin@waflo.local";
const adminPassword = "Browser A11y Administrator 2026!";
let database: {
  adminUser: { upsert(input: unknown): Promise<unknown> };
  $disconnect(): Promise<void>;
};

async function login(page: Page, locale: "en" | "ar") {
  await page.goto(`http://localhost:3003/${locale}/login`);
  await page.locator('input[name="email"]').fill(adminEmail);
  await page.locator('input[name="password"]').fill(adminPassword);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(`http://localhost:3003/${locale}`);
}

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(
    violations,
    violations.map((violation) => `${violation.id}: ${violation.description}`).join("\n"),
  ).toEqual([]);
}

test.beforeAll(async () => {
  const [{ hashPassword, normalizeEmail }, { createPrismaClient }] = await Promise.all([
    import("../../packages/auth/dist/index.js"),
    import("../../packages/database/dist/src/client.js"),
  ]);
  database = createPrismaClient(process.env.DATABASE_URL);
  const passwordHash = await hashPassword(adminPassword);
  await database.adminUser.upsert({
    where: { normalizedEmail: normalizeEmail(adminEmail) },
    update: {
      displayName: "Browser Accessibility Administrator",
      passwordHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      disabledAt: null,
    },
    create: {
      displayName: "Browser Accessibility Administrator",
      email: adminEmail,
      normalizedEmail: normalizeEmail(adminEmail),
      passwordHash,
      preferredLocale: "EN",
      role: "SUPER_ADMIN",
    },
  });
});

test.afterAll(async () => {
  await database.$disconnect();
});

test("admin login and critical operations pages have no serious accessibility violations", async ({
  page,
}) => {
  await page.goto("http://localhost:3003/en/login");
  await expectNoSeriousViolations(page);

  await login(page, "en");
  for (const pathname of ["", "/customers", "/pricing", "/repricing", "/stripe-health"]) {
    await page.goto(`http://localhost:3003/en${pathname}`);
    await expect(page.locator(".admin-shell")).toBeVisible();
    await expectNoSeriousViolations(page);
  }
});

test("admin Arabic shell has an RTL boundary and no serious accessibility violations", async ({
  page,
}) => {
  await login(page, "ar");
  await expect(page.locator(".admin-shell")).toHaveAttribute("dir", "rtl");
  await expectNoSeriousViolations(page);
});
