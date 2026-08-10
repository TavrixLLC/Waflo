import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { mockTemplateGalleryApi } from "./template-gallery-fixtures";

function allTemplates(page: Page) {
  return page.locator('section[aria-labelledby="template-gallery-all-title"]');
}

function embeddedStampSvg(svg: string): string {
  for (const match of svg.matchAll(/data:image\/svg\+xml;base64,([^"']+)/gu)) {
    const decoded = Buffer.from(match[1] ?? "", "base64").toString("utf8");
    if (decoded.includes("data-visual-state=")) return decoded;
  }
  throw new Error("Builder preview did not contain shared stamp-renderer output.");
}

function stampStateCount(svg: string, state: "FILLED" | "EMPTY"): number {
  return (svg.match(new RegExp(`data-visual-state="${state}"`, "gu")) ?? []).length;
}

async function enterBuilder(page: Page, templateName = "Classic Roast"): Promise<void> {
  await page.goto("/en/dashboard/programs/new");
  await allTemplates(page)
    .getByRole("button", { name: `Preview: ${templateName}, all templates` })
    .click();
  await page
    .getByRole("dialog", { name: templateName })
    .getByRole("button", { name: "Use this template" })
    .click();
  await expect(page).toHaveURL(/\/en\/dashboard\/programs\/created-program-id\/edit$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Customize your loyalty card" }),
  ).toBeVisible();
}

test("builds one continuously saved card with combined languages and lazy truthful previews", async ({
  page,
}) => {
  const createBodies: Record<string, unknown>[] = [];
  const patchBodies: Record<string, unknown>[] = [];
  const previewRequests: Array<[string, string]> = [];
  await mockTemplateGalleryApi(page, {
    onCreate: (body) => createBodies.push(body),
    onPatch: (body) => patchBodies.push(body),
    onBuilderPreview: (profile, locale) => previewRequests.push([profile, locale]),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterBuilder(page);

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByText("Classic Roast", { exact: true })).toBeVisible();
  await expect(page.getByText("Quick Mode", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".builder-preview-desktop")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Card builder sections" })).toBeVisible();
  for (const section of [
    "Basics",
    "Reward",
    "Languages",
    "Locations",
    "Appearance",
    "Review & test",
    "Advanced settings",
  ]) {
    await expect(
      page.getByRole("button", { name: new RegExp(section, "u") }).first(),
    ).toBeVisible();
  }

  await page.getByLabel("Exact stamp goal").fill("10");
  await page
    .getByRole("button", { name: /^Reward/u })
    .first()
    .click();
  await page.getByLabel("What does the customer get?").fill("Free house roast");
  await expect.poll(() => patchBodies.length).toBeGreaterThanOrEqual(1);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(createBodies).toHaveLength(1);
  expect(patchBodies.at(-1)).toMatchObject({
    requiredStampCount: 10,
    templateCode: "COFFEE",
    revision: 1,
    translations: { en: { rewardSummary: "Free house roast" } },
  });
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
  expect(
    accessibility.violations.filter((violation) =>
      ["landmark-main-is-top-level", "landmark-no-duplicate-main", "landmark-unique"].includes(
        violation.id,
      ),
    ),
  ).toEqual([]);

  await page
    .getByRole("button", { name: /^Languages/u })
    .first()
    .click();
  const englishTab = page.getByRole("tab", { name: /English/u });
  await expect(englishTab).toBeVisible();
  await expect(page.getByRole("tab", { name: /العربية/u })).toBeVisible();
  await englishTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /العربية/u })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".builder-language-panel")).toHaveAttribute("dir", "rtl");

  await page.getByRole("tab", { name: "Apple Wallet" }).click();
  await expect
    .poll(() => previewRequests.some(([profile]) => profile === "APPLE_WALLET"))
    .toBe(true);
  await page.getByRole("tab", { name: "Google Wallet" }).click();
  await expect
    .poll(() => previewRequests.some(([profile]) => profile === "GOOGLE_WALLET"))
    .toBe(true);

  await page.reload();
  await expect(page.getByLabel("Exact stamp goal")).toHaveValue("10");
  await page
    .getByRole("button", { name: /^Reward/u })
    .first()
    .click();
  await expect(page.getByLabel("What does the customer get?")).toHaveValue("Free house roast");

  await page.goBack();
  await expect(
    page.getByRole("heading", { level: 1, name: "Choose a starting design" }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { level: 1, name: "Customize your loyalty card" }),
  ).toBeVisible();
  await expect(page.getByLabel("Exact stamp goal")).toHaveValue("10");
  expect(createBodies).toHaveLength(1);
});

test("changes the starting design on the same Program while preserving merchant data", async ({
  page,
}) => {
  const createBodies: Record<string, unknown>[] = [];
  const patchBodies: Record<string, unknown>[] = [];
  await mockTemplateGalleryApi(page, {
    onCreate: (body) => createBodies.push(body),
    onPatch: (body) => patchBodies.push(body),
  });
  await enterBuilder(page);
  await page
    .getByRole("button", { name: /^Reward/u })
    .first()
    .click();
  await page.getByLabel("What does the customer get?").fill("Signature house drink");
  await expect.poll(() => patchBodies.length).toBe(1);

  await page.getByRole("button", { name: "Change design" }).click();
  const warning = page.getByRole("dialog", { name: "Change this design?" });
  await expect(warning).toContainText("Your card name, reward, languages, goal, locations");
  await warning.getByRole("button", { name: "Choose another design" }).click();
  await expect(page).toHaveURL(/\/programs\/new\?changeFor=created-program-id$/u);

  const preview = allTemplates(page).getByRole("button", {
    name: "Preview: Dark Espresso, all templates",
  });
  await preview.click();
  await page
    .getByRole("dialog", { name: "Dark Espresso" })
    .getByRole("button", { name: "Use this template" })
    .click();

  await expect(page).toHaveURL(/\/programs\/created-program-id\/edit$/u);
  await expect(page.getByText("Dark Espresso", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: /^Reward/u })
    .first()
    .click();
  await expect(page.getByLabel("What does the customer get?")).toHaveValue("Signature house drink");
  expect(createBodies).toHaveLength(1);
  expect(patchBodies.at(-1)).toMatchObject({
    templateCode: "COFFEE_DARK_ESPRESSO",
    translations: { en: { rewardSummary: "Signature house drink" } },
  });
});

test("renders truthful 0/8, 4/8, and 8/8 Customer, Apple, and Google Builder previews", async ({
  page,
}) => {
  const responses: Array<{ profile: string; svg: string }> = [];
  await mockTemplateGalleryApi(page, {
    onBuilderPreview: (profile, _locale, preview) => responses.push({ profile, svg: preview.svg }),
  });
  await enterBuilder(page);
  const slider = page.locator('.builder-preview-desktop input[type="range"]');

  for (const progress of [0, 4, 8]) {
    await slider.evaluate((element, value) => {
      const input = element as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, progress);
    for (const [label, profile] of [
      ["Customer", "CUSTOMER_WEB"],
      ["Apple Wallet", "APPLE_WALLET"],
      ["Google Wallet", "GOOGLE_WALLET"],
    ] as const) {
      await page.getByRole("tab", { name: label }).click();
      const expectedResponse = `${profile}:${progress}`;
      const matching = () =>
        responses.findLast(
          (item) => item.profile === profile && item.svg.includes(`data-progress="${progress}"`),
        );
      await expect
        .poll(() =>
          responses.map(
            (item) => `${item.profile}:${item.svg.match(/data-progress="(\d+)"/u)?.[1] ?? "?"}`,
          ),
        )
        .toContain(expectedResponse);
      const stamp = embeddedStampSvg(matching()?.svg ?? "");
      expect(stampStateCount(stamp, "FILLED"), `${profile} ${progress}/8`).toBe(progress);
      expect(stampStateCount(stamp, "EMPTY"), `${profile} ${progress}/8`).toBe(8 - progress);
      expect(stamp).not.toMatch(/MILESTONE|GIFT|CHECK|REWARD_SLOT|NUMBERED/iu);
    }
  }

  const customer = responses.findLast((item) => item.profile === "CUSTOMER_WEB");
  expect(customer?.svg).toContain('data-composition="SPLIT_HERO"');
  await expect(
    page.getByText(/CUSTOMER_WEB|APPLE_WALLET|GOOGLE_WALLET|ProgramVersion|Draft revision/u),
  ).toHaveCount(0);
});

test("uses an explicit Wallet loading state and preserves the last good preview", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page, { previewDelayMs: 650 });
  await enterBuilder(page);
  const preview = page.locator(".builder-preview-desktop");
  await expect(preview.locator(".builder-preview-empty")).toContainText("Preparing your preview");
  await expect(preview.locator(".builder-preview-canvas img")).toHaveCount(0);
  await expect(preview.locator(".builder-preview-canvas img")).toBeVisible();

  await page.getByRole("tab", { name: "Apple Wallet" }).click();
  await expect(preview.locator(".builder-preview-empty")).toContainText("Apple Wallet");
  await expect(preview.locator(".builder-preview-empty")).toContainText("Preparing your preview");
  await expect(preview.locator(".builder-preview-canvas img")).toBeVisible();

  await page.getByLabel("Card name in your dashboard").fill("Updated coffee card");
  await expect(preview.locator(".builder-preview-canvas img")).toBeVisible();
  await expect(preview.locator(".builder-preview-status")).toBeVisible();
});

