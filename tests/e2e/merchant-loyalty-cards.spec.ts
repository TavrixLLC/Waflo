import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route, test } from "@playwright/test";
import { templateGalleryFixtures } from "./template-gallery-fixtures";

type Plan = "STARTER" | "GROWTH" | "SCALE";

interface ProgramFixture {
  id: string;
  internalName: string;
  status:
    | "DRAFT"
    | "VALIDATED"
    | "TEST"
    | "SCHEDULED"
    | "PUBLISHED"
    | "PAUSED"
    | "ARCHIVED"
    | "SUSPENDED";
  updatedAt: string;
  currentDraftVersion: {
    id: string;
    versionNumber: number;
    revision: number;
    status: string;
    editingMode: "QUICK" | "PRO";
  } | null;
  currentPublishedVersion: {
    id: string;
    versionNumber: number;
    status: string;
    publishedAt: string | null;
  } | null;
  _count: { versions: number };
}

const organizationId = "merchant-loyalty-card-fixture";

async function fulfill(route: Route, data: unknown): Promise<void> {
  const origin = route.request().headers().origin ?? "http://localhost:3001";
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
    },
    body: JSON.stringify({ data, requestId: "merchant-loyalty-card-test" }),
  });
}

async function mockMerchantApi(
  page: Page,
  {
    plan,
    programs,
    onLifecycleRequest,
  }: {
    plan: Plan;
    programs: ProgramFixture[];
    onLifecycleRequest?: (path: string) => void;
  },
): Promise<void> {
  const statusByProgramId = new Map(programs.map((program) => [program.id, program.status]));
  await page.route(/https?:\/\/(?:localhost:4000|api\.waflo\.app)\/v1\/.*/u, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/auth/csrf") {
      await fulfill(route, { csrfToken: "merchant-loyalty-card-csrf" });
      return;
    }
    if (path === "/v1/auth/me") {
      await fulfill(route, {
        id: "merchant-owner-fixture",
        displayName: "Merchant Owner",
        email: "merchant@example.test",
        preferredLocale: "EN",
        lastSelectedOrganizationId: organizationId,
        memberships: [
          {
            id: "merchant-membership-fixture",
            role: "OWNER",
            organization: {
              id: organizationId,
              name: "Fixture Coffee",
              merchantSlug: "fixture-coffee",
              defaultLocale: "EN",
              selectedPlan: plan,
              onboardingState: "COMPLETE",
            },
          },
        ],
      });
      return;
    }
    if (path === `/v1/organizations/${organizationId}`) {
      await fulfill(route, { id: organizationId, businessCategory: "Cafe" });
      return;
    }
    if (path.endsWith("/programs/templates")) {
      const locale = new URL(route.request().url()).searchParams.get("locale");
      await fulfill(route, templateGalleryFixtures(locale === "AR" ? "AR" : "EN"));
      return;
    }
    if (path.endsWith("/programs")) {
      await fulfill(route, {
        items: programs.map((program) => ({
          ...program,
          status: statusByProgramId.get(program.id),
        })),
        nextCursor: null,
      });
      return;
    }
    if (path.endsWith("/locations")) {
      await fulfill(route, { items: [] });
      return;
    }
    if (path.endsWith("/assets")) {
      await fulfill(route, { items: [], nextCursor: null });
      return;
    }
    if (path.endsWith("/wallet/providers")) {
      await fulfill(route, []);
      return;
    }
    for (const program of programs) {
      const base = `/v1/organizations/${organizationId}/programs/${program.id}`;
      if (path === `${base}/versions`) {
        await fulfill(route, { items: [], nextCursor: null });
        return;
      }
      if (path === `${base}/enrollment`) {
        await fulfill(route, {
          programId: program.id,
          status: statusByProgramId.get(program.id),
          publicSlug: null,
          publicUrl: null,
          enrollmentLinkStatus: "ACTIVE",
          editableVersion: null,
          publishedVersion: null,
        });
        return;
      }
      if (path === base) {
        await fulfill(route, {
          ...program,
          status: statusByProgramId.get(program.id),
          currentPublishedVersion: program.currentPublishedVersion
            ? {
                ...program.currentPublishedVersion,
                editingMode: "QUICK",
                revision: 1,
                operationalTimezone: "Asia/Baghdad",
                staffOwnReversalWindowSeconds: 120,
                managerReversalWindowMinutes: 1440,
                managerOverrideAllowed: true,
                translations: [],
                stampRule: null,
                rewards: [],
                locations: [],
                visualTheme: null,
              }
            : null,
          versions: [],
        });
        return;
      }
      if (path === `${base}/pause` && route.request().method() === "POST") {
        onLifecycleRequest?.(path);
        statusByProgramId.set(program.id, "PAUSED");
        await fulfill(route, {});
        return;
      }
    }
    await route.fulfill({ status: 404, body: "{}" });
  });
}

