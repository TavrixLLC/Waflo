import { mkdir } from "node:fs/promises";
import path from "node:path";
import { type BrowserContext, expect, type Page, type Route, test } from "@playwright/test";
import { mockTemplateGalleryApi, templateGalleryOrganizationId } from "./template-gallery-fixtures";

const evidenceDirectory = path.resolve("artifacts", "global-loyalty-localization");

async function capture(page: Page, filename: string, fullPage = true): Promise<void> {
  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(evidenceDirectory, filename),
    fullPage,
    animations: "disabled",
  });
}

function allTemplates(page: Page) {
  return page.locator('section[aria-labelledby="template-gallery-all-title"]');
}

async function enterBuilder(page: Page): Promise<void> {
  await page.goto("/en/dashboard/programs/new");
  await allTemplates(page)
    .getByRole("button", { name: "Preview: Classic Roast, all templates" })
    .click();
  await page
    .getByRole("dialog", { name: "Classic Roast" })
    .getByRole("button", { name: "Use this template" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Customize your loyalty card" }),
  ).toBeVisible();
}

async function addLanguage(page: Page, search: string, optionName: RegExp): Promise<void> {
  const picker = page.getByRole("combobox", { name: "Add language" });
  await picker.fill(search);
  await page.getByRole("option", { name: optionName }).click();
}

async function selectPreviewLocale(page: Page, locale: string): Promise<void> {
  const preview = page.locator(".builder-preview-desktop");
  const optionNames: Record<string, RegExp> = {
    en: /^English\b/u,
    ar: /^Arabic\b/u,
    fr: /^French\b/u,
    ja: /^Japanese\b/u,
    "ku-Arab-IQ": /^Kurdish \(Badini\)/u,
    ckb: /^Kurdish \(Sorani\)/u,
  };
  const optionName = optionNames[locale];
  if (!optionName) throw new Error(`Missing preview locale option mapping for ${locale}.`);
  await preview.locator(".builder-preview-language").getByRole("combobox").click();
  await page.getByRole("option", { name: optionName }).click();
  await expect(preview.locator(".builder-preview-canvas")).toHaveAttribute("lang", locale);
  await expect(preview.locator(".builder-preview-canvas")).toHaveAttribute("aria-busy", "false");
  const image = preview.locator(".builder-preview-canvas img");
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement, expectedLocale) => {
        if (!element.complete || element.naturalWidth <= 0) return false;
        const encodedSvg = element.currentSrc.split(",", 2)[1];
        if (!encodedSvg) return false;
        return decodeURIComponent(encodedSvg).includes(`<svg lang="${expectedLocale}"`);
      }, locale),
    )
    .toBe(true);
  await expect(preview.locator(".builder-preview-status")).toHaveCount(0);
}

async function selectPreviewProfile(page: Page, name: string): Promise<void> {
  const preview = page.locator(".builder-preview-desktop");
  await preview.getByRole("tab", { name }).click();
  await expect(preview.locator(".builder-preview-canvas")).toHaveAttribute("aria-busy", "false");
  const image = preview.locator(".builder-preview-canvas img");
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0),
    )
    .toBe(true);
}