test("gives each customer field one owner and presents current built-in artwork", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page);
  await enterBuilder(page);

  await expect(page.getByLabel("Card name in your dashboard")).toHaveCount(1);
  await expect(page.getByLabel(/Customer-facing card title/u)).toHaveCount(0);
  await page
    .getByRole("button", { name: /^Reward/u })
    .first()
    .click();
  await expect(page.getByLabel("What does the customer get?")).toHaveCount(1);
  await page
    .getByRole("button", { name: /^Languages/u })
    .first()
    .click();
  await expect(page.getByLabel("Card name")).toHaveCount(1);
  await expect(page.getByLabel("Reward summary")).toHaveCount(0);
  await page.getByRole("tab", { name: /العربية/u }).click();
  const arabicTitle = page.getByLabel("اسم البطاقة");
  await arabicTitle.fill("بطاقة قهوة عربية طويلة للتحقق من اتجاه النص داخل الواجهة الإنجليزية");
  await expect(arabicTitle).toHaveAttribute("dir", "rtl");
  await expect(arabicTitle).toHaveAttribute("lang", "ar");

  await page
    .getByRole("button", { name: /^Appearance/u })
    .first()
    .click();
  await expect(page.getByText("Balanced card", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Upload the first asset", { exact: true })).toHaveCount(0);
  await expect(page.locator(".studio-asset-current")).toHaveCount(2);
  await expect(page.getByText("Currently used", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("heading", { level: 4, name: "Stamped icon" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 4, name: "Empty stamp" })).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".studio-asset-current img")
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
});