test("keeps the Programs route while presenting an English loyalty-card empty state", async ({
  page,
}) => {
  await mockMerchantApi(page, { plan: "GROWTH", programs: [] });
  await page.goto("/en/dashboard/programs");

  await expect(page).toHaveURL(/\/en\/dashboard\/programs$/);
  await expect(page.getByRole("heading", { level: 1, name: "Loyalty cards" })).toBeVisible();
  await expect(
    page.getByText(
      "Create and manage customer-ready loyalty cards for the web, with Wallet availability when supported.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create your first loyalty card" })).toBeVisible();
  await expect(page.getByText("Assets", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create loyalty card" })).toHaveCount(1);

  await page.getByRole("button", { name: "Create loyalty card" }).click();
  await expect(page).toHaveURL(/\/en\/dashboard\/programs\/new$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Choose a starting design" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Start from scratch" })).toBeVisible();
});

test("renders the empty state in Arabic with a real RTL document", async ({ page }) => {
  await mockMerchantApi(page, { plan: "GROWTH", programs: [] });
  await page.goto("/ar/dashboard/programs");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".programs-home")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "بطاقات الولاء" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "أنشئ أول بطاقة ولاء" })).toBeVisible();
  await expect(page.getByRole("button", { name: "إنشاء بطاقة ولاء" })).toHaveCount(1);
});

test("uses one reachable CTA and avoids horizontal overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMerchantApi(page, { plan: "GROWTH", programs: [] });
  await page.goto("/en/dashboard/programs");

  await expect(page.getByRole("heading", { name: "Create your first loyalty card" })).toBeVisible();
  await expect(page.locator(".programs-home__header-action")).toBeHidden();
  await expect(page.locator(".loyalty-card-empty__mobile-action")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("keeps populated cards and actions responsive across supported widths", async ({ page }) => {
  await mockMerchantApi(page, {
    plan: "STARTER",
    programs: [
      {
        id: "responsive-program-id",
        internalName: "Responsive Coffee Card",
        status: "PUBLISHED",
        updatedAt: "2026-01-03T00:00:00.000Z",
        currentDraftVersion: null,
        currentPublishedVersion: {
          id: "responsive-program-version-id",
          versionNumber: 1,
          status: "PUBLISHED",
          publishedAt: "2026-01-02T00:00:00.000Z",
        },
        _count: { versions: 1 },
      },
    ],
  });
  await page.goto("/en/dashboard/programs");

  for (const width of [1440, 1280, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    await page.waitForTimeout(50);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);

    const headingBox = await page
      .getByRole("heading", { level: 1, name: "Loyalty cards" })
      .boundingBox();
    const createBox = await page.getByRole("button", { name: "Create loyalty card" }).boundingBox();
    expect(headingBox).not.toBeNull();
    expect(createBox).not.toBeNull();
    if (headingBox && createBox) {
      const overlap = !(
        headingBox.x + headingBox.width <= createBox.x ||
        createBox.x + createBox.width <= headingBox.x ||
        headingBox.y + headingBox.height <= createBox.y ||
        createBox.y + createBox.height <= headingBox.y
      );
      expect(overlap).toBe(false);
    }

    const card = page.locator(".program-list__card");
    await expect(card.getByRole("button", { name: /Open card/i })).toBeVisible();
    await expect(card.locator(".program-list__menu-trigger")).toBeVisible();
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    if (cardBox) {
      expect(cardBox.x).toBeGreaterThanOrEqual(0);
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(width + 1);
    }
  }
});

test("renders a populated Starter card library with merchant-safe status copy", async ({
  page,
}) => {
  await mockMerchantApi(page, {
    plan: "STARTER",
    programs: [
      {
        id: "program-id-remains-unchanged",
        internalName: "Morning Coffee",
        status: "PUBLISHED",
        updatedAt: "2026-01-03T00:00:00.000Z",
        currentDraftVersion: null,
        currentPublishedVersion: {
          id: "program-version-id-remains-unchanged",
          versionNumber: 1,
          status: "PUBLISHED",
          publishedAt: "2026-01-02T00:00:00.000Z",
        },
        _count: { versions: 1 },
      },
    ],
  });
  await page.goto("/en/dashboard/programs");

  await expect(page.getByText("1 of 1 on Starter")).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Morning Coffee" })).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await expect(page.getByText("PUBLISHED", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open card: Morning Coffee" })).toBeVisible();
});