async function fillCardLocale(
  page: Page,
  tabName: RegExp,
  cardName: string,
  shortDescription: string,
  patchCount: () => number,
): Promise<void> {
  const patchesBeforeEdit = patchCount();
  await page.getByRole("tab", { name: tabName }).click();
  const panel = page.locator(".builder-language-panel");
  await panel.locator("input").nth(0).fill(cardName);
  await panel.locator("input").nth(1).fill(shortDescription);
  await expect.poll(patchCount).toBeGreaterThan(patchesBeforeEdit);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

test("captures dynamic worldwide card languages and provider previews", async ({ page }) => {
  test.setTimeout(180_000);
  const patches: Record<string, unknown>[] = [];
  const merchantLogo = `data:image/svg+xml;base64,${Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="22" fill="#125B72"/><path d="M20 50h56M48 22v56" stroke="#F8E3B1" stroke-width="10"/></svg>',
    "utf8",
  ).toString("base64")}`;
  await mockTemplateGalleryApi(page, {
    merchantBrandLogoDataUri: merchantLogo,
    onPatch: (body) => patches.push(body),
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterBuilder(page);

  await expect(page.getByRole("combobox", { name: "Default language" })).toHaveValue(/English/u);
  await expect(
    page.getByRole("list", { name: "Enabled languages" }).getByRole("listitem"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("list", { name: "Enabled languages" }).getByRole("button", { name: "Remove" }),
  ).toBeDisabled();
  await selectPreviewLocale(page, "en");
  await capture(page, "card-languages-step-default-en.png");

  const picker = page.getByRole("combobox", { name: "Add language" });
  await picker.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(page.getByRole("listbox").getByText("Popular", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("listbox").getByText("All languages", { exact: true })).toHaveCount(
    1,
  );
  await capture(page, "card-language-picker-global.png");
  await page.keyboard.press("Escape");

  await addLanguage(page, "Arabic", /^Arabic\b/u);
  await addLanguage(page, "Français", /^French\b/u);
  await expect
    .poll(() =>
      patches.some(
        (body) =>
          Array.isArray(body.enabledLocales) &&
          ["en", "ar", "fr"].every((locale) => body.enabledLocales.includes(locale)),
      ),
    )
    .toBe(true);
  await capture(page, "card-languages-en-ar-fr.png");

  await addLanguage(page, "日本語", /^Japanese\b/u);
  await addLanguage(page, "Badini", /^Kurdish \(Badini\)/u);
  await addLanguage(page, "Sorani", /^Kurdish \(Sorani\)/u);
  await expect(
    page.getByRole("list", { name: "Enabled languages" }).getByRole("listitem"),
  ).toHaveCount(6);

  const defaultPicker = page.getByRole("combobox", { name: "Default language" });
  await defaultPicker.fill("French");
  await page.getByRole("option", { name: /^French\b/u }).click();
  const frenchRow = page
    .getByRole("list", { name: "Enabled languages" })
    .getByRole("listitem")
    .filter({ hasText: "French" });
  await expect(frenchRow.getByText("Default", { exact: true })).toBeVisible();
  await expect(frenchRow.getByRole("button", { name: "Remove" })).toBeDisabled();

  await page
    .getByRole("list", { name: "Enabled languages" })
    .getByRole("listitem")
    .filter({ hasText: "Japanese" })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.getByRole("tab", { name: /日本語/u })).toHaveCount(0);
  await addLanguage(page, "Japanese", /^Japanese\b/u);

  await fillCardLocale(
    page,
    /العربية/u,
    "بطاقة مكافآت القهوة",
    "اجمع الأختام واحصل على مكافأتك",
    () => patches.length,
  );
  await fillCardLocale(
    page,
    /français/u,
    "Carte Café Fidélité",
    "Collectionnez des tampons.",
    () => patches.length,
  );
  await fillCardLocale(
    page,
    /日本語/u,
    "コーヒー特典カード",
    "スタンプを集めて特典を獲得",
    () => patches.length,
  );
  await fillCardLocale(
    page,
    /کوردی بادینی/u,
    "کارتا خەلاتێن قاوەیێ",
    "مۆران کۆم بکە و خەلاتا خو وەرگرە",
    () => patches.length,
  );
  await fillCardLocale(
    page,
    /کوردی سۆرانی/u,
    "کارتی خەڵاتی قاوە",
    "مۆرەکان کۆبکەرەوە و خەڵاتەکەت وەربگرە",
    () => patches.length,
  );
  await selectPreviewLocale(page, "ar");
  await expect(page.locator(".builder-preview-desktop .builder-preview-canvas")).toHaveAttribute(
    "dir",
    "rtl",
  );
  await capture(page, "builder-interface-en-preview-ar.png");

  await page.goto("/ar/dashboard/programs/created-program-id/edit");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await selectPreviewLocale(page, "en");
  await expect(page.locator(".builder-preview-desktop .builder-preview-canvas")).toHaveAttribute(
    "dir",
    "ltr",
  );
  await capture(page, "builder-interface-ar-preview-en.png");

  await page.goto("/en/dashboard/programs/created-program-id/edit");
  for (const [locale, filename, direction] of [
    ["fr", "builder-preview-fr.png", "ltr"],
    ["ja", "builder-preview-ja.png", "ltr"],
    ["ku-Arab-IQ", "builder-preview-ku-badini.png", "rtl"],
    ["ckb", "builder-preview-ku-sorani.png", "rtl"],
  ] as const) {
    await selectPreviewLocale(page, locale);
    await expect(page.locator(".builder-preview-desktop .builder-preview-canvas")).toHaveAttribute(
      "dir",
      direction,
    );
    await page.locator(".builder-preview-desktop").screenshot({
      path: path.join(evidenceDirectory, filename),
      animations: "disabled",
    });
  }

  await page.getByRole("button", { name: "Review card" }).click();
  await expect(page.getByRole("heading", { name: "Languages" })).toBeVisible();
  await capture(page, "review-language-completeness.png");

  await selectPreviewProfile(page, "Apple Wallet");
  await page.locator(".builder-preview-desktop").screenshot({
    path: path.join(evidenceDirectory, "apple-multilocale-preview.png"),
    animations: "disabled",
  });
  await selectPreviewProfile(page, "Google Wallet");
  await page.locator(".builder-preview-desktop").screenshot({
    path: path.join(evidenceDirectory, "google-multilocale-preview.png"),
    animations: "disabled",
  });

  for (const [locale, filenames] of [
    ["en", ["google-wallet-preview-en-full-color.png"]],
    ["ar", ["google-wallet-preview-ar-fixed.png", "google-wallet-preview-ar-full-color.png"]],
    ["ku-Arab-IQ", ["google-wallet-preview-badini-full-color.png"]],
    ["ckb", ["google-wallet-preview-sorani-full-color.png"]],
  ] as const) {
    await selectPreviewLocale(page, locale);
    for (const filename of filenames) {
      await page.locator(".builder-preview-desktop").screenshot({
        path: path.join(evidenceDirectory, filename),
        animations: "disabled",
      });
    }
  }
});

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data, requestId: "global-card-language-visual" }),
  });
}

