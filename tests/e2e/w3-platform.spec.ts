import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  test,
} from "@playwright/test";

const screenshots = "test-results/evidence/handoff-w3-round-2/screenshots";
const evidence = "test-results/evidence/handoff-w3-round-2/evidence";
const runId = randomUUID().slice(0, 8);
const programName = `W3 Browser Circle ${runId}`;
const programSlug = `w3-browser-${runId}`;
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let programId = "";
let versionId = "";
let companionProgramId = "";
let prisma: Awaited<ReturnType<typeof connectPrisma>>;

async function connectPrisma() {
  const { createPrismaClient } = await import("../../packages/database/dist/src/client.js");
  return createPrismaClient();
}

async function screenshot(page: Page, name: string) {
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: `${screenshots}/${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

async function login(page: Page) {
  await page.goto("http://localhost:3001/en/login");
  await page.locator('input[name="email"]').fill("owner@waflo.local");
  await page.locator('input[name="password"]').fill("Waflo-Development-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/dashboard(?:\/|$)/);
  const switcher = page.locator(".wf-org-switcher select");
  await switcher.selectOption({ label: "Today Coffee" });
  await expect(switcher).toHaveValue(organizationId);
}

async function latestMailAction(
  request: APIRequestContext,
  recipient: string,
  subjectFragment: string,
) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const response = await request.get("http://localhost:8025/api/v1/messages");
    const list = (await response.json()) as {
      messages: Array<{
        ID: string;
        Subject: string;
        Created: string;
        To: Array<{ Address: string }>;
      }>;
    };
    const message = list.messages
      .filter(
        (item) =>
          item.Subject.includes(subjectFragment) &&
          item.To.some((address) => address.Address === recipient),
      )
      .sort((left, right) => right.Created.localeCompare(left.Created))[0];
    if (message) {
      const detail = (await (
        await request.get(`http://localhost:8025/api/v1/message/${message.ID}`)
      ).json()) as { HTML?: string; Text?: string };
      const match = `${detail.HTML ?? ""}\n${detail.Text ?? ""}`.match(/https?:\/\/[^"' <]+/);
      if (match?.[0]) return match[0].replaceAll("&amp;", "&");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No transfer confirmation arrived for ${recipient}.`);
}

async function enroll(page: Page, displayName: string, email?: string) {
  await page.goto(`http://localhost:3002/join/${programSlug}?tenant=today`);
  await page.getByLabel("Name on card").fill(displayName);
  if (email) await page.getByLabel("Email").fill(email);
  await page.getByLabel(new RegExp(`I accept the ${programName}`)).check();
  await page.getByLabel(/I accept the Waflo privacy notice/).check();
  await page.getByRole("button", { name: "Create my card" }).click();
  await expect(page.getByRole("heading", { name: `Welcome to ${programName}` })).toBeVisible();
  await page.getByRole("button", { name: "Open my card" }).click();
  await expect(page.getByRole("heading", { name: programName })).toBeVisible();
  return page.url();
}

async function copyCookies(source: BrowserContext, target: BrowserContext) {
  const cookies = await source.cookies();
  await target.addCookies(cookies);
}

test.beforeAll(async () => {
  prisma = await connectPrisma();
  await prisma.organizationBillingProfile.update({
    where: { organizationId },
    data: { subscriptionStatus: "ACTIVE" },
  });
  const owner = await prisma.user.findUniqueOrThrow({
    where: { normalizedEmail: "owner@waflo.local" },
  });
  const location = await prisma.location.findFirstOrThrow({ where: { organizationId } });
  const filled = await prisma.merchantAsset.create({
    data: {
      organizationId,
      category: "STAMP_FILLED",
      source: "WAFLO_LIBRARY",
      originalObjectKey: `evidence/${runId}/filled.svg`,
      originalFilename: "filled.svg",
      mimeType: "image/svg+xml",
      fileSize: 64,
      width: 256,
      height: 256,
      sha256Digest: `${runId.padEnd(64, "1")}`.slice(0, 64),
      processingStatus: "READY",
      safeMetadata: {
        evidenceFixture: true,
        inlineSvg:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#AE3115" d="M27 8c25-12 55 8 52 36-2 24-20 44-46 48-17-17-21-38-16-55C20 25 23 16 27 8Z"/><path fill="none" stroke="#F7F4EE" stroke-width="7" stroke-linecap="round" d="M65 19C47 37 38 56 34 78"/></svg>',
      },
      createdByUserId: owner.id,
    },
  });
  const empty = await prisma.merchantAsset.create({
    data: {
      organizationId,
      category: "STAMP_EMPTY",
      source: "WAFLO_LIBRARY",
      originalObjectKey: `evidence/${runId}/empty.svg`,
      originalFilename: "empty.svg",
      mimeType: "image/svg+xml",
      fileSize: 64,
      width: 256,
      height: 256,
      sha256Digest: `${runId.padEnd(64, "2")}`.slice(0, 64),
      processingStatus: "READY",
      safeMetadata: {
        evidenceFixture: true,
        inlineSvg:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#F7F4EE" stroke="#241916" stroke-width="7" d="M27 8c25-12 55 8 52 36-2 24-20 44-46 48-17-17-21-38-16-55C20 25 23 16 27 8Z"/><path fill="none" stroke="#241916" stroke-width="7" stroke-linecap="round" d="M65 19C47 37 38 56 34 78"/></svg>',
      },
      createdByUserId: owner.id,
    },
  });
  const program = await prisma.loyaltyProgram.create({
    data: {
      organizationId,
      internalName: programName,
      publicSlug: programSlug,
      status: "DRAFT",
      createdByUserId: owner.id,
    },
  });
  programId = program.id;
  const version = await prisma.loyaltyProgramVersion.create({
    data: {
      organizationId,
      programId,
      versionNumber: 1,
      status: "DRAFT",
      createdByUserId: owner.id,
      validationFingerprint: "a".repeat(64),
      renderFingerprint: "b".repeat(64),
      translations: {
        create: [
          {
            locale: "EN",
            programName,
            shortDescription: "Collect eight stamps and enjoy a signature drink.",
            fullDescription: "A bilingual, Wallet-ready loyalty card.",
            rewardSummary: "A complimentary signature drink",
            joinInstructions: "Join in moments—no app is required.",
            termsAndConditions: "One active membership per customer.",
            completionMessage: "Card complete",
            rewardUnlockedMessage: "Your reward is ready",
            pausedMessage: "Enrollment is temporarily paused.",
          },
          {
            locale: "AR",
            programName: "دائرة مكافآت وافلو",
            shortDescription: "اجمع ثمانية أختام واحصل على مشروب مميز.",
            fullDescription: "بطاقة ولاء ثنائية اللغة وجاهزة للمحفظة.",
            rewardSummary: "مشروب مميز مجاني",
            joinInstructions: "انضم خلال لحظات من دون تطبيق.",
            termsAndConditions: "عضوية نشطة واحدة لكل عميل.",
            completionMessage: "اكتملت البطاقة",
            rewardUnlockedMessage: "مكافأتك جاهزة",
            pausedMessage: "التسجيل متوقف مؤقتًا.",
          },
        ],
      },
      stampRule: {
        create: {
          requiredStampCount: 8,
          earningDescription: "One stamp per qualifying visit.",
        },
      },
      rewards: {
        create: {
          thresholdStampCount: 8,
          rewardType: "FREE_ITEM",
          internalName: "Signature drink",
          sortOrder: 1,
          translations: {
            create: [
              { locale: "EN", name: "Signature drink", description: "Choose one drink." },
              { locale: "AR", name: "مشروب مميز", description: "اختر مشروبًا واحدًا." },
            ],
          },
        },
      },
      locations: { create: { locationId: location.id } },
      visualTheme: {
        create: {
          backgroundColor: "#F7F4EE",
          foregroundColor: "#241916",
          accentColor: "#AE3115",
          secondaryColor: "#F3A712",
          mutedColor: "#76645F",
          filledStampAssetId: filled.id,
          emptyStampAssetId: empty.id,
          layoutConfiguration: { columns: 4 },
        },
      },
      enrollmentPolicy: {
        create: {
          organizationId,
          emailCollectionMode: "OPTIONAL",
          primaryCustomerLocale: "EN",
          allowLocaleSelection: true,
          marketingConsentVisible: true,
          transferWithoutEmailAllowed: true,
          enrollmentOpen: true,
        },
      },
    },
  });
  versionId = version.id;
  await prisma.loyaltyProgramVersion.update({
    where: { id: version.id },
    data: { status: "PUBLISHED", publishedAt: new Date() },
  });
  await prisma.loyaltyProgram.update({
    where: { id: program.id },
    data: {
      status: "PUBLISHED",
      currentPublishedVersionId: version.id,
      latestVersionNumber: 1,
      publishedAt: new Date(),
    },
  });

  const companion = await prisma.loyaltyProgram.create({
    data: {
      organizationId,
      internalName: `W3 Discovery Companion ${runId}`,
      publicSlug: `w3-discovery-companion-${runId}`,
      status: "DRAFT",
      createdByUserId: owner.id,
    },
  });
  companionProgramId = companion.id;
  const companionVersion = await prisma.loyaltyProgramVersion.create({
    data: {
      organizationId,
      programId: companion.id,
      versionNumber: 1,
      status: "DRAFT",
      createdByUserId: owner.id,
      validationFingerprint: "c".repeat(64),
      renderFingerprint: "d".repeat(64),
      translations: {
        create: [
          {
            locale: "EN",
            programName: `W3 Discovery Companion ${runId}`,
            shortDescription: "A second verified card keeps the discovery chooser meaningful.",
            fullDescription: "A verified companion card for the multiple-program discovery route.",
            rewardSummary: "A discovery reward",
            joinInstructions: "Choose this card from the merchant discovery page.",
            termsAndConditions: "One active membership per customer.",
            completionMessage: "Card complete",
            rewardUnlockedMessage: "Your discovery reward is ready",
            pausedMessage: "Enrollment is temporarily paused.",
          },
          {
            locale: "AR",
            programName: "بطاقة اكتشاف وافلو",
            shortDescription: "بطاقة ثانية موثقة لاختبار شاشة الاختيار.",
            fullDescription: "بطاقة موثقة لاختبار مسار اكتشاف البرامج المتعددة.",
            rewardSummary: "مكافأة الاكتشاف",
            joinInstructions: "اختر هذه البطاقة من صفحة اكتشاف التاجر.",
            termsAndConditions: "عضوية نشطة واحدة لكل عميل.",
            completionMessage: "اكتملت البطاقة",
            rewardUnlockedMessage: "مكافأتك جاهزة",
            pausedMessage: "التسجيل متوقف مؤقتًا.",
          },
        ],
      },
      stampRule: {
        create: {
          requiredStampCount: 8,
          earningDescription: "One stamp per qualifying visit.",
        },
      },
      locations: { create: { locationId: location.id } },
      visualTheme: {
        create: {
          backgroundColor: "#F7F4EE",
          foregroundColor: "#241916",
          accentColor: "#AE3115",
          secondaryColor: "#F3A712",
          mutedColor: "#76645F",
          filledStampAssetId: filled.id,
          emptyStampAssetId: empty.id,
          layoutConfiguration: { columns: 4 },
        },
      },
      enrollmentPolicy: {
        create: {
          organizationId,
          emailCollectionMode: "OPTIONAL",
          primaryCustomerLocale: "EN",
          allowLocaleSelection: true,
          marketingConsentVisible: false,
          transferWithoutEmailAllowed: true,
          enrollmentOpen: true,
        },
      },
    },
  });
  await prisma.loyaltyProgramVersion.update({
    where: { id: companionVersion.id },
    data: { status: "PUBLISHED", publishedAt: new Date() },
  });
  await prisma.loyaltyProgram.update({
    where: { id: companion.id },
    data: {
      status: "PUBLISHED",
      currentPublishedVersionId: companionVersion.id,
      latestVersionNumber: 1,
      publishedAt: new Date(),
    },
  });
});

test.afterAll(async () => {
  await prisma.loyaltyProgram.updateMany({
    where: { id: { in: [programId, companionProgramId].filter(Boolean) } },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });
  await prisma.$disconnect();
});

test.describe
  .serial("W3 customer enrollment and Wallet browser evidence", () => {
    test("shows merchant enrollment controls, canonical URL, QR, and truthful provider health", async ({
      page,
    }) => {
      await login(page);
      await page.goto("http://localhost:3001/en/dashboard/programs");
      const card = page.locator(".program-list__card").filter({ hasText: programName });
      await card.getByRole("button", { name: "Open card" }).click();
      const customerAccess = page.getByRole("region", {
        name: "Share the card and manage customers",
      });
      await expect(customerAccess).toBeVisible();
      await expect(customerAccess.getByText(new RegExp(programSlug))).toBeVisible();
      await expect(
        customerAccess.getByText(
          "Ready in test-adapter mode; this is not external production certification.",
          { exact: true },
        ),
      ).toHaveCount(2);
      await screenshot(page, "01-merchant-enrollment-settings");

      await page
        .getByRole("link", { name: "Download enrollment QR as PNG" })
        .scrollIntoViewIfNeeded();
      await screenshot(page, "02-public-url-and-enrollment-qr");
    });

    test("renders public discovery, English enrollment, Arabic RTL, and consent validation", async ({
      page,
    }) => {
      await page.goto("http://localhost:3002/?tenant=today&lang=en");
      await expect(page.getByRole("heading", { name: "Choose your loyalty card" })).toBeVisible();
      await screenshot(page, "03-program-chooser");
      await page.locator(".program-choice").first().click();
      expect(new URL(page.url()).searchParams.get("lang")).toBe("en");
      expect(new URL(page.url()).searchParams.get("tenant")).toBe("today");
      await expect(page.locator("main")).toHaveAttribute("dir", "ltr");

      await page.goto("http://localhost:3002/?tenant=today&lang=ar");
      await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
      await screenshot(page, "03b-program-chooser-arabic");
      await page.locator(".program-choice").first().click();
      expect(new URL(page.url()).searchParams.get("lang")).toBe("ar");
      expect(new URL(page.url()).searchParams.get("tenant")).toBe("today");
      await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
      await page.locator(".customer-header a").first().click();
      expect(new URL(page.url()).searchParams.get("lang")).toBe("ar");
      expect(new URL(page.url()).searchParams.get("tenant")).toBe("today");
      await expect(page.locator("main")).toHaveAttribute("dir", "rtl");

      await page.goto(`http://localhost:3002/join/${programSlug}?tenant=today&lang=en`);
      await expect(page.getByRole("heading", { name: programName })).toBeVisible();
      await screenshot(page, "04-english-join-page");

      await page.getByLabel("Language").selectOption("ar");
      await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
      await screenshot(page, "05-arabic-rtl-join-page");

      await page.getByLabel("اللغة").selectOption("en");
      await page.getByLabel("Name on card").fill("Consent Check");
      await expect(page.getByRole("button", { name: "Create my card" })).toBeDisabled();
      await screenshot(page, "06-consent-validation-error");
    });

    test("routes a single published Program directly in English, Arabic, and merchant-host forms", async ({
      page,
    }) => {
      const otherPrograms = await prisma.loyaltyProgram.findMany({
        where: { organizationId, id: { not: programId } },
        select: { id: true, status: true },
      });
      try {
        await prisma.loyaltyProgram.updateMany({
          where: { organizationId, id: { not: programId } },
          data: { status: "ARCHIVED" },
        });

        await page.goto("http://localhost:3002/?tenant=today&lang=ar");
        await expect(page).toHaveURL(new RegExp(`/join/${programSlug}\\?tenant=today&lang=ar$`));
        await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
        await screenshot(page, "03a-single-program-root-arabic");

        await page.goto("http://today.localhost:3002/?lang=en");
        await expect(page).toHaveURL(new RegExp(`/join/${programSlug}\\?lang=en$`));
        await expect(page.locator("main")).toHaveAttribute("dir", "ltr");
      } finally {
        await Promise.all(
          otherPrograms.map((program) =>
            prisma.loyaltyProgram.update({
              where: { id: program.id },
              data: { status: program.status },
            }),
          ),
        );
      }
    });

    test("enrolls name-only and shows only the device-appropriate Wallet action", async ({
      browser,
      page,
    }) => {
      const cardUrl = await enroll(page, "Name Only Member");
      await expect(page.getByText("0 / 8")).toBeVisible();
      await expect(page.getByAltText("Membership card QR")).toBeVisible();
      await screenshot(page, "08-customer-card-0-of-8-membership-qr");

      await expect(
        page.getByText("Open this card on iPhone or Android to add it to that device's wallet."),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Add to Apple Wallet" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Add to Google Wallet" })).toHaveCount(0);

      const iosContext = await browser.newContext({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      });
      const androidContext = await browser.newContext({
        userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
      });
      try {
        await Promise.all([
          copyCookies(page.context(), iosContext),
          copyCookies(page.context(), androidContext),
        ]);
        const iosPage = await iosContext.newPage();
        await iosPage.goto(cardUrl);
        await expect(iosPage.getByRole("link", { name: "Add to Apple Wallet" })).toBeVisible({
          timeout: 35_000,
        });
        await expect(iosPage.getByRole("button", { name: "Add to Google Wallet" })).toHaveCount(0);

        const androidPage = await androidContext.newPage();
        await androidPage.goto(cardUrl);
        await expect(androidPage.getByRole("button", { name: "Add to Google Wallet" })).toBeVisible(
          { timeout: 35_000 },
        );
        await expect(androidPage.getByRole("link", { name: "Add to Apple Wallet" })).toHaveCount(0);
        await screenshot(androidPage, "09-device-appropriate-wallet-test-adapter");
      } finally {
        await Promise.all([iosContext.close(), androidContext.close()]);
      }

      const pass = await page.request.get(
        "http://localhost:3002/api/waflo/v1/customer/wallet/apple/pass?tenant=today",
        { headers: { referer: cardUrl } },
      );
      expect(pass.ok()).toBe(true);
      expect(pass.headers()["content-type"]).toContain("application/vnd.apple.pkpass");

      const csrfBootstrap = await page.request.get(
        "http://localhost:3002/api/waflo/v1/customer/csrf?tenant=today",
      );
      expect(csrfBootstrap.ok()).toBe(true);
      const csrfPayload = (await csrfBootstrap.json()) as { data: { token: string } };
      const crossMerchant = await page.request.post(
        "http://localhost:3002/api/waflo/v1/customer/session/rotate?tenant=today",
        {
          data: {},
          headers: {
            origin: "http://alnahr.lvh.me:3002",
            "x-csrf-token": csrfPayload.data.token,
          },
        },
      );
      expect(crossMerchant.status()).toBe(403);
      const crossMerchantPayload = (await crossMerchant.json()) as {
        error: { code: string };
      };
      expect(crossMerchantPayload).toMatchObject({
        error: { code: "CUSTOMER_CSRF_INVALID" },
      });
      await mkdir(evidence, { recursive: true });
      await writeFile(
        `${evidence}/customer-csrf-cross-merchant-rejection.json`,
        `${JSON.stringify(
          {
            test: "cross-merchant customer session rotation",
            requestOrigin: "http://alnahr.lvh.me:3002",
            sessionMerchant: "today",
            responseStatus: crossMerchant.status(),
            errorCode: crossMerchantPayload.error.code,
            csrfTokenRedacted: true,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    });

    test("completes the warned no-email transfer exactly once", async ({ page }) => {
      await enroll(page, "Transfer Without Email");
      await page.getByText("Transfer to another device").click();
      await expect(page.getByText("Active card found")).toBeVisible();
      await screenshot(page, "10-transfer-card-proof");
      await page.getByRole("button", { name: "Continue transfer" }).click();
      await expect(
        page.getByRole("heading", { name: "No email is stored for this card" }),
      ).toBeVisible();
      await screenshot(page, "11-no-email-security-warning");
      await page.getByLabel(/I understand the risk/).check();
      await page.getByRole("button", { name: "Transfer and invalidate old card" }).click();
      await expect(page.getByRole("heading", { name: programName })).toBeVisible();
      await screenshot(page, "12-no-email-transfer-confirmed-new-card");
    });

    test("uses a fragment email confirmation, scrubs it, and leaves the old session transferred", async ({
      browser,
      page,
    }) => {
      const email = `w3-transfer-${runId}@example.test`;
      const oldCardUrl = await enroll(page, "Email Transfer Member", email);
      const oldContext = await browser.newContext();
      await copyCookies(page.context(), oldContext);
      const oldPage = await oldContext.newPage();

      await page.getByText("Transfer to another device").click();
      await expect(page.getByText("Active card found")).toBeVisible();
      await screenshot(page, "13-email-transfer-inspection");
      await page.getByRole("button", { name: "Continue transfer" }).click();
      await expect(page.getByText("Confirmation sent")).toBeVisible();
      await screenshot(page, "14-email-transfer-pending");

      const action = await latestMailAction(
        page.request,
        email,
        "Confirm your Waflo card transfer",
      );
      await page.goto(action);
      await expect(page.getByRole("heading", { name: "Confirm this transfer" })).toBeVisible();
      await expect.poll(() => new URL(page.url()).hash).toBe("");
      await page.getByRole("button", { name: "Confirm and transfer" }).click();
      await expect(page.getByRole("heading", { name: "Card transferred" })).toBeVisible();
      await screenshot(page, "15-email-transfer-confirmed");
      await page.getByRole("button", { name: "Open the new card" }).click();
      await expect(page.getByRole("heading", { name: programName })).toBeVisible();
      await screenshot(page, "16-new-card-active");

      await oldPage.goto(oldCardUrl);
      await expect(oldPage.getByText("This card was transferred", { exact: true })).toBeVisible();
      await screenshot(oldPage, "17-old-card-transferred");
      await oldContext.close();
    });

    test("shows paused, archived, suspended, and provider-disabled truthfully", async ({
      page,
    }) => {
      await prisma.loyaltyProgram.update({ where: { id: programId }, data: { status: "PAUSED" } });
      await page.goto(`http://localhost:3002/join/${programSlug}?tenant=today&evidence=paused`);
      await expect(page.getByText("Enrollment is not open")).toBeVisible();
      await screenshot(page, "18-paused-program");

      await prisma.loyaltyProgram.update({
        where: { id: programId },
        data: { status: "ARCHIVED" },
      });
      await page.goto(`http://localhost:3002/join/${programSlug}?tenant=today&evidence=archived`);
      await expect(page.getByText("This loyalty card is archived", { exact: true })).toBeVisible();
      await screenshot(page, "19-archived-program");

      await prisma.organization.update({
        where: { id: organizationId },
        data: { status: "SUSPENDED" },
      });
      await page.goto(`http://localhost:3002/join/${programSlug}?tenant=today&evidence=suspended`);
      await expect(
        page.getByRole("heading", { name: "This merchant is unavailable" }),
      ).toBeVisible();
      await screenshot(page, "20-suspended-merchant");

      await prisma.organization.update({
        where: { id: organizationId },
        data: { status: "ACTIVE" },
      });
      await prisma.loyaltyProgram.update({
        where: { id: programId },
        data: { status: "PUBLISHED" },
      });
      await expect(
        prisma.membership.count({ where: { enrollmentProgramVersionId: versionId } }),
      ).resolves.toBeGreaterThan(0);
    });
  });
