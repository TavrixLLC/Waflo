import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function expectAccessible(page: import("@playwright/test").Page) {
  const result = await new AxeBuilder({ page }).analyze();
  const blocking = result.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(
    blocking,
    blocking.map((violation) => `${violation.id}: ${violation.description}`).join("\n"),
  ).toEqual([]);
}

test("W3 public enrollment, RTL, privacy, transfer, and unavailable states are accessible", async ({
  page,
}) => {
  const { createPrismaClient } = await import("../../packages/database/dist/src/client.js");
  const prisma = createPrismaClient();
  const program = await prisma.loyaltyProgram.findFirstOrThrow({
    where: {
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      internalName: { startsWith: "W3 Browser Circle" },
      status: "PUBLISHED",
    },
    orderBy: { createdAt: "desc" },
  });
  try {
    for (const url of [
      "http://localhost:3002/?tenant=today",
      `http://localhost:3002/join/${program.publicSlug}?tenant=today`,
      `http://localhost:3002/join/${program.publicSlug}?tenant=today&lang=ar`,
      "http://localhost:3002/privacy?tenant=today",
      "http://localhost:3002/transfer?tenant=today",
    ]) {
      await page.goto(url);
      await expectAccessible(page);
      await page.keyboard.press("Tab");
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.tagName))
        .not.toBe("BODY");
    }
  } finally {
    await prisma.$disconnect();
  }
});
