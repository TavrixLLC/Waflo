import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("Marketing home, pricing, and RTL pages have no serious accessibility violations", async ({
  page,
}) => {
  for (const url of [
    "http://localhost:3000/en",
    "http://localhost:3000/en/pricing",
    "http://localhost:3000/ar/pricing",
  ]) {
    await page.goto(url);
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    expect(blocking).toEqual([]);
  }
});
