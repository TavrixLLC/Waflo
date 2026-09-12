import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { parseEnvironment } from "../packages/config/dist/index.js";
import { createPrismaClient } from "../packages/database/dist/src/index.js";
import { OperationalWorker } from "../apps/operational-worker/dist/main.js";

const dashboardOrigin = "http://localhost:3001";
const apiOrigin = "http://localhost:4000";
const evidenceDirectory =
  "C:\\Users\\Alhamza Nazhan\\Desktop\\TestRES\\dashboard-operational-fixes-2026-09-06";
const evidencePath = `${evidenceDirectory}\\export-flow-evidence.json`;
const runId = process.env.LOCAL_EXISTING_RUN_ID?.trim();
if (!/^[0-9a-f]{8}$/u.test(runId ?? ""))
  throw new Error("A verified local browser fixture is required.");
const email = `stripe-browser-${runId}@waflo.local`;
const password = `Local browser verification ${runId}!`;
const requests = [];

function localPath(url) {
  try {
    const target = new URL(url);
    return target.port === "4000" && ["localhost", "127.0.0.1"].includes(target.hostname)
      ? target.pathname
      : null;
  } catch {
    return null;
  }
}

async function login(page) {
  await page.goto(`${dashboardOrigin}/en/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const response = page.waitForResponse(
    (item) => localPath(item.url()) === "/v1/auth/login" && item.request().method() === "POST",
  );
  await page.locator("form.auth-form button[type=submit]").click();
  if (![200, 201].includes((await response).status())) throw new Error("Browser login failed.");
  await page.waitForURL(/\/en\/dashboard/);
}

async function runControlledFailure() {
  const environment = parseEnvironment({
    ...process.env,
    // This is the repository's object-storage-unavailable failure path, scoped to this one local worker instance.
    OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:1",
  });
  const prisma = createPrismaClient(environment.DATABASE_URL, {
    max: environment.DATABASE_POOL_MAX,
    connectionTimeoutMillis: environment.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: environment.DATABASE_POOL_IDLE_TIMEOUT_MS,
    maxLifetimeSeconds: environment.DATABASE_POOL_MAX_LIFETIME_SECONDS,
  });
  const worker = new OperationalWorker(prisma, environment);
  try {
    return await worker.processOneExport();
  } finally {
    await prisma.$disconnect();
    worker.close();
  }
}

async function changePlan(page, target) {
  await page.goto(`${dashboardOrigin}/en/dashboard/billing`);
  await page.locator(".dashboard-section-grid--plans").waitFor({ timeout: 20_000 });
  const card = page.locator(".wf-plan-card").filter({ hasText: new RegExp(`^${target}`, "i") });
  await card.getByRole("button", { name: "Choose plan" }).click();
  const modal = page.getByRole("dialog", { name: /confirm subscription change/i });
  await modal.waitFor({ timeout: 20_000 });
  if (!new RegExp(target, "i").test(await modal.innerText()))
    throw new Error(`The ${target} plan was not reflected in its confirmation preview.`);
  await modal.getByRole("button", { name: /confirm change/i }).click();
  await modal.waitFor({ state: "hidden", timeout: 30_000 });
  await page
    .getByText("Your Stripe subscription was updated.", { exact: true })
    .waitFor({ timeout: 20_000 });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1180 } });
await context.route("**/*", async (route) => {
  const target = new URL(route.request().url());
  if (["localhost", "127.0.0.1"].includes(target.hostname)) return route.continue();
  return route.abort();
});
const page = await context.newPage();
page.on("response", (response) => {
  const path = localPath(response.url());
  if (path) requests.push({ method: response.request().method(), path, status: response.status() });
});
try {
  await login(page);
  // Standard exports are Scale-entitled. Upgrade through the normal real Stripe flow for the
  // isolated failure, then restore Starter after the terminal-state assertion.
  await changePlan(page, "scale");
  await page.goto(`${dashboardOrigin}/en/dashboard/exports`);
  await page
    .getByRole("heading", { name: /exports/i })
    .first()
    .waitFor({ timeout: 20_000 });
  const created = page.waitForResponse(
    (item) => localPath(item.url())?.endsWith("/exports") && item.request().method() === "POST",
  );
  await page.getByRole("button", { name: /create export/i }).click();
  const createdResponse = await created;
  if (createdResponse.status() !== 201)
    throw new Error(`Local export was not queued (HTTP ${createdResponse.status()}).`);
  const processed = await runControlledFailure();
  if (!processed) throw new Error("The controlled local worker did not claim the queued export.");
  await page.getByText("Failed", { exact: true }).waitFor({ timeout: 20_000 });
  await page.getByText(/could not be created/i).waitFor({ timeout: 20_000 });
  await page.screenshot({
    path: `${evidenceDirectory}\\02b-export-terminal-failure.png`,
    fullPage: true,
  });
  const existing = JSON.parse(await readFile(evidencePath, "utf8"));
  existing.terminalFailure = {
    mechanism:
      "one local OperationalWorker instance with an unreachable loopback object-storage endpoint",
    productionCodeChanged: false,
    terminalStatus: "FAILED",
    browserTerminalStateVisible: true,
    creatingStateDoesNotPersist: true,
    temporaryGrowthEntitlementRestoredToStarter: false,
    exportCreateRequestCount: requests.filter(
      (item) => item.method === "POST" && item.path.endsWith("/exports"),
    ).length,
    failureStatusRequests: requests.filter(
      (item) => item.path.includes("/exports/") && item.status === 200,
    ).length,
  };
  await changePlan(page, "starter");
  existing.terminalFailure.temporaryGrowthEntitlementRestoredToStarter = true;
  await writeFile(evidencePath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
} finally {
  await browser.close();
}