test("persists an enabled-only customer card language choice", async ({ page }) => {
  const translations = {
    en: {
      name: "Gallery Coffee Rewards",
      description: "Collect stamps for your next coffee.",
      rewardSummary: "A coffee on us",
    },
    ar: {
      name: "بطاقة مكافآت قهوة غاليري",
      description: "اجمع الأختام لتحصل على قهوتك التالية.",
      rewardSummary: "قهوة مجانية",
    },
    fr: {
      name: "Récompenses Café Galerie",
      description: "Collectionnez des tampons pour votre prochain café.",
      rewardSummary: "Un café offert",
    },
  } as const;
  await page.route("**/v1/customer/card/mem_visual**", async (route) => {
    const requested = new URL(route.request().url()).searchParams.get("locale");
    const locale = requested === "ar" || requested === "fr" ? requested : "en";
    await fulfill(route, {
      publicMembershipId: "mem_visual",
      customer: { displayName: "Visual Customer", preferredLocale: "en", maskedEmail: null },
      merchant: { name: "Gallery Coffee", slug: "gallery-coffee" },
      program: {
        defaultLocale: "en",
        enabledLocales: ["en", "ar", "fr"],
        contentLocale: locale,
        ...translations[locale],
        pausedMessage: null,
      },
      membership: {
        status: "ACTIVE",
        credentialStatus: "ACTIVE",
        state: "ACTIVE",
        enrolledAt: "2026-08-20T10:00:00.000Z",
      },
      progress: {
        currentCycleStampCount: 4,
        completedCycleCount: 0,
        rewardReady: false,
        goal: 8,
        stamps: ["FILLED", "FILLED", "FILLED", "FILLED", "EMPTY", "EMPTY", "EMPTY", "EMPTY"],
        render: {
          dataUri:
            "data:image/svg+xml;base64," +
            Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg" width="520" height="180"><rect width="520" height="180" rx="22" fill="#FFF8EE"/><text x="260" y="105" text-anchor="middle" font-size="46" fill="#4A2818">4 / 8</text></svg>',
            ).toString("base64"),
          contentDigest: "visual",
          configurationDigest: "visual",
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
        apple: { mode: "DISABLED", status: "UNAVAILABLE", testAdapter: false, safeErrorCode: null },
        google: {
          mode: "DISABLED",
          status: "UNAVAILABLE",
          testAdapter: false,
          safeErrorCode: null,
        },
      },
      transfer: {
        allowed: true,
        emailConfirmationRequired: false,
        transferWithoutEmailAllowed: true,
      },
    });
  });

  await page.goto("http://localhost:3002/card/mem_visual");
  await expect(page.getByRole("heading", { name: translations.en.name })).toBeVisible();
  const picker = page.getByRole("combobox", { name: "Card content language" });
  await picker.click();
  await expect(page.getByRole("option")).toHaveCount(3);
  await capture(page, "customer-card-language-picker.png");
  await picker.fill("Arabic");
  await page.getByRole("option", { name: /^Arabic\b/u }).click();
  await expect(page.getByRole("heading", { name: translations.ar.name })).toBeVisible();
  await expect(page.locator(".digital-card")).toHaveAttribute("dir", "rtl");
  await capture(page, "customer-card-ar.png");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("waflo:card-locale:mem_visual")))
    .toBe("ar");

  await page.getByRole("combobox", { name: "Card content language" }).fill("French");
  await page.getByRole("option", { name: /^French\b/u }).click();
  await expect(page.getByRole("heading", { name: translations.fr.name })).toBeVisible();
  await expect(page.locator(".digital-card")).toHaveAttribute("dir", "ltr");
  await capture(page, "customer-card-fr.png");
  await page.reload();
  await expect(page.getByRole("heading", { name: translations.fr.name })).toBeVisible();
});

