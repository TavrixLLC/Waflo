import { mkdir } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

const screenshotDirectory = "artifacts/handoff-w3-round-2/screenshots";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function connectPrisma() {
  const { createPrismaClient } = await import("../../packages/database/dist/src/client.js");
  return createPrismaClient();
}

async function screenshot(page: Page, name: string) {
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: `${screenshotDirectory}/${name}.png`,
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

test("captures the remaining W3 browser evidence and proves version pinning", async ({
  browser,
  page,
}) => {
  test.setTimeout(90_000);
  const prisma = await connectPrisma();
  let evidenceProgramId: string | undefined;
  try {
    const program = await prisma.loyaltyProgram.findFirstOrThrow({
      where: {
        organizationId,
        internalName: { startsWith: "W3 Browser Circle" },
        currentPublishedVersionId: { not: null },
        latestVersionNumber: 1,
      },
      orderBy: { createdAt: "desc" },
      include: { currentPublishedVersion: true },
    });
    evidenceProgramId = program.id;
    await prisma.loyaltyProgram.update({
      where: { id: program.id },
      data: { status: "PUBLISHED", archivedAt: null },
    });
    const originalVersionId = program.currentPublishedVersionId as string;
    const replacementVersionNumber = (program.currentPublishedVersion?.versionNumber ?? 1) + 1;
    const existingMembership = await prisma.membership.findFirstOrThrow({
      where: { programId: program.id, enrollmentProgramVersionId: originalVersionId },
      orderBy: { createdAt: "asc" },
    });

    await page.goto(`http://localhost:3002/join/${program.publicSlug}?tenant=today`);
    await page.getByLabel("Name on card").fill("Optional Email Evidence");
    await page.getByLabel("Email").fill("optional-email@example.test");
    await screenshot(page, "07-optional-email-enrollment");

    const transferContext = await browser.newContext();
    const transferPage = await transferContext.newPage();
    await transferPage.goto("http://localhost:3002/transfer?tenant=today");
    await expect(
      transferPage.getByRole("heading", { name: "Move your loyalty card safely" }),
    ).toBeVisible();
    await screenshot(transferPage, "19-transfer-entry-options");
    await transferPage.locator('input[type="file"]').setInputFiles({
      name: "not-a-qr.png",
      mimeType: "image/png",
      buffer: Buffer.from("not a QR image"),
    });
    await expect(transferPage.getByRole("alert")).toBeVisible();
    await screenshot(transferPage, "33-accessible-error-state");
    await transferContext.close();

    await page.goto(`http://localhost:3002/join/${program.publicSlug}?tenant=today`);
    await page.getByLabel("Language").selectOption("ar");
    await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
    await page.getByRole("textbox").nth(0).fill("عضو عربي");
    await page.locator('input[type="checkbox"]').nth(0).check();
    await page.locator('input[type="checkbox"]').nth(1).check();
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('a[href^="/card/"]')).toBeVisible();
    await page.locator('a[href^="/card/"]').click();
    await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
    await screenshot(page, "32-arabic-customer-card");

    await login(page);
    await page.goto("http://localhost:3001/en/dashboard/programs");
    const card = page.locator(".program-list__card").filter({ hasText: program.internalName });
    await card.getByRole("button", { name: "Open card" }).click();
    await screenshot(page, "31-wallet-setup-page");
    await page.getByRole("button", { name: "Create draft from live card" }).click();
    await expect(
      page.getByText(new RegExp(`LOYALTY STUDIO.*v${replacementVersionNumber}`)),
    ).toBeVisible();

    const withDraft = await prisma.loyaltyProgram.findUniqueOrThrow({
      where: { id: program.id },
      select: { currentDraftVersionId: true },
    });
    const replacementVersionId = withDraft.currentDraftVersionId as string;
    await prisma.$transaction([
      prisma.loyaltyProgramVersion.update({
        where: { id: originalVersionId },
        data: { status: "SUPERSEDED", supersededAt: new Date() },
      }),
      prisma.loyaltyProgramVersion.update({
        where: { id: replacementVersionId },
        data: { status: "PUBLISHED", publishedAt: new Date() },
      }),
      prisma.loyaltyProgram.update({
        where: { id: program.id },
        data: {
          status: "PUBLISHED",
          currentDraftVersionId: null,
          currentPublishedVersionId: replacementVersionId,
          publishedAt: new Date(),
        },
      }),
    ]);

    await page.goto("http://localhost:3001/en/dashboard/programs");
    const updatedCard = page
      .locator(".program-list__card")
      .filter({ hasText: program.internalName });
    await updatedCard.getByRole("button", { name: "Open card" }).click();
    await expect(
      page.getByText(new RegExp(`LOYALTY STUDIO.*v${replacementVersionNumber}`)),
    ).toBeVisible();
    await expect(page.locator(".studio-version-history")).toContainText("v1");
    await expect(page.locator(".studio-version-history")).toContainText("SUPERSEDED");
    await screenshot(page, "29-version-pinned-existing-membership");
    await expect(
      prisma.membership.findUnique({
        where: { id: existingMembership.id },
        select: { enrollmentProgramVersionId: true },
      }),
    ).resolves.toEqual({ enrollmentProgramVersionId: originalVersionId });

    const beforeEnrollment = new Date();
    await page.goto(`http://localhost:3002/join/${program.publicSlug}?tenant=today`);
    await page.getByLabel("Name on card").fill("Replacement Version Member");
    await page.getByLabel(new RegExp(`I accept the ${program.internalName}`)).check();
    await page.getByLabel(/I accept the Waflo privacy notice/).check();
    await page.getByRole("button", { name: "Create my card" }).click();
    await page.locator('a[href^="/card/"]').click();
    await expect(page.getByRole("heading", { name: program.internalName })).toBeVisible();
    await screenshot(page, "30-new-version-enrollment");
    await expect(
      prisma.membership.findFirst({
        where: {
          programId: program.id,
          enrolledAt: { gte: beforeEnrollment },
        },
        orderBy: { enrolledAt: "desc" },
        select: { enrollmentProgramVersionId: true },
      }),
    ).resolves.toEqual({ enrollmentProgramVersionId: replacementVersionId });
  } finally {
    if (evidenceProgramId) {
      await prisma.loyaltyProgram.update({
        where: { id: evidenceProgramId },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });
    }
    await prisma.$disconnect();
  }
});