test("renders populated Arabic status copy without collapsing suspension into pause", async ({
  page,
}) => {
  await mockMerchantApi(page, {
    plan: "GROWTH",
    programs: [
      {
        id: "suspended-program-id-remains-unchanged",
        internalName: "بطاقة القهوة",
        status: "SUSPENDED",
        updatedAt: "2026-01-03T00:00:00.000Z",
        currentDraftVersion: null,
        currentPublishedVersion: null,
        _count: { versions: 1 },
      },
    ],
  });
  await page.goto("/ar/dashboard/programs");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 3, name: "بطاقة القهوة" })).toBeVisible();
  await expect(page.getByText("موقوفة", { exact: true })).toBeVisible();
  await expect(page.getByText("متوقفة مؤقتًا", { exact: true })).toHaveCount(0);
});

test("keeps lifecycle actions on the existing Program API and identifier", async ({ page }) => {
  const lifecycleRequests: string[] = [];
  await mockMerchantApi(page, {
    plan: "GROWTH",
    onLifecycleRequest: (path) => lifecycleRequests.push(path),
    programs: [
      {
        id: "program-api-boundary-id",
        internalName: "API Boundary Card",
        status: "PUBLISHED",
        updatedAt: "2026-01-03T00:00:00.000Z",
        currentDraftVersion: null,
        currentPublishedVersion: {
          id: "program-api-boundary-version-id",
          versionNumber: 1,
          status: "PUBLISHED",
          publishedAt: "2026-01-02T00:00:00.000Z",
        },
        _count: { versions: 1 },
      },
    ],
  });
  await page.goto("/en/dashboard/programs");

  const card = page.locator(".program-list__card").filter({ hasText: "API Boundary Card" });
  const menuTrigger = card.locator(".wf-dropdown summary");
  await menuTrigger.focus();
  await expect(menuTrigger).toBeFocused();
  await page.keyboard.press("Enter");
  const accessibility = await new AxeBuilder({ page }).include(".program-list__card").analyze();
  expect(accessibility.violations).toEqual([]);
  await page.keyboard.press("Tab");
  await expect(card.getByRole("button", { name: "Pause card" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog").getByText("Pause card", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();

  await expect(card.getByText("Paused", { exact: true })).toBeVisible();
  await card.locator(".wf-dropdown summary").press("Enter");
  await expect(card.getByRole("button", { name: "Resume card" })).toBeVisible();
  expect(lifecycleRequests).toEqual([
    `/v1/organizations/${organizationId}/programs/program-api-boundary-id/pause`,
  ]);
});
