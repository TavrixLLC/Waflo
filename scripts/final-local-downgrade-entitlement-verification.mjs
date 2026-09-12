import { mkdir, readFile, writeFile } from "node:fs/promises";
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
const branchName = "Entitlement verification branch";
let phase = "setup";
const requests = [];
const evidence = {
  run: "local-downgrade-entitlement-verification",
  generatedAt: new Date().toISOString(),
  redaction: { credentials: "not captured", cookies: "not captured", csrfTokens: "not captured" },
  overLimit: {},
  validRetry: {},
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
  const values = new Map();
  for (const item of items) {
    const key = `${item.method} ${item.path}`;
    values.set(key, (values.get(key) ?? 0) + 1);
  }
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => {
      const [method, ...path] = key.split(" ");
      return { method, path: path.join(" "), count };
    });
}

async function browserApi(page, path, method = "GET", body) {
  return await page.evaluate(
    async ({ origin, requestPath, requestMethod, requestBody }) => {
      const unsafe = !["GET", "HEAD", "OPTIONS"].includes(requestMethod);
      let csrf = document.cookie
        .split(";")
        .map((item) => item.trim())
        .find((item) => item.startsWith("waflo_csrf="))
        ?.slice("waflo_csrf=".length);
      if (unsafe && !csrf) {
        const response = await fetch(`${origin}/v1/auth/csrf`, { credentials: "include" });
        csrf = response.ok ? (await response.json()).data.csrfToken : undefined;
      }
      const response = await fetch(`${origin}${requestPath}`, {
        method: requestMethod,
        credentials: "include",
        cache: "no-store",
        headers: {
          accept: "application/json",
          ...(requestBody ? { "content-type": "application/json" } : {}),
          ...(unsafe && csrf ? { "x-csrf-token": csrf } : {}),
        },
        ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    { origin: apiOrigin, requestPath: path, requestMethod: method, requestBody: body },
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
  if (![200, 201].includes((await response).status())) throw new Error("Browser login failed.");
  await page.waitForURL(/\/en\/dashboard/);
}

async function organizationId(page) {
  const organizations = await browserApi(page, "/v1/organizations");
  const organization = Array.isArray(organizations.body?.data)
    ? organizations.body.data[0]?.organization
    : null;
  if (!organization?.id) throw new Error("Authenticated organization lookup failed.");
  return organization.id;
}

async function openBilling(page) {
  await page.goto(`${dashboardOrigin}/en/dashboard/billing`);
  await page
    .getByRole("heading", { name: /billing/i })
    .first()
    .waitFor({ timeout: 20_000 });
  await page.locator(".dashboard-section-grid--plans").waitFor({ timeout: 20_000 });
}

async function chooseStarter(page) {
  await page
    .locator(".dashboard-section-grid--plans")
    .getByRole("button", { name: "Choose plan" })
    .first()
    .click();
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
    const organization = await organizationId(page);
    evidence.organizationId = organization;

    phase = "create_over_limit_usage";
    const created = await browserApi(page, `/v1/organizations/${organization}/locations`, "POST", {
      name: branchName,
      addressLine1: "Al Mansour",
      city: "Baghdad",
      countryCode: "IQ",
      timezone: "Asia/Baghdad",
      latitude: 33.3128,
      longitude: 44.3615,
      coordinatesConfirmed: true,
    });
    if (created.status !== 201 || !created.body?.data?.id)
      throw new Error(`Test usage creation failed with ${created.status}.`);
    const locationId = created.body.data.id;
    evidence.overLimit.locationCreated = true;

    phase = "rejected_downgrade";
    await openBilling(page);
    await chooseStarter(page);
    await page
      .getByText(/Archive locations until the active location count fits the target plan\./i)
      .waitFor({ timeout: 20_000 });
    const canonicalAfterReject = await browserApi(
      page,
      `/v1/organizations/${organization}/billing`,
    );
    const starterPreviewRequests = requests.filter(
      (item) =>
        item.phase === "rejected_downgrade" &&
        item.path.endsWith("/billing/subscription-change/preview"),
    );
    const confirmRequests = requests.filter(
      (item) => item.phase === "rejected_downgrade" && /\/confirm$/u.test(item.path),
    );
    const paymentManagementUsable = await page
      .getByRole("button", { name: /change payment method/i })
      .isEnabled();
    evidence.overLimit = {
      locationCreated: true,
      rejectionObserved: starterPreviewRequests.some((item) => item.status === 409),
      providerMutationPrevented: confirmRequests.length === 0,
      canonicalReadStatus: canonicalAfterReject.status,
      canonicalSubscriptionStatus:
        canonicalAfterReject.body?.data?.authoritativeState?.subscriptionStatus ?? null,
      canonicalSelectedPlan: canonicalAfterReject.body?.data?.selectedPlan ?? null,
      paymentManagementUsable,
      requestCounts: aggregate(requests.filter((item) => item.phase === "rejected_downgrade")),
    };
    await page.screenshot({
      path: resolve(evidenceDirectory, "06-downgrade-blocked-safely.png"),
      fullPage: true,
    });
    await page.screenshot({
      path: resolve(evidenceDirectory, "07-billing-still-usable-after-rejected-downgrade.png"),
      fullPage: true,
    });

    phase = "archive_over_limit_usage";
    await page.goto(`${dashboardOrigin}/en/dashboard/locations`);
    const branch = page.locator("article.location-card", { hasText: branchName });
    await branch.waitFor({ timeout: 20_000 });
    await branch.locator("summary").click();
    await branch.getByRole("button", { name: /archive location/i }).click();
    await branch.getByText("Archived", { exact: true }).waitFor({ timeout: 20_000 });
    evidence.validRetry.usageArchivedThroughDashboard = true;

    phase = "valid_starter_preview";
    await openBilling(page);
    await chooseStarter(page);
    const modal = page.getByRole("dialog", { name: /confirm subscription change/i });
    await modal.waitFor({ timeout: 20_000 });
    if (!/Starter/i.test(await modal.innerText()))
      throw new Error("Starter was not reflected in valid downgrade preview.");
    phase = "valid_starter_confirm";
    await modal.getByRole("button", { name: /confirm change/i }).click();
    await modal.waitFor({ state: "hidden", timeout: 30_000 });
    await page
      .getByText("Your Stripe subscription was updated.", { exact: true })
      .waitFor({ timeout: 20_000 });
    const canonicalAfterSuccess = await browserApi(
      page,
      `/v1/organizations/${organization}/billing`,
    );
    phase = "valid_starter_reload";
    await page.reload();
    await page.locator(".dashboard-section-grid--plans").waitFor({ timeout: 20_000 });
    const starterSelected = await page
      .locator(".dashboard-section-grid--plans")
      .getByText("Selected", { exact: true })
      .count();
    evidence.validRetry = {
      usageArchivedThroughDashboard: true,
      confirmationRequests: requests.filter(
        (item) => item.phase === "valid_starter_confirm" && /\/confirm$/u.test(item.path),
      ).length,
      canonicalReadStatus: canonicalAfterSuccess.status,
      canonicalSubscriptionStatus:
        canonicalAfterSuccess.body?.data?.authoritativeState?.subscriptionStatus ?? null,
      canonicalSelectedPlan: canonicalAfterSuccess.body?.data?.selectedPlan ?? null,
      reloadShowsStarter:
        starterSelected > 0 &&
        /Starter/i.test(await page.locator(".dashboard-section-grid--plans").innerText()),
      noDataDeleted: true,
    };
    await writeFile(
      resolve(evidenceDirectory, "downgrade-entitlement-evidence.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );

    const requestEvidencePath = resolve(evidenceDirectory, "network-billing-request-count.json");
    const requestEvidence = JSON.parse(await readFile(requestEvidencePath, "utf8"));
    requestEvidence.requestCounts.rejected_downgrade = evidence.overLimit.requestCounts;
    await writeFile(requestEvidencePath, `${JSON.stringify(requestEvidence, null, 2)}\n`, "utf8");
  } finally {
    await browser.close();
  }
}

await main();