test("keeps readiness navigation and server validation on one status truth", async ({ page }) => {
  await mockTemplateGalleryApi(page);
  await enterBuilder(page);
  await page.getByLabel("Card name in your dashboard").fill("x");
  await page.getByRole("button", { name: "Review card" }).click();
  const readiness = page.locator(".builder-readiness-list");
  await expect(readiness.getByRole("button", { name: /Basics/u })).toContainText("Fix");
  await expect(page.getByRole("button", { name: "Continue to Studio" })).toBeDisabled();

  await readiness.getByRole("button", { name: /Basics/u }).click();
  await page.getByLabel("Card name in your dashboard").fill("Classic Roast card");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review card" }).click();
  await expect(page.getByText("Readiness checks passed", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Run again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to Studio" })).toBeEnabled();
});

test("surfaces save failure and revision conflict without silently overwriting", async ({
  page,
}) => {
  const patchBodies: Record<string, unknown>[] = [];
  await mockTemplateGalleryApi(page, {
    patchFailures: 1,
    patchConflicts: 1,
    onPatch: (body) => patchBodies.push(body),
  });
  await enterBuilder(page);

  await page.getByLabel("Card name in your dashboard").fill("Conflict-safe card");
  await expect(page.getByText("Save failed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.getByText(/Prisma|ProgramVersion|created-program-id/u)).toHaveCount(0);

  await page.getByRole("button", { name: "Retry" }).click();
  const conflict = page.getByRole("dialog", { name: "This draft changed in another editor" });
  await expect(conflict).toBeVisible();
  await conflict.getByRole("button", { name: "Keep my edits" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect.poll(() => patchBodies.length).toBe(3);
  expect(patchBodies.map((body) => body.revision)).toEqual([1, 1, 2]);
});

test("turns review into readiness and isolated Test Mode rather than a field dump", async ({
  page,
}) => {
  const observedApiPaths: string[] = [];
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (
      ["localhost", "api.waflo.app"].includes(requestUrl.hostname) &&
      requestUrl.pathname.startsWith("/v1/")
    )
      observedApiPaths.push(requestUrl.pathname);
  });
  await mockTemplateGalleryApi(page);
  await enterBuilder(page);

  await page.getByRole("button", { name: "Review card" }).click();
  await expect(page.getByText("Readiness checks passed", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Publishing remains in Studio/u)).toBeVisible();
  await page.getByRole("button", { name: "Start Test Mode" }).click();
  await expect(page.locator(".builder-test-meter strong")).toHaveText("0/8");
  await page.getByRole("button", { name: "Add one stamp" }).click();
  await expect(page.locator(".builder-test-meter strong")).toHaveText("1/8");

  expect(observedApiPaths.some((path) => path.includes("/test-sessions"))).toBe(true);
  expect(
    observedApiPaths.some((path) => /memberships|ledger|reward-entitlements/u.test(path)),
  ).toBe(false);
});

test("blocks a Starter merchant at the real card limit before creating an impossible draft", async ({
  page,
}) => {
  let creates = 0;
  await mockTemplateGalleryApi(page, {
    selectedPlan: "STARTER",
    existingPrograms: [
      {
        id: "existing-card",
        internalName: "Existing card",
        status: "PUBLISHED",
        currentDraftVersion: null,
        currentPublishedVersion: { id: "published", versionNumber: 1, status: "PUBLISHED" },
      },
    ],
    onCreate: () => {
      creates += 1;
    },
  });
  await page.goto("/en/dashboard/programs/new");
  await allTemplates(page)
    .getByRole("button", { name: "Preview: Classic Roast, all templates" })
    .click();
  await page
    .getByRole("dialog", { name: "Classic Roast" })
    .getByRole("button", { name: "Use this template" })
    .click();

  await expect(page.getByText(/reached your plan's active loyalty-card limit/u)).toBeVisible();
  expect(creates).toBe(0);
  await expect(page).toHaveURL(/\/dashboard\/programs\/new$/u);
});

test("keeps Arabic intentional and adapts from split desktop to a mobile preview sheet", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page);
  await enterBuilder(page);
  await page.goto("/ar/dashboard/programs/created-program-id/edit");

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".builder-shell")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await page.getByRole("button", { name: /اللغات/u }).click();
  await page.getByRole("tab", { name: /English/u }).click();
  const englishTitle = page.getByLabel("Card name");
  await englishTitle.fill(
    "Classic Roast loyalty card with a deliberately long English customer-facing name",
  );
  await expect(englishTitle).toHaveAttribute("dir", "ltr");
  await expect(englishTitle).toHaveAttribute("lang", "en");
  await englishTitle.press("Tab");
  await expect.poll(() => englishTitle.evaluate((input) => input.scrollLeft)).toBe(0);
  expect(await englishTitle.evaluate((element) => getComputedStyle(element).direction)).toBe("ltr");
  await page.getByRole("tab", { name: /العربية/u }).click();
  await expect(page.locator(".builder-language-panel")).toHaveAttribute("lang", "ar");
  const arabicTitle = page.getByLabel("اسم البطاقة");
  await expect(arabicTitle).toHaveAttribute("dir", "rtl");
  await expect(arabicTitle).toHaveAttribute("lang", "ar");

  for (const width of [1440, 1280, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".builder-preview-desktop")).toBeHidden();
  const previewAction = page.locator(".builder-mobile-preview-action");
  await expect(previewAction).toHaveText("معاينة");
  await previewAction.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: /معاينة مباشرة/u })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

test("reserves sticky-footer space and keeps active section navigation visible", async ({
  page,
}) => {
  await mockTemplateGalleryApi(page);
  await enterBuilder(page);
  await page.getByRole("button", { name: "Review card" }).click();
  await expect(page.getByText("Readiness checks passed", { exact: true }).first()).toBeVisible();

  for (const width of [1280, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: width <= 390 ? 780 : 860 });
    const activeNavigation = page.locator(
      '.builder-section-nav [data-builder-section-link="review"]',
    );
    await expect(activeNavigation).toHaveAttribute("aria-current", "page");
    await activeNavigation.scrollIntoViewIfNeeded();
    await expect(activeNavigation).toBeInViewport();
    await page
      .locator(".builder-editor")
      .getByRole("button", { name: "Start Test Mode" })
      .scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 1_000));
    const geometry = await page.evaluate(() => {
      const footer = document.querySelector<HTMLElement>(".builder-footer");
      const editor = document.querySelector<HTMLElement>(".builder-editor");
      const controls = [
        ...(editor?.querySelectorAll<HTMLElement>("button, input, textarea, select") ?? []),
      ].filter((element) => element.getClientRects().length > 0);
      const lastControl = controls.at(-1);
      const dashboardContent = document.querySelector<HTMLElement>(".dashboard-content");
      return {
        bodyWidth: document.body.getBoundingClientRect().width,
        clientWidth: document.documentElement.clientWidth,
        dashboardContentBoxSizing: dashboardContent
          ? getComputedStyle(dashboardContent).boxSizing
          : "missing",
        dashboardContentRect: dashboardContent
          ? {
              left: dashboardContent.getBoundingClientRect().left,
              right: dashboardContent.getBoundingClientRect().right,
              width: dashboardContent.getBoundingClientRect().width,
            }
          : null,
        footerTop: footer?.getBoundingClientRect().top ?? 0,
        innerWidth: window.innerWidth,
        lastControlBottom: lastControl?.getBoundingClientRect().bottom ?? 0,
        scrollX: window.scrollX,
        viewportHeight: window.innerHeight,
        documentOverflow:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
        overflowingElements: [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((element) => {
            if (element.getClientRects().length === 0) return false;
            const rect = element.getBoundingClientRect();
            return rect.left < -0.5 || rect.right > document.documentElement.clientWidth + 0.5;
          })
          .slice(0, 12)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              className: element.className,
              left: Math.round(rect.left * 10) / 10,
              right: Math.round(rect.right * 10) / 10,
              tagName: element.tagName,
              text: element.textContent?.trim().slice(0, 80) ?? "",
            };
          }),
      };
    });
    expect(
      geometry.documentOverflow,
      `${width}px horizontal overflow: ${JSON.stringify(geometry)}`,
    ).toBe(false);
    expect(
      geometry.lastControlBottom <= geometry.footerTop - 4 ||
        geometry.footerTop >= geometry.viewportHeight,
      `${width}px footer overlap: ${JSON.stringify(geometry)}`,
    ).toBe(true);
  }
});

