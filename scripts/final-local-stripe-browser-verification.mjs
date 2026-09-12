import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const dashboardOrigin = "http://localhost:3001";
const apiOrigin = "http://localhost:4000";
const evidenceDirectory =
  "C:\\Users\\Alhamza Nazhan\\Desktop\\TestRES\\dashboard-operational-fixes-2026-09-06";
const suppliedRunId = process.env.LOCAL_EXISTING_RUN_ID?.trim();
const runId = suppliedRunId || randomUUID().slice(0, 8);
const reuseVerifiedFixture = Boolean(suppliedRunId);
const email = `stripe-browser-${runId}@waflo.local`;
const password = `Local browser verification ${runId}!`;
const evidence = {
  run: "local-stripe-browser-verification",
  generatedAt: new Date().toISOString(),
  redaction: {
    stripeSecrets: "not captured",
    browserCookies: "not captured",
    csrfTokens: "not captured",
    checkoutClientSecrets: "not captured",
    cardData: "not captured",
  },
  sessionTrace: {},
  requests: [],
  payment: {},
};

function apiPath(url) {
  try {
    const parsed = new URL(url);
    return parsed.port === "4000" && ["localhost", "127.0.0.1"].includes(parsed.hostname)
      ? parsed.pathname
      : null;
  } catch {
    return null;
  }
}

function recordResponse(response) {
  const path = apiPath(response.url());
  if (!path) return;
  evidence.requests.push({
    method: response.request().method(),
    path,
    status: response.status(),
  });
}

function recordRequest(request) {
  try {
    const target = new URL(request.url());
    if (target.port === "4000" && ["localhost", "127.0.0.1"].includes(target.hostname)) {
      evidence.observedApiTargets ??= [];
      evidence.observedApiTargets.push({
        method: request.method(),
        host: target.hostname,
        port: target.port || (target.protocol === "https:" ? "443" : "80"),
        path: target.pathname,
      });
    }
  } catch {
    // Ignore non-URL browser internals.
  }
}

async function writeEvidence() {
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    resolve(evidenceDirectory, "stripe-local-live-evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
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
        const csrfResponse = await fetch(`${origin}/v1/auth/csrf`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!csrfResponse.ok) return { status: csrfResponse.status, body: null };
        csrf = (await csrfResponse.json()).data.csrfToken;
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
      const payload = await response.json().catch(() => null);
      return {
        status: response.status,
        body: payload,
        csrfPresent: Boolean(csrf),
      };
    },
    { origin: apiOrigin, requestPath: path, requestMethod: method, requestBody: body },
  );
}