function overviewProgram(
  status: string,
  options: { draft?: boolean; published?: boolean } = {},
): Record<string, unknown> {
  return {
    id: `overview-${status.toLocaleLowerCase("en-US")}`,
    internalName: "Gallery Rewards",
    status,
    updatedAt: "2026-08-20T10:00:00.000Z",
    currentDraftVersion: options.draft
      ? { id: "draft", versionNumber: 2, revision: 1, status: "DRAFT", editingMode: "QUICK" }
      : null,
    currentPublishedVersion: options.published
      ? {
          id: "published",
          versionNumber: 1,
          status: "PUBLISHED",
          publishedAt: "2026-08-19T10:00:00.000Z",
        }
      : null,
    _count: { versions: Number(options.draft) + Number(options.published) },
  };
}

async function overviewCapture(
  context: BrowserContext,
  filename: string,
  programs: Record<string, unknown>[],
): Promise<void> {
  const page = await context.newPage();
  await mockTemplateGalleryApi(page, { existingPrograms: programs });
  await page.goto("/en/dashboard");
  await expect(page.locator(".overview-next")).toBeVisible();
  await capture(page, filename);
  await page.close();
}

test("captures organization branding, optional onboarding logo, and truthful Overview states", async ({
  context,
}) => {
  const merchantLogo = `data:image/svg+xml;base64,${Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="24" fill="#125B72"/><circle cx="48" cy="48" r="20" fill="#F8E3B1"/></svg>',
  ).toString("base64")}`;
  const version = {
    id: "brand-version",
    versionNumber: 1,
    revision: 1,
    status: "DRAFT",
    editingMode: "QUICK",
    publishedAt: null,
    translations: [
      { locale: "EN", programName: "Gallery Coffee Card", rewardSummary: "A coffee on us" },
      { locale: "AR", programName: "بطاقة قهوة غاليري", rewardSummary: "قهوة مجانية" },
    ],
    stampRule: { requiredStampCount: 8 },
    visualTheme: {
      backgroundColor: "#FFF8EE",
      foregroundColor: "#4A2818",
      accentColor: "#C2410C",
      secondaryColor: "#F59E0B",
      mutedColor: "#78716C",
    },
  };
  const card = {
    id: "branded-card",
    internalName: "Gallery Coffee Card",
    status: "DRAFT",
    updatedAt: "2026-08-20T10:00:00.000Z",
    currentDraftVersion: version,
    currentPublishedVersion: null,
    _count: { versions: 1 },
  };

  for (const locale of ["en", "ar"] as const) {
    const page = await context.newPage();
    await mockTemplateGalleryApi(page, {
      existingPrograms: [card],
      merchantBrandLogoDataUri: merchantLogo,
    });
    await page.goto(`/${locale}/dashboard/programs`);
    await expect(page.locator(".loyalty-card-real-preview__brand-badge img")).toBeVisible();
    await capture(page, `loyalty-list-merchant-logo-desktop-${locale}.png`);
    await page.close();
  }

  const onboarding = await context.newPage();
  await mockTemplateGalleryApi(onboarding, { merchantBrandLogoDataUri: merchantLogo });
  await onboarding.goto(`/en/onboarding/business?organization=${templateGalleryOrganizationId}`);
  await expect(onboarding.getByRole("heading", { level: 2, name: "Merchant logo" })).toBeVisible();
  await capture(onboarding, "onboarding-logo-upload-desktop-en.png");
  await onboarding.setViewportSize({ width: 390, height: 844 });
  await expect(onboarding.getByRole("button", { name: "Skip for now" })).toBeVisible();
  await capture(onboarding, "onboarding-logo-skip-mobile-en.png");
  await onboarding.setViewportSize({ width: 1280, height: 900 });
  await onboarding.goto(`/ar/onboarding/business?organization=${templateGalleryOrganizationId}`);
  await expect(onboarding.locator("html")).toHaveAttribute("dir", "rtl");
  await capture(onboarding, "onboarding-logo-ar.png");
  await onboarding.close();

  await overviewCapture(context, "overview-zero-cards.png", []);
  await overviewCapture(context, "overview-draft-card.png", [
    overviewProgram("DRAFT", { draft: true }),
  ]);
  await overviewCapture(context, "overview-live-card.png", [
    overviewProgram("PUBLISHED", { published: true }),
  ]);
  await overviewCapture(context, "overview-live-unpublished.png", [
    overviewProgram("PUBLISHED", { draft: true, published: true }),
  ]);
  await overviewCapture(context, "overview-archived-only.png", [
    overviewProgram("ARCHIVED", { published: true }),
  ]);
});