test("coalesces sixty seconds of continuous editing into one save and one preview refresh", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const patchBodies: Record<string, unknown>[] = [];
  const previewRequests: Array<[string, string]> = [];
  await mockTemplateGalleryApi(page, {
    onPatch: (body) => patchBodies.push(body),
    onBuilderPreview: (profile, locale) => previewRequests.push([profile, locale]),
  });
  await enterBuilder(page);
  await expect.poll(() => previewRequests.length).toBeGreaterThan(0);
  previewRequests.length = 0;

  const internalName = page.getByLabel("Card name in your dashboard");
  const startedAt = Date.now();
  for (let index = 0; index < 120; index += 1) {
    await internalName.fill(`Continuous card edit ${index % 2 === 0 ? "A" : "B"}`);
    await page.waitForTimeout(500);
  }
  const editingMs = Date.now() - startedAt;

  await expect.poll(() => patchBodies.length).toBe(1);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect.poll(() => previewRequests.length).toBe(1);
  expect(previewRequests[0]?.[0]).toBe("CUSTOMER_WEB");
  expect(editingMs).toBeGreaterThanOrEqual(58_000);
  expect(editingMs).toBeLessThan(90_000);
  console.info(
    `P3 builder edit metrics ${JSON.stringify({ editingMs, patches: patchBodies.length, previewRefreshes: previewRequests.length })}`,
  );
});