async function latestVerificationUrl(page) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const response = await page.request.get("http://localhost:8025/api/v1/messages");
    const list = await response.json();
    const message = (list.messages ?? [])
      .filter(
        (item) =>
          item.Subject?.includes("Verify your Waflo email") &&
          item.To?.some((recipient) => recipient.Address === email),
      )
      .sort((left, right) => right.Created.localeCompare(left.Created))[0];
    if (message) {
      const detail = await (
        await page.request.get(`http://localhost:8025/api/v1/message/${message.ID}`)
      ).json();
      const action = `${detail.HTML ?? ""}\n${detail.Text ?? ""}`.match(/https?:\/\/[^"' <]+/)?.[0];
      if (action) return action.replaceAll("&amp;", "&");
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error("Local verification email was not received.");
}

async function signUpVerifyAndLogin(page) {
  if (reuseVerifiedFixture) {
    await page.goto(`${dashboardOrigin}/en/login`);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    const loginResponse = page.waitForResponse(
      (response) =>
        apiPath(response.url()) === "/v1/auth/login" && response.request().method() === "POST",
    );
    await page.locator("form.auth-form button[type=submit]").click();
    const response = await loginResponse;
    if (![200, 201].includes(response.status()))
      throw new Error(`Existing fixture login failed with ${response.status()}.`);
    await page.waitForURL(/\/en\/(?:onboarding|dashboard)/);
    evidence.sessionTrace.authenticationPath =
      "fresh_browser_form_login_to_existing_verified_local_fixture";
    return;
  }
  await page.goto(`${dashboardOrigin}/en/signup`);
  await page.locator('input[name="displayName"]').fill("Stripe Browser Verification");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirmPassword"]').fill(password);
  await page.locator('input[name="terms"]').check();
  await page.locator('input[name="privacy"]').check();
  await page.locator("form.auth-form button[type=submit]").click();
  await page.waitForURL(/\/en\/verify-email/);

  const verification = new URL(await latestVerificationUrl(page));
  verification.searchParams.set("localVerification", "1");
  await page.goto(verification.toString());
  await page.getByText("Email verified", { exact: true }).waitFor();

  await page.goto(`${dashboardOrigin}/en/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const loginResponse = page.waitForResponse(
    (response) =>
      apiPath(response.url()) === "/v1/auth/login" && response.request().method() === "POST",
  );
  await page.locator("form.auth-form button[type=submit]").click();
  const response = await loginResponse;
  if (![200, 201].includes(response.status()))
    throw new Error(`Browser login failed with ${response.status()}.`);
  await page.waitForURL(/\/en\/onboarding\/business/);
}

async function createBrowserFixture(page) {
  const me = await browserApi(page, "/v1/auth/me");
  if (me.status !== 200 || !me.body?.data?.id)
    throw new Error("Authenticated browser session unavailable.");
  evidence.sessionTrace.userId = me.body.data.id;
  evidence.sessionTrace.sessionPresent = true;
  evidence.sessionTrace.csrfPresent = Boolean(me.csrfPresent);

  if (reuseVerifiedFixture) {
    const organizations = await browserApi(page, "/v1/organizations");
    const memberships = organizations.body?.data;
    const organization = Array.isArray(memberships) ? memberships[0]?.organization : null;
    if (organizations.status !== 200 || !organization?.id)
      throw new Error(`Existing fixture organization lookup failed with ${organizations.status}.`);
    const organizationId = organization.id;
    evidence.sessionTrace.organizationId = organizationId;
    evidence.sessionTrace.onboardingState = organization.onboardingState ?? "unknown";
    const billing = await browserApi(page, `/v1/organizations/${organizationId}/billing`);
    if (billing.status !== 200)
      throw new Error(`Existing fixture billing read failed with ${billing.status}.`);
    evidence.sessionTrace.billingProfilePresent = Boolean(billing.body?.data?.profile);
    evidence.sessionTrace.billingIdentityPresent = Boolean(
      billing.body?.data?.billingIdentity?.email,
    );
    evidence.sessionTrace.checkoutSessionPresent = Boolean(
      billing.body?.data?.onboardingSetup?.checkoutSessionId,
    );
    return organizationId;
  }

  const organization = await browserApi(page, "/v1/organizations", "POST", {
    name: "Stripe Browser Verification",
    merchantSlug: `stripe-browser-${runId}`,
    businessCategory: "Cafe",
    defaultLocale: "en",
    timezone: "Asia/Baghdad",
    selectedPlan: "growth",
    commandId: randomUUID(),
    firstLocation: {
      name: "Local verification branch",
      addressLine1: "Al Karrada",
      city: "Baghdad",
      countryCode: "IQ",
      timezone: "Asia/Baghdad",
      latitude: 33.3152,
      longitude: 44.3661,
      coordinatesConfirmed: true,
    },
  });
  if (organization.status !== 201 || !organization.body?.data?.id)
    throw new Error(`Fixture organization request failed with ${organization.status}.`);
  const organizationId = organization.body.data.id;
  evidence.sessionTrace.organizationId = organizationId;

  const identity = await browserApi(
    page,
    `/v1/organizations/${organizationId}/billing/identity`,
    "PATCH",
    {
      name: "Stripe Browser Verification",
      email,
      countryCode: "IQ",
      addressLine1: "Al Karrada",
      addressLine2: null,
      city: "Baghdad",
      region: "Baghdad",
      postalCode: "10001",
    },
  );
  if (identity.status !== 200)
    throw new Error(`Billing identity request failed with ${identity.status}.`);

  const billing = await browserApi(page, `/v1/organizations/${organizationId}/billing`);
  if (billing.status !== 200)
    throw new Error(`Billing read request failed with ${billing.status}.`);
  evidence.sessionTrace.onboardingState = "billing_identity_required";
  evidence.sessionTrace.billingProfilePresent = Boolean(billing.body?.data?.profile);
  evidence.sessionTrace.billingIdentityPresent = Boolean(
    billing.body?.data?.billingIdentity?.email,
  );
  evidence.sessionTrace.checkoutSessionPresent = Boolean(
    billing.body?.data?.onboardingSetup?.checkoutSessionId,
  );
  return organizationId;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1180 } });
  await context.route("**/*", async (route) => {
    const target = new URL(route.request().url());
    const local = ["localhost", "127.0.0.1"].includes(target.hostname);
    const stripe =
      target.hostname === "stripe.com" ||
      target.hostname.endsWith(".stripe.com") ||
      target.hostname.endsWith(".stripe.network") ||
      target.hostname.endsWith(".stripecdn.com") ||
      target.hostname === "hcaptcha.com" ||
      target.hostname.endsWith(".hcaptcha.com");
    if (local || stripe) return route.continue();
    evidence.blockedNonLocalRequests ??= [];
    evidence.blockedNonLocalRequests.push({ host: target.hostname, path: target.pathname });
    return route.abort();
  });
  const page = await context.newPage();
  page.on("response", recordResponse);
  page.on("request", recordRequest);
  page.on("console", (message) => {
    if (message.type() === "error") {
      evidence.browserConsoleErrors ??= [];
      evidence.browserConsoleErrors.push(message.text().slice(0, 400));
    }
  });
  try {
    await signUpVerifyAndLogin(page);
    const organizationId = await createBrowserFixture(page);
    await page.goto(
      `${dashboardOrigin}/en/onboarding/business?organization=${encodeURIComponent(organizationId)}&resume=payment_method_required`,
    );
    await page.locator("label.onboarding-plan-option", { hasText: "Growth" }).click();
    await page.locator(".onboarding-plan-step button").click();
    await page.locator(".onboarding-payment iframe").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(8_000);
    evidence.payment.paymentElementMounted =
      (await page.locator(".onboarding-payment iframe").count()) > 0;
    evidence.payment.checkoutElementsState = evidence.payment.paymentElementMounted
      ? "ready"
      : "error";
    evidence.payment.iframeAttributes = await page.locator("iframe").evaluateAll((elements) =>
      elements.map((element) => {
        const source = element.getAttribute("src") ?? "";
        let host = "";
        let path = "";
        try {
          const target = new URL(source);
          host = target.hostname;
          path = target.pathname;
        } catch {}
        return {
          title: element.getAttribute("title"),
          name: element.getAttribute("name"),
          host,
          path,
          box: (() => {
            const box = element.getBoundingClientRect();
            return {
              x: Math.round(box.x),
              y: Math.round(box.y),
              width: Math.round(box.width),
              height: Math.round(box.height),
            };
          })(),
        };
      }),
    );
    evidence.payment.frames = await Promise.all(
      page.frames().map(async (frame) => {
        let host = "local";
        let path = "/";
        try {
          const target = new URL(frame.url());
          host = target.hostname;
          path = target.pathname;
        } catch {}
        return {
          host,
          path,
          inputs: await frame.locator("input").evaluateAll((elements) =>
            elements.map((element) => ({
              name: element.getAttribute("name"),
              type: element.getAttribute("type"),
              ariaLabel: element.getAttribute("aria-label"),
              placeholder: element.getAttribute("placeholder"),
            })),
          ),
        };
      }),
    );
    evidence.payment.checkoutSessionPresent = evidence.requests.some(
      (request) => request.path.endsWith("/billing/trial/setup") && request.status === 201,
    );
    await page.screenshot({
      path: resolve(evidenceDirectory, "03a-stripe-payment-element-ready.png"),
      fullPage: true,
    });
    const paymentFrame = page.locator('iframe[title="Secure payment input frame"]').first();
    const testCard = ["4242", "4242", "4242", "4242"].join("");
    const testExpiry = ["12", "34"].join("");
    const testCvc = ["1", "2", "3"].join("");
    // Stripe intentionally encapsulates the card fields in a closed hosted frame.  A browser click
    // followed by ordinary keyboard entry exercises its supported focus path without reading field values.
    await paymentFrame.click({ position: { x: 160, y: 120 } });
    await page.keyboard.insertText(testCard);
    await page.keyboard.press("Tab");
    await page.keyboard.insertText(testExpiry);
    await page.keyboard.press("Tab");
    await page.keyboard.insertText(testCvc);
    evidence.payment.cardEntrySubmittedThroughHostedElement = true;
    await page
      .getByRole("button", { name: /save card and review trial/i })
      .click({ timeout: 3_000 });
    await page.locator(".onboarding-trial-review").waitFor({ timeout: 10_000 });
    evidence.payment.checkoutConfirmationSucceeded = true;
    evidence.payment.trialPreviewRequestStatuses = evidence.requests
      .filter((request) => request.path.endsWith("/billing/trial/preview"))
      .map((request) => request.status);
    await page.screenshot({
      path: resolve(evidenceDirectory, "03b-stripe-trial-review.png"),
      fullPage: true,
    });
    await page.locator(".onboarding-trial-review__actions button").click();
    await page.waitForURL(/\/en\/onboarding\/complete/, { timeout: 10_000 });
    evidence.payment.trialActivationSucceeded = true;
    const activatedBilling = await browserApi(page, `/v1/organizations/${organizationId}/billing`);
    evidence.payment.activatedBillingReadStatus = activatedBilling.status;
    evidence.payment.persistedSubscription = {
      present: Boolean(activatedBilling.body?.data?.profile?.subscriptionStatus),
      plan: activatedBilling.body?.data?.profile?.plan ?? null,
      cadence: activatedBilling.body?.data?.profile?.billingCadence ?? null,
      status: activatedBilling.body?.data?.profile?.subscriptionStatus ?? null,
    };
    await page.screenshot({
      path: resolve(evidenceDirectory, "03c-stripe-trial-active.png"),
      fullPage: true,
    });
    await writeEvidence();
  } catch (error) {
    evidence.failure =
      error instanceof Error
        ? error.message.replace(/(?:cs|seti|pi|sk|pk)_(?:test|live)_[A-Za-z0-9_]+/gu, "[REDACTED]")
        : "unknown";
    evidence.failurePage = {
      path: new URL(page.url()).pathname,
      body: (
        await page
          .locator("body")
          .innerText()
          .catch(() => "")
      )
        .replaceAll(email, "[REDACTED_EMAIL]")
        .slice(0, 1500),
    };
    await writeEvidence();
    throw error;
  } finally {
    await browser.close();
  }
}

await main();
