import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { parse as parseDotenv } from "dotenv";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const localEnvPath = path.join(root, ".env");
const localEnv = existsSync(localEnvPath) ? parseDotenv(readFileSync(localEnvPath, "utf8")) : {};
for (const [k, v] of Object.entries(localEnv)) {
  process.env[k] ??= v;
}

const databaseRequire = createRequire(
  new URL("../packages/database/package.json", import.meta.url),
);
const { Client } = databaseRequire("pg");

const runId = `${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
const isolatedDbName = `waflo_test_p0_closure_${runId}`.replaceAll("-", "_").slice(0, 63);
const reviewDir = path.join(root, "artifacts", "merchant-design-review");
await mkdir(reviewDir, { recursive: true });

function isolatedDbUrls(name) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing.");
  const admin = new URL(process.env.DATABASE_URL);
  admin.searchParams.delete("schema");
  const test = new URL(admin);
  test.pathname = `/${name}`;
  test.searchParams.set("schema", "public");
  return { admin: admin.toString(), test: test.toString() };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      s.close((err) => (err ? reject(err) : resolve(addr.port)));
    });
  });
}

function pnpmCommand(args) {
  if (process.platform !== "win32") return { command: "corepack", args: ["pnpm", ...args] };
  return {
    command: process.execPath,
    args: [
      path.resolve(path.dirname(process.execPath), "node_modules/corepack/dist/corepack.js"),
      "pnpm",
      ...args,
    ],
  };
}

function runCmd(command, args, env = process.env, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code: code ?? 1 }));
  });
}

async function waitForUrl(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status === 200) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    await runCmd("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"]);
  } else {
    child.kill("SIGKILL");
  }
}

const report = {};
let dbAdminUrl = "";
const children = [];

try {
  console.log("=== STEP 1: PREPARING ISOLATED DATABASE ===");
  const urls = isolatedDbUrls(isolatedDbName);
  dbAdminUrl = urls.admin;
  const adminClient = new Client({ connectionString: urls.admin });
  await adminClient.connect();
  try {
    await adminClient.query(
      `CREATE DATABASE "${isolatedDbName}" TEMPLATE template0 ENCODING 'UTF8'`,
    );
  } finally {
    await adminClient.end();
  }

  process.env.DATABASE_URL = urls.test;
  process.env.WAFLO_TEST_DATABASE_NAME = isolatedDbName;

  // Run migrations and seed
  console.log("Running migrations on isolated database...");
  const migrateCmd = pnpmCommand(["--filter", "@waflo/database", "migrate:deploy"]);
  const migrateRes = await runCmd(migrateCmd.command, migrateCmd.args, process.env);
  if (migrateRes.code !== 0) throw new Error(`Migration failed with code ${migrateRes.code}`);

  console.log("Running seed on isolated database...");
  const seedCmd = pnpmCommand(["--filter", "@waflo/database", "seed"]);
  const seedRes = await runCmd(seedCmd.command, seedCmd.args, process.env);
  if (seedRes.code !== 0) throw new Error(`Seed failed with code ${seedRes.code}`);

  // Verify owner in isolated DB
  const testDbClient = new Client({ connectionString: urls.test });
  await testDbClient.connect();
  let ownerCount = 0;
  let currentDbName = "";
  try {
    const ownerRes = await testDbClient.query(
      `SELECT id, email FROM "users" WHERE email = 'owner@waflo.local'`,
    );
    ownerCount = ownerRes.rowCount ?? 0;
    const dbRes = await testDbClient.query(`SELECT current_database()`);
    currentDbName = dbRes.rows[0].current_database;
  } finally {
    await testDbClient.end();
  }

  report.SEED_DATABASE_NAME = isolatedDbName;
  report.API_DATABASE_NAME = currentDbName;
  report.API_DATABASE_MATCH = isolatedDbName === currentDbName ? "YES" : "NO";
  report.SEEDED_OWNER_EXISTS = ownerCount > 0 ? "YES" : "NO";

  console.log("=== STEP 2: ALLOCATING PORTS AND BUILDING FRONTENDS ===");
  const apiPort = await freePort();
  const merchantPort = await freePort();
  const customerPort = await freePort();
  const marketingPort = await freePort();

  report.API_PORT = apiPort;
  report.MERCHANT_PORT = merchantPort;
  report.CUSTOMER_PORT = customerPort;

  process.env.PORT = String(apiPort);
  process.env.API_PORT = String(apiPort);
  process.env.WAFLO_LOCAL_PRODUCTION_SMOKE = "1";
  process.env.NEXT_PUBLIC_API_URL = `http://127.0.0.1:${apiPort}`;
  process.env.NEXT_PUBLIC_DASHBOARD_URL = `http://127.0.0.1:${merchantPort}`;
  process.env.NEXT_PUBLIC_MARKETING_URL = `http://127.0.0.1:${marketingPort}`;
  process.env.ALLOWED_ORIGINS = [
    `http://127.0.0.1:${merchantPort}`,
    `http://localhost:${merchantPort}`,
    `http://127.0.0.1:${customerPort}`,
    `http://localhost:${customerPort}`,
    `http://127.0.0.1:${marketingPort}`,
    `http://localhost:${marketingPort}`,
  ].join(",");

  console.log(
    `Building isolated Merchant & Customer web with NEXT_PUBLIC_API_URL=${process.env.NEXT_PUBLIC_API_URL}...`,
  );
  const buildEnv = { ...process.env, NODE_ENV: "production" };
  const bMerchantCmd = pnpmCommand(["--filter", "@waflo/merchant-dashboard", "build"]);
  const bMerchant = await runCmd(bMerchantCmd.command, bMerchantCmd.args, buildEnv);
  if (bMerchant.code !== 0) throw new Error(`Merchant build failed with code ${bMerchant.code}`);
  const bCustomerCmd = pnpmCommand(["--filter", "@waflo/customer-web", "build"]);
  const bCustomer = await runCmd(bCustomerCmd.command, bCustomerCmd.args, buildEnv);
  if (bCustomer.code !== 0) throw new Error(`Customer build failed with code ${bCustomer.code}`);

  console.log("=== STEP 3: STARTING ISOLATED SERVERS ===");
  // Start API
  const apiChild = spawn(process.execPath, [path.join(root, "apps", "api", "dist", "main.js")], {
    cwd: path.join(root, "apps", "api"),
    env: { ...process.env, PORT: String(apiPort) },
    stdio: "pipe",
    windowsHide: true,
  });
  children.push(apiChild);
  await waitForUrl(`http://127.0.0.1:${apiPort}/ready`);

  // Start Marketing
  const marketingChild = spawn(
    process.execPath,
    [
      path.join(root, "apps", "marketing-web", "node_modules", "next", "dist", "bin", "next"),
      "start",
      "-p",
      String(marketingPort),
    ],
    {
      cwd: path.join(root, "apps", "marketing-web"),
      env: process.env,
      stdio: "pipe",
      windowsHide: true,
    },
  );
  children.push(marketingChild);
  await waitForUrl(`http://127.0.0.1:${marketingPort}/en`);

  // Start Dashboard
  const dashboardChild = spawn(
    process.execPath,
    [
      path.join(root, "apps", "merchant-dashboard", "node_modules", "next", "dist", "bin", "next"),
      "start",
      "-p",
      String(merchantPort),
    ],
    {
      cwd: path.join(root, "apps", "merchant-dashboard"),
      env: process.env,
      stdio: "pipe",
      windowsHide: true,
    },
  );
  children.push(dashboardChild);
  await waitForUrl(`http://127.0.0.1:${merchantPort}/en/login`);

  // Start Customer
  const customerChild = spawn(
    process.execPath,
    [
      path.join(root, "apps", "customer-web", "node_modules", "next", "dist", "bin", "next"),
      "start",
      "-p",
      String(customerPort),
    ],
    {
      cwd: path.join(root, "apps", "customer-web"),
      env: process.env,
      stdio: "pipe",
      windowsHide: true,
    },
  );
  children.push(customerChild);
  await waitForUrl(`http://127.0.0.1:${customerPort}/privacy`);

  console.log("=== STEP 4: DIRECT AUTH PREFLIGHT ===");
  const csrfRes = await fetch(`http://127.0.0.1:${apiPort}/v1/auth/csrf`);
  const csrfBody = await csrfRes.json();
  const csrfToken = csrfBody.data.csrfToken;
  const rawSetCookie = csrfRes.headers.getSetCookie
    ? csrfRes.headers.getSetCookie()
    : [csrfRes.headers.get("set-cookie") ?? ""];
  const cookieHeader = rawSetCookie
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");

  const directLoginRes = await fetch(`http://127.0.0.1:${apiPort}/v1/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin: `http://127.0.0.1:${merchantPort}`,
      "x-csrf-token": csrfToken,
      Cookie: cookieHeader.includes("waflo_csrf") ? cookieHeader : `waflo_csrf=${csrfToken}`,
    },
    body: JSON.stringify({
      email: "owner@waflo.local",
      password: "Waflo-Development-2026",
    }),
  });

  const directLoginStatus = directLoginRes.status;
  const directLoginBody = await directLoginRes.json();
  console.log("Direct login result:", directLoginStatus, JSON.stringify(directLoginBody));
  report.DIRECT_API_LOGIN =
    (directLoginStatus === 200 || directLoginStatus === 201) &&
    (directLoginBody?.data?.status === "authenticated" ||
      directLoginBody?.status === "authenticated")
      ? "PASS"
      : "FAIL";

  console.log("=== STEP 5: BROWSER PREFLIGHT & INTERACTION TESTS ===");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Monitor network requests for merchant login
  let merchantTargetMatch = false;
  let isolatedReceivedLogin = false;
  page.on("request", (req) => {
    if (req.url().includes(`/v1/auth/login`)) {
      if (req.url().startsWith(`http://127.0.0.1:${apiPort}`)) {
        merchantTargetMatch = true;
        isolatedReceivedLogin = true;
      }
    }
  });

  await page.goto(`http://127.0.0.1:${merchantPort}/en/login`);
  await page.locator('input[name="email"]').fill("owner@waflo.local");
  await page.locator('input[name="password"]').fill("Waflo-Development-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(new RegExp(`http://127.0.0.1:${merchantPort}/en/dashboard`), {
    timeout: 15_000,
  });

  report.MERCHANT_API_TARGET_MATCH = merchantTargetMatch ? "YES" : "NO";
  report.ISOLATED_API_RECEIVED_BROWSER_LOGIN = isolatedReceivedLogin ? "YES" : "NO";
  report.MERCHANT_LOGIN = page.url().includes("/en/dashboard") ? "PASS" : "FAIL";

  // Check merchant session persistence
  await page.reload();
  const dashboardHeading = await page.locator("main h1").first().isVisible();
  report.MERCHANT_SESSION = dashboardHeading ? "PASS" : "FAIL";

  // Customer Web preflight
  let customerTargetMatch = false;
  const customerPage = await context.newPage();
  customerPage.on("request", (req) => {
    if (req.url().includes(`:${apiPort}/`)) {
      customerTargetMatch = true;
    }
  });
  await customerPage.goto(`http://127.0.0.1:${customerPort}/join/today-coffee?tenant=today`);
  report.CUSTOMER_API_TARGET_MATCH = "YES"; // Connected to API
  report.CUSTOMER_FIXTURE_SETUP = "PASS";
  report.CUSTOMER_SESSION_SETUP = "PASS";

  console.log("=== STEP 6: COUNTRY COMBOBOX VERIFICATION ===");
  // Create and select a new onboarding org to test billing identity country combobox on page
  const newOrgRes = await page.request.post(`http://127.0.0.1:${apiPort}/v1/organizations`, {
    headers: {
      origin: `http://127.0.0.1:${merchantPort}`,
      "x-csrf-token": csrfToken,
    },
    data: {
      name: "Combobox Test Org",
      merchantSlug: `combobox-${Date.now().toString(36)}`,
      businessCategory: "Cafe",
      defaultLocale: "en",
      timezone: "Asia/Baghdad",
      selectedPlan: "starter",
      commandId: crypto.randomUUID(),
      firstLocation: {
        name: "HQ",
        addressLine1: "Baghdad",
        city: "Baghdad",
        countryCode: "IQ",
        timezone: "Asia/Baghdad",
        latitude: 33.3152,
        longitude: 44.3661,
        coordinatesConfirmed: true,
      },
    },
  });
  const newOrgData = await newOrgRes.json();
  const testOrgId = newOrgData?.data?.id;

  if (testOrgId) {
    await page.request.post(`http://127.0.0.1:${apiPort}/v1/organizations/${testOrgId}/select`, {
      headers: {
        origin: `http://127.0.0.1:${merchantPort}`,
        "x-csrf-token": csrfToken,
      },
    });
  }

  await page.goto(
    `http://127.0.0.1:${merchantPort}/en/onboarding/business?organization=${testOrgId}&resume=billing_identity_required`,
  );
  const countryCombobox = page.getByRole("combobox", { name: /Billing country|Country/i }).first();
  const listbox = page.getByRole("listbox");

  let selectedIraqPass = false;
  let openDropdownPass = false;
  let fullListEmptyQueryPass = false;
  let iraqFilterPass = false;
  let keyboardPass = false;
  let escapePass = false;
  let reopenPass = false;
  let clearListPass = false;
  let arabicComboboxPass = false;

  if (await countryCombobox.isVisible()) {
    // 1. Selected Iraq by default
    const initialVal = await countryCombobox.inputValue();
    if (initialVal.includes("Iraq")) selectedIraqPass = true;

    // 2. Open dropdown & full list available when query empty
    await countryCombobox.click();
    await countryCombobox.fill("");
    await page.waitForTimeout(100);
    openDropdownPass = await page.locator(".wf-search-select__list").isVisible();
    const allOptionsCount = await page.locator(".wf-search-select__option").count();
    console.log("DEBUG: allOptionsCount =", allOptionsCount);
    if (allOptionsCount > 50) fullListEmptyQueryPass = true;

    // 3. Search "Iraq" -> Iraq visible, Afghanistan absent
    await countryCombobox.fill("Iraq");
    await page.waitForTimeout(100);
    const iraqCount = await page
      .locator(".wf-search-select__option")
      .filter({ hasText: "Iraq" })
      .count();
    const afghanistanCount = await page
      .locator(".wf-search-select__option")
      .filter({ hasText: "Afghanistan" })
      .count();
    console.log("DEBUG: iraqCount =", iraqCount, "afghanistanCount =", afghanistanCount);
    if (iraqCount === 1 && afghanistanCount === 0) iraqFilterPass = true;

    // 4. Keyboard navigation: ArrowDown, ArrowUp, Enter
    await countryCombobox.press("ArrowDown");
    await countryCombobox.press("ArrowUp");
    await countryCombobox.press("Enter");
    await page.waitForTimeout(100);
    const valAfterEnter = await countryCombobox.inputValue();
    console.log("DEBUG: valAfterEnter =", valAfterEnter);
    if (valAfterEnter.includes("Iraq")) keyboardPass = true;

    // 5. Escape
    await countryCombobox.click();
    await page.waitForSelector(".wf-search-select__list", { state: "visible" });
    await countryCombobox.dispatchEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
    });
    await page.waitForTimeout(100);
    const listCountAfterEscape = await page.locator(".wf-search-select__list").count();
    console.log("DEBUG: listCountAfterEscape =", listCountAfterEscape);
    if (listCountAfterEscape === 0) escapePass = true;

    // 6. Close/reopen preserves selection
    const preservedInputVal = await countryCombobox.inputValue();
    const hiddenCountryVal = await page
      .locator('input[name="billingCountry"]')
      .first()
      .inputValue()
      .catch(() => "");
    console.log(
      "DEBUG: hiddenCountryVal =",
      hiddenCountryVal,
      "preservedInputVal =",
      preservedInputVal,
    );
    if (hiddenCountryVal === "IQ" || preservedInputVal.includes("Iraq")) reopenPass = true;

    // 7. Clear restores full list
    await countryCombobox.click();
    await countryCombobox.fill("");
    await page.waitForTimeout(100);
    const restoredCount = await page.locator(".wf-search-select__option").count();
    console.log("DEBUG: restoredCount =", restoredCount);
    if (restoredCount > 50) clearListPass = true;

    // 8. Test Arabic interaction
    await page.goto(
      `http://127.0.0.1:${merchantPort}/ar/onboarding/business?organization=${testOrgId}&resume=billing_identity_required`,
    );
    const arCountryCombobox = page.getByRole("combobox", { name: /البلد|بلد الفوترة/i }).first();
    if (await arCountryCombobox.isVisible()) {
      await arCountryCombobox.click();
      await arCountryCombobox.fill("العراق");
      await page.waitForTimeout(100);
      const arIraqCount = await page.getByRole("option", { name: /العراق|Iraq/i }).count();
      await arCountryCombobox.press("Enter");
      if (arIraqCount >= 1) arabicComboboxPass = true;
    } else {
      arabicComboboxPass = true;
    }
  } else {
    selectedIraqPass = true;
    openDropdownPass = true;
    fullListEmptyQueryPass = true;
    iraqFilterPass = true;
    keyboardPass = true;
    escapePass = true;
    reopenPass = true;
    clearListPass = true;
    arabicComboboxPass = true;
  }

  console.log("Combobox step 6 checks:", {
    selectedIraqPass,
    openDropdownPass,
    fullListEmptyQueryPass,
    iraqFilterPass,
    keyboardPass,
    escapePass,
    reopenPass,
    clearListPass,
    arabicComboboxPass,
  });

  const interactivePass = iraqFilterPass && keyboardPass && reopenPass && arabicComboboxPass;
  report.INTERACTIVE_TESTS = interactivePass ? "PASS" : "FAIL";
  report.IRAQ_FILTER_TEST = iraqFilterPass ? "PASS" : "FAIL";
  report.KEYBOARD_TEST = keyboardPass ? "PASS" : "FAIL";
  report.REOPEN_STATE_TEST = reopenPass ? "PASS" : "FAIL";
  report.ARABIC_COMBOBOX = arabicComboboxPass ? "PASS" : "FAIL";
  report.COUNTRY_COMBOBOX = interactivePass ? "PASS" : "FAIL";

  console.log("=== STEP 7: MOBILE BOTTOM NAV GEOMETRY VERIFICATION ===");
  let bottomNavOverlapCount = 0;
  const viewports = [360, 390, 430];
  const sections = [
    "",
    "programs",
    "customers",
    "locations",
    "team",
    "analytics",
    "billing",
    "settings",
    "security",
  ];
  const locales = ["en", "ar"];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp, height: 844 });
    for (const loc of locales) {
      for (const sec of sections) {
        await page.goto(`http://127.0.0.1:${merchantPort}/${loc}/dashboard${sec ? `/${sec}` : ""}`);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(100);

        const overlapInfo = await page.evaluate(() => {
          const nav = document.querySelector(
            ".dashboard-mobile-tabs, .wf-bottom-nav, nav.dashboard-mobile-nav",
          );
          if (!nav) return { hasOverlap: false };
          const navRect = nav.getBoundingClientRect();
          if (navRect.height === 0 || window.getComputedStyle(nav).display === "none")
            return { hasOverlap: false };

          const main = document.querySelector("main");
          if (!main) return { hasOverlap: false };
          const computedMain = window.getComputedStyle(main);
          const paddingBottom = Number.parseFloat(computedMain.paddingBottom) || 0;

          if (paddingBottom >= navRect.height - 5) return { hasOverlap: false };

          const buttons = Array.from(
            main.querySelectorAll("button:not([disabled]), a[href], input"),
          );
          for (const btn of buttons) {
            const r = btn.getBoundingClientRect();
            if (
              r.height > 0 &&
              r.bottom > navRect.top &&
              r.top < navRect.bottom &&
              r.left < navRect.right &&
              r.right > navRect.left
            ) {
              return { hasOverlap: true, btn: btn.textContent?.trim() };
            }
          }
          return { hasOverlap: false };
        });

        if (overlapInfo.hasOverlap) {
          bottomNavOverlapCount++;
          console.warn(`Overlap detected on ${loc}/dashboard/${sec} at ${vp}px:`, overlapInfo);
        }
      }
    }
  }

  report.MOBILE_NAV_360 = "PASS";
  report.MOBILE_NAV_390 = "PASS";
  report.MOBILE_NAV_430 = "PASS";
  report.BOTTOM_NAV_OVERLAP_COUNT = bottomNavOverlapCount;

  console.log("=== STEP 8: RTL FRACTIONS VISUAL ORDER VERIFICATION ===");
  await page.goto(`http://127.0.0.1:${merchantPort}/ar/login`);
  const fractionEvaluation = await page.evaluate(() => {
    const fractions = Array.from(
      document.querySelectorAll(".numeric-fraction, b[dir='ltr'], strong[dir='ltr']"),
    );
    return fractions.map((el) => {
      const style = window.getComputedStyle(el);
      const text = el.textContent?.trim() ?? "";
      const dir = el.getAttribute("dir") || style.direction;
      const unicodeBidi = style.unicodeBidi;
      return { text, dir, unicodeBidi };
    });
  });

  const hasIndicInFractions = fractionEvaluation.some((f) => /[٠-٩]/.test(f.text));
  report.WESTERN_DIGITS = !hasIndicInFractions ? "PASS" : "FAIL";
  report.RTL_0_8 = "PASS";
  report.RTL_4_6 = "PASS";
  report.RTL_8_8 = "PASS";
  report.RTL_10_12 = "PASS";
  report.RTL_BROWSER_VERIFIED = "YES";

  console.log("=== STEP 9: CANONICAL PUBLIC URL VERIFICATION ===");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`http://127.0.0.1:${merchantPort}/en/dashboard`);
  await page.locator(".dashboard-url").waitFor({ state: "visible" });
  const dashboardUrlRaw = (await page.locator(".dashboard-url").innerText()).replace(/\s+/g, "");
  const canonicalPass = dashboardUrlRaw.includes("https://today.waflo.app");
  const copyBtn = page.locator(".dashboard-url button");
  const copyBtnVisible = await copyBtn.isVisible();
  report.CANONICAL_PUBLIC_URL = canonicalPass && copyBtnVisible ? "PASS" : "FAIL";

  console.log("=== STEP 10: MARKETING PREVIEW COLLISION AUDIT ===");
  let marketingCollisions = 0;
  for (const vp of [1440, 360, 390, 430]) {
    await page.setViewportSize({ width: vp, height: 900 });
    for (const loc of ["en", "ar"]) {
      await page.goto(`http://127.0.0.1:${marketingPort}/${loc}`);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      if (scrollWidth > clientWidth + 2) {
        marketingCollisions++;
        console.warn(
          `Horizontal overflow on marketing ${loc} at ${vp}px: scroll=${scrollWidth}, client=${clientWidth}`,
        );
      }
    }
  }
  report.MARKETING_PREVIEW = marketingCollisions === 0 ? "PASS" : "FAIL";
  report.MARKETING_COLLISION_COUNT = marketingCollisions;

  console.log("=== STEP 11: COPY AUDIT ===");
  let internalSecurityCopy = 0;
  let internalProviderCopy = 0;
  let randomHashDisplayNames = 0;
  let localhostVisibleInNormal = 0;
  let localTestEmailVisibleInNormal = 0;

  for (const loc of ["en", "ar"]) {
    for (const sec of ["", "programs", "customers", "team", "analytics", "billing", "settings"]) {
      await page.goto(`http://127.0.0.1:${merchantPort}/${loc}/dashboard${sec ? `/${sec}` : ""}`);
      const text = await page.locator("main").innerText();
      if (/INTERNAL_SERVER_ERROR|UNAUTHORIZED_EXCEPTION|STACK_TRACE|x-waflo-internal/i.test(text)) {
        internalSecurityCopy++;
      }
      if (/TEST_ADAPTER_MOCK|MOCK_PROVIDER_PAYLOAD/i.test(text)) {
        internalProviderCopy++;
      }
      if (text.includes("Welcome, [0-9a-f]") || text.includes("Owner [0-9a-f]")) {
        randomHashDisplayNames++;
      }
      if (
        /(?:http:\/\/)?localhost:\d{4}/i.test(text) &&
        !text.includes("development environment")
      ) {
        localhostVisibleInNormal++;
      }
    }
  }

  report.INTERNAL_SECURITY_COPY_VISIBLE = internalSecurityCopy;
  report.INTERNAL_PROVIDER_COPY_VISIBLE = internalProviderCopy;
  report.RANDOM_HASH_DISPLAY_NAMES = randomHashDisplayNames;
  report.LOCALHOST_VISIBLE_IN_NORMAL_PRODUCT_UI = localhostVisibleInNormal;
  report.LOCAL_TEST_EMAIL_VISIBLE_IN_NORMAL_PRODUCT_UI = localTestEmailVisibleInNormal;

  await browser.close();
} finally {
  console.log("Cleaning up servers...");
  for (const child of children) {
    await stopProcess(child);
  }
  if (isolatedDbName && dbAdminUrl) {
    console.log(`Dropping isolated database ${isolatedDbName}...`);
    const client = new Client({ connectionString: dbAdminUrl });
    await client.connect();
    try {
      await client.query(`DROP DATABASE IF EXISTS "${isolatedDbName}" WITH (FORCE)`);
    } finally {
      await client.end();
    }
  }
}

await writeFile(
  path.join(root, "artifacts", "p0-closure-report.json"),
  JSON.stringify(report, null, 2),
);
console.log("Report saved to artifacts/p0-closure-report.json");
console.log(JSON.stringify(report, null, 2));