test("captures the P3 builder journey and old-wizard comparison evidence", async ({ page }) => {
  test.setTimeout(300_000);
  const evidenceDirectory = "artifacts/uiux/create-card-p3";
  await mkdir(evidenceDirectory, { recursive: true });
  await mockTemplateGalleryApi(page, { patchDelayMs: 1_200 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterBuilder(page);

  await page.screenshot({
    path: `${evidenceDirectory}/01-builder-en-desktop.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.locator(".builder-workspace").screenshot({
    path: `${evidenceDirectory}/03-coffee-template-builder.png`,
    animations: "disabled",
  });
  await page.locator(".builder-editor").screenshot({
    path: `${evidenceDirectory}/06-basics.png`,
    animations: "disabled",
  });

  await page.goto("/ar/dashboard/programs/created-program-id/edit");
  await expect(page.getByRole("heading", { level: 1, name: "خصّص بطاقة الولاء" })).toBeVisible();
  await page.screenshot({
    path: `${evidenceDirectory}/02-builder-ar-desktop.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.goto("/en/dashboard/programs/created-program-id/edit");
  await expect(
    page.getByRole("heading", { level: 1, name: "Customize your loyalty card" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /^Reward/u })
    .first()
    .click();
  await page.locator(".builder-editor").screenshot({
    path: `${evidenceDirectory}/07-reward.png`,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: /^Languages/u })
    .first()
    .click();
  await page.locator(".builder-editor").screenshot({
    path: `${evidenceDirectory}/08-language-en.png`,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: /العربية/u }).click();
  await page.locator(".builder-editor").screenshot({
    path: `${evidenceDirectory}/09-language-ar.png`,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: /^Locations/u })
    .first()
    .click();
  await page.locator(".builder-editor").screenshot({
    path: `${evidenceDirectory}/10-locations.png`,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: /^Appearance/u })
    .first()
    .click();
  await page.locator(".builder-editor").screenshot({
    path: `${evidenceDirectory}/11-appearance.png`,
    animations: "disabled",
  });

  await page.getByRole("tab", { name: "Customer" }).click();
  await page.locator(".builder-preview-desktop").screenshot({
    path: `${evidenceDirectory}/12-customer-live-preview.png`,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Apple Wallet" }).click();
  await page.locator(".builder-preview-desktop").screenshot({
    path: `${evidenceDirectory}/13-apple-preview.png`,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Google Wallet" }).click();
  await page.locator(".builder-preview-desktop").screenshot({
    path: `${evidenceDirectory}/14-google-preview.png`,
    animations: "disabled",
  });

  await page
    .getByRole("button", { name: /^Basics/u })
    .first()
    .click();
  await page.getByLabel("Card name in your dashboard").fill("P3 evidence card");
  await expect(page.getByText("Saving…", { exact: true })).toBeVisible();
  await page.screenshot({
    path: `${evidenceDirectory}/15-saving.png`,
    fullPage: true,
    animations: "disabled",
  });
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.screenshot({
    path: `${evidenceDirectory}/16-saved.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.getByLabel("Card name in your dashboard").fill("");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review card" }).click();
  await expect(page.getByText("Needs attention", { exact: true }).first()).toBeVisible();
  await page.screenshot({
    path: `${evidenceDirectory}/17-validation-error.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: /^Basics/u })
    .first()
    .click();
  await page.getByLabel("Card name in your dashboard").fill("P3 evidence card");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review card" }).click();
  await expect(page.getByText("Readiness checks passed", { exact: true }).first()).toBeVisible();
  await page.screenshot({
    path: `${evidenceDirectory}/18-readiness-review.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.screenshot({
    path: `${evidenceDirectory}/19-tablet.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${evidenceDirectory}/20-mobile-390.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({
    path: `${evidenceDirectory}/21-mobile-360.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.goto("/ar/dashboard/programs/created-program-id/edit");
  await expect(page.locator(".builder-shell")).toHaveAttribute("dir", "rtl");
  await page.screenshot({
    path: `${evidenceDirectory}/22-mobile-ar.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/en/dashboard/programs/created-program-id/edit");
  await page.getByRole("button", { name: "Change design" }).click();
  const warning = page.getByRole("dialog", { name: "Change this design?" });
  await expect(warning).toBeVisible();
  await warning.screenshot({
    path: `${evidenceDirectory}/23-change-design-warning.png`,
    animations: "disabled",
  });
  await warning.getByRole("button", { name: "Choose another design" }).click();
  let preview = allTemplates(page).getByRole("button", {
    name: "Preview: Start from scratch, all templates",
  });
  await preview.click();
  await page
    .getByRole("dialog", { name: "Start from scratch" })
    .getByRole("button", { name: "Start from scratch" })
    .click();
  await expect(page).toHaveURL(/\/programs\/created-program-id\/edit$/u);
  await expect(
    page.locator(".builder-template-context").getByText("Start from scratch", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${evidenceDirectory}/05-start-from-scratch.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.getByRole("button", { name: "Change design" }).click();
  await page
    .getByRole("dialog", { name: "Change this design?" })
    .getByRole("button", { name: "Choose another design" })
    .click();
  preview = allTemplates(page).getByRole("button", {
    name: "Preview: Dark Espresso, all templates",
  });
  await preview.click();
  await page
    .getByRole("dialog", { name: "Dark Espresso" })
    .getByRole("button", { name: "Use this template" })
    .click();
  await expect(page).toHaveURL(/\/programs\/created-program-id\/edit$/u);
  await expect(
    page.locator(".builder-template-context").getByText("Dark Espresso", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${evidenceDirectory}/04-dark-template-builder.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.getByRole("button", { name: "Review card" }).click();
  await expect(page.getByText("Readiness checks passed", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Continue to Studio" }).click();
  await expect(page.getByRole("navigation", { name: "Studio sections" })).toBeVisible();
  await page.screenshot({
    path: `${evidenceDirectory}/24-builder-studio-consistency.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.goto("/en/dashboard/programs?create=quick");
  const legacyWizard = page.getByRole("dialog", { name: "Create a loyalty card" });
  await expect(legacyWizard).toBeVisible();
  const legacyBuffer = await legacyWizard.screenshot({ animations: "disabled" });
  const builderBuffer = await sharp(`${evidenceDirectory}/01-builder-en-desktop.png`)
    .resize({ width: 740 })
    .png()
    .toBuffer();
  const wizardBuffer = await sharp(legacyBuffer).resize({ width: 740 }).png().toBuffer();
  const [builderMetadata, wizardMetadata] = await Promise.all([
    sharp(builderBuffer).metadata(),
    sharp(wizardBuffer).metadata(),
  ]);
  const comparisonHeight = Math.max(builderMetadata.height ?? 0, wizardMetadata.height ?? 0);
  await sharp({
    create: { width: 1528, height: comparisonHeight + 64, channels: 4, background: "#fcfbfa" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="1528" height="64"><text x="16" y="40" font-family="Arial,sans-serif" font-size="23" font-weight="700" fill="#241916">Before · seven-step modal</text><text x="788" y="40" font-family="Arial,sans-serif" font-size="23" font-weight="700" fill="#241916">After · continuous card builder</text></svg>',
        ),
        left: 0,
        top: 0,
      },
      { input: wizardBuffer, left: 16, top: 64 },
      { input: builderBuffer, left: 788, top: 64 },
    ])
    .png()
    .toFile(`${evidenceDirectory}/25-old-wizard-new-builder-contact-sheet.png`);
});

test("captures focused P3 repair-round-1 evidence", async ({ page }) => {
  test.setTimeout(240_000);
  const evidenceDirectory = "artifacts/uiux/create-card-p3-repair-round1";
  await mkdir(evidenceDirectory, { recursive: true });
  await mockTemplateGalleryApi(page, { patchDelayMs: 350 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterBuilder(page);

  const preview = page.locator(".builder-preview-desktop");
  const slider = preview.locator('input[type="range"]');
  const setProgress = async (value: number) => {
    await slider.evaluate((element, progress) => {
      const input = element as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, String(progress));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    await expect(preview.locator(".builder-preview-canvas img")).toBeVisible();
    await expect(preview.locator(".builder-preview-status")).toHaveCount(0);
  };

  await page.screenshot({
    path: `${evidenceDirectory}/01-builder-desktop-fixed.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.getByRole("tab", { name: "Customer" }).click();
  for (const [progress, filename] of [
    [0, "02-customer-preview-0-of-8.png"],
    [4, "03-customer-preview-4-of-8.png"],
    [8, "04-customer-preview-8-of-8.png"],
  ] as const) {
    await setProgress(progress);
    await preview.screenshot({
      path: `${evidenceDirectory}/${filename}`,
      animations: "disabled",
    });
  }

  await setProgress(4);
  await page.getByRole("tab", { name: "Apple Wallet" }).click();
  await expect(preview.locator(".builder-preview-canvas img")).toBeVisible();
  await expect(preview.locator(".builder-preview-status")).toHaveCount(0);
  await preview.screenshot({
    path: `${evidenceDirectory}/05-apple-preview.png`,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: "Google Wallet" }).click();
  await expect(preview.locator(".builder-preview-canvas img")).toBeVisible();
  await expect(preview.locator(".builder-preview-status")).toHaveCount(0);
  await preview.screenshot({
    path: `${evidenceDirectory}/06-google-preview.png`,
    animations: "disabled",
  });

  await page
    .getByRole("button", { name: /^Appearance/u })
    .first()
    .click();
  await expect(page.locator(".studio-asset-current")).toHaveCount(2);
  await expect
    .poll(() =>
      page
        .locator(".studio-asset-current img")
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true);
  await page.locator(".builder-editor").screenshot({
    path: `${evidenceDirectory}/07-appearance-assets.png`,
    animations: "disabled",
  });

  await page.getByRole("button", { name: "Review card" }).click();
  await expect(page.getByText("Readiness checks passed", { exact: true }).first()).toBeVisible();
  await page.locator(".builder-editor").screenshot({
    path: `${evidenceDirectory}/08-readiness-valid.png`,
    animations: "disabled",
  });

  await page.setViewportSize({ width: 1024, height: 860 });
  await page.getByRole("button", { name: "Start Test Mode" }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 1_000));
  await page.screenshot({
    path: `${evidenceDirectory}/09-tablet-no-overlap.png`,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 780 });
  await page.getByRole("button", { name: "Start Test Mode" }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 1_000));
  await page.screenshot({
    path: `${evidenceDirectory}/10-mobile-390-no-overlap.png`,
    animations: "disabled",
  });

  await page.goto("/ar/dashboard/programs/created-program-id/edit");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /اللغات/u }).click();
  await page.getByRole("tab", { name: "English" }).click();
  const mixedDirectionTitle = page.getByLabel("Card name");
  await mixedDirectionTitle.fill(
    "Classic Roast loyalty card with a long English name inside the Arabic interface",
  );
  await mixedDirectionTitle.press("Tab");
  await expect.poll(() => mixedDirectionTitle.evaluate((input) => input.scrollLeft)).toBe(0);
  await page.screenshot({
    path: `${evidenceDirectory}/11-arabic-mobile-mixed-language.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("tab", { name: /العربية/u }).click();
  await page.screenshot({
    path: `${evidenceDirectory}/12-arabic-desktop.png`,
    fullPage: true,
    animations: "disabled",
  });

  const apple = await sharp(`${evidenceDirectory}/05-apple-preview.png`)
    .resize({ width: 430 })
    .png()
    .toBuffer();
  const google = await sharp(`${evidenceDirectory}/06-google-preview.png`)
    .resize({ width: 430 })
    .png()
    .toBuffer();
  const [appleMetadata, googleMetadata] = await Promise.all([
    sharp(apple).metadata(),
    sharp(google).metadata(),
  ]);
  const mappingHeight = Math.max(appleMetadata.height ?? 0, googleMetadata.height ?? 0);
  await sharp({
    create: { width: 900, height: mappingHeight + 96, channels: 4, background: "#FCFBFA" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="96"><text x="18" y="30" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#241916">Apple · storeCard fields + strip + QR + back reward</text><text x="468" y="30" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#241916">Google · class/object + points + image + QR</text><text x="18" y="62" font-family="Arial,sans-serif" font-size="14" fill="#625B57">No template-only motif or unsupported hero treatment</text><text x="468" y="62" font-family="Arial,sans-serif" font-size="14" fill="#625B57">No CSS-only modules beyond provider payload</text></svg>',
        ),
        left: 0,
        top: 0,
      },
      { input: apple, left: 12, top: 96 },
      { input: google, left: 458, top: 96 },
    ])
    .png()
    .toFile(`${evidenceDirectory}/13-wallet-mapping-evidence.png`);

  const currentPreview = await sharp(`${evidenceDirectory}/02-customer-preview-0-of-8.png`)
    .resize({ width: 600 })
    .png()
    .toBuffer();
  const currentMetadata = await sharp(currentPreview).metadata();
  await sharp({
    create: {
      width: 640,
      height: (currentMetadata.height ?? 0) + 72,
      channels: 4,
      background: "#FCFBFA",
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="72"><text x="20" y="44" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#241916">Current · shared renderer truth</text></svg>',
        ),
        left: 0,
        top: 0,
      },
      { input: currentPreview, left: 20, top: 72 },
    ])
    .png()
    .toFile(`${evidenceDirectory}/14-current-repair-contact-sheet.png`);
});
