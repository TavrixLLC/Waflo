import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const dashboardOrigin = "http://localhost:3001";
const apiOrigin = "http://localhost:4000";
const evidenceDirectory =
  "C:\\Users\\Alhamza Nazhan\\Desktop\\TestRES\\dashboard-operational-fixes-2026-09-06";
const runId = process.env.LOCAL_EXISTING_RUN_ID?.trim();
if (!/^[0-9a-f]{8}$/u.test(runId ?? ""))
  throw new Error("A verified local browser fixture is required.");
const email = `stripe-browser-${runId}@waflo.local`;
const password = `Local browser verification ${runId}!`;
let phase = "setup";
const requests = [];
const evidence = {
  run: "local-billing-cadence-verification",
  generatedAt: new Date().toISOString(),
  redaction: { credentials: "not captured", cookies: "not captured", csrfTokens: "not captured" },
  transitions: [],
  requestCounts: {},
  normalUseRateLimit: { statuses429: 0, present: false },
};

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

function safePath(path) {
  return path.replaceAll(/[0-9a-f]{8}-[0-9a-f-]{27,}/giu, ":uuid");
}

function record(response) {
  const path = localPath(response.url());
  if (!path) return;
  requests.push({
    phase,
    method: response.request().method(),
    path: safePath(path),
    status: response.status(),
  });
}

function aggregate(items) {
  const result = {};
  for (const item of items) {
    const key = `${item.method} ${item.path}`;
    result[key] = (result[key] ?? 0) + 1;
  }
  return Object.entries(result)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([endpoint, count]) => {
      const [method, ...path] = endpoint.split(" ");
      return { method, path: path.join(" "), count };
    });
}

async function browserApi(page, path) {
  return await page.evaluate(
    async ({ origin, requestPath }) => {
      const response = await fetch(`${origin}${requestPath}`, {
        credentials: "include",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    { origin: apiOrigin, requestPath: path },
  );
}

async function login(page) {
  await page.goto(`${dashboardOrigin}/en/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const response = page.waitForResponse(
    (item) => localPath(item.url()) === "/v1/auth/login" && item.request().method() === "POST",
  );
  await page.locator("form.auth-form button[type=submit]").click();
  const completed = await response;
  if (![200, 201].includes(completed.status()))
    throw new Error(`Browser login returned ${completed.status()}.`);
  await page.waitForURL(/\/en\/dashboard/);
}

async function currentOrganization(page) {
  const organizations = await browserApi(page, "/v1/organizations");
  const organization = Array.isArray(organizations.body?.data)
    ? organizations.body.data[0]?.organization
    : null;
  if (organizations.status !== 200 || !organization?.id)
    throw new Error("Authenticated organization lookup failed.");
  return organization.id;
}

async function transition(page, organizationId, target, screenshot) {
  const title = target[0].toUpperCase() + target.slice(1);
  phase = `select_${target}`;
  await page.locator("label.billing-cadence-option", { hasText: title }).click();
  const modal = page.getByRole("dialog", { name: /confirm subscription change/i });
  await modal.waitFor({ timeout: 20_000 });
  const previewText = await modal.innerText();
  if (!new RegExp(title, "i").test(previewText))
    throw new Error(`${title} was not reflected in the subscription preview.`);

  phase = `confirm_${target}`;
  await modal.getByRole("button", { name: /confirm change/i }).click();
  await modal.waitFor({ state: "hidden", timeout: 30_000 });
  await page
    .getByText("Your Stripe subscription was updated.", { exact: true })
    .waitFor({ timeout: 20_000 });
  const selectedImmediately = await page
    .locator(`input[name="billing-cadence"][value="${target}"]`)
    .isChecked();
  await page.screenshot({ path: resolve(evidenceDirectory, screenshot), fullPage: true });

  phase = `canonical_get_${target}`;
  const canonical = await browserApi(page, `/v1/organizations/${organizationId}/billing`);
  const canonicalState =
    canonical.body?.data?.authoritativeState ?? canonical.body?.data?.profile ?? null;

  phase = `reload_${target}`;
  await page.reload();
  await page
    .getByRole("heading", { name: /billing/i })
    .first()
    .waitFor({ timeout: 20_000 });
  const selectedAfterReload = await page
    .locator(`input[name="billing-cadence"][value="${target}"]`)
    .isChecked();
  evidence.transitions.push({
    transition: `previous_to_${target}`,
    selectedCadence: target,
    previewMatchesSelection: new RegExp(title, "i").test(previewText),
    confirmationRequests: requests.filter(
      (item) =>
        item.phase === `confirm_${target}` &&
        /\/subscription-change\/[^/]+\/confirm$/u.test(item.path),
    ).length,
    immediateUi: selectedImmediately,
    canonicalGetStatus: canonical.status,
    canonicalSubscriptionStatus: canonicalState?.subscriptionStatus ?? null,
    reloadPersistence: selectedAfterReload,
  });
}

async function main() {
  await mkdir(evidenceDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1180 } });
  await context.route("**/*", async (route) => {
    const target = new URL(route.request().url());
    if (["localhost", "127.0.0.1"].includes(target.hostname)) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  page.on("response", record);
  try {
    phase = "login";
    await login(page);
    const organizationId = await currentOrganization(page);
    evidence.organizationId = organizationId;
    phase = "initial_billing_page_load";
    const initialBillingRead = page.waitForResponse(
      (item) =>
        item.request().method() === "GET" &&
        localPath(item.url()) === `/v1/organizations/${organizationId}/billing`,
      { timeout: 20_000 },
    );
    await page.goto(`${dashboardOrigin}/en/dashboard/billing`);
    await page
      .getByRole("heading", { name: /billing/i })
      .first()
      .waitFor({ timeout: 20_000 });
    await initialBillingRead;
    await transition(page, organizationId, "quarterly", "03-billing-quarterly-immediate.png");
    await transition(page, organizationId, "yearly", "03d-billing-yearly-immediate.png");
    await transition(page, organizationId, "monthly", "03e-billing-monthly-immediate.png");
    phase = "normal_use_final";
    await page.screenshot({
      path: resolve(evidenceDirectory, "08-no-rate-limit-error-normal-use.png"),
      fullPage: true,
    });
    evidence.normalUseRateLimit.statuses429 = requests.filter((item) => item.status === 429).length;
    evidence.normalUseRateLimit.present = evidence.normalUseRateLimit.statuses429 > 0;
    for (const step of [
      "initial_billing_page_load",
      "select_quarterly",
      "confirm_quarterly",
      "select_yearly",
      "confirm_yearly",
      "select_monthly",
      "confirm_monthly",
      "rejected_downgrade",
    ]) {
      evidence.requestCounts[step] = aggregate(requests.filter((item) => item.phase === step));
    }
    evidence.noDuplicateConfirmRequests = evidence.transitions.every(
      (item) => item.confirmationRequests === 1,
    );
    evidence.noAutomaticRetryStorm = evidence.normalUseRateLimit.statuses429 === 0;
    await writeFile(
      resolve(evidenceDirectory, "billing-cadence-live-evidence.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      resolve(evidenceDirectory, "network-billing-request-count.json"),
      `${JSON.stringify({ generatedAt: evidence.generatedAt, requestCounts: evidence.requestCounts, noDuplicateConfirmRequests: evidence.noDuplicateConfirmRequests, statuses429: evidence.normalUseRateLimit.statuses429 }, null, 2)}\n`,
      "utf8",
    );
  } finally {
    await browser.close();
  }
}

await main();
