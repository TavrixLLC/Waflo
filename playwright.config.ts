import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const rateLimitNamespace = `playwright-${randomUUID()}`;
// biome-ignore lint/suspicious/noUndeclaredEnvVars: local browser verification may use an installed Chrome when the bundled headless shell is unavailable.
const localChrome = process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === "1" ? { channel: "chrome" } : {};
// biome-ignore lint/suspicious/noUndeclaredEnvVars: lets local visual QA avoid a port already owned by another Waflo service.
const merchantBaseUrl = process.env.WAFLO_E2E_BASE_URL ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: merchantBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testMatch:
        /(?:^|[/\\])(?:platform|merchant-loyalty-cards|merchant-template-gallery|merchant-card-builder|merchant-loyalty-studio|merchant-loyalty-studio-evidence|merchant-launch-publish|merchant-launch-publish-evidence|merchant-p5-polish)\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], ...localChrome },
    },
    {
      name: "accessibility",
      testMatch: /(?:^|[/\\])accessibility\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], ...localChrome },
    },
    {
      name: "w3",
      testMatch: /w3-platform\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], ...localChrome },
    },
    {
      name: "w3-accessibility",
      testMatch: /w3-accessibility\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], ...localChrome },
    },
    {
      name: "w3-evidence",
      testMatch: /w3-evidence-extra\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], ...localChrome },
    },
    {
      name: "w3-provider-disabled",
      testMatch: /w3-provider-disabled\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], ...localChrome },
    },
    {
      name: "w4",
      testMatch: /w4-platform\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], ...localChrome },
    },
    {
      name: "w4-accessibility",
      testMatch: /w4-accessibility\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], ...localChrome },
    },
  ],
  webServer: process.env.WAFLO_MANAGED_SERVERS
    ? undefined
    : [
        {
          command: "node dist/main.js",
          cwd: "apps/api",
          url: "http://localhost:4000/ready",
          env: { RATE_LIMIT_NAMESPACE: rateLimitNamespace },
          reuseExistingServer: false,
          timeout: 120_000,
          stdout: "pipe",
          stderr: "pipe",
        },
        {
          command: "node node_modules/next/dist/bin/next start -p 3000",
          cwd: "apps/marketing-web",
          url: "http://localhost:3000/en",
          reuseExistingServer: true,
          timeout: 120_000,
          stdout: "pipe",
          stderr: "pipe",
        },
        {
          command: "node node_modules/next/dist/bin/next start -p 3001",
          cwd: "apps/merchant-dashboard",
          url: "http://localhost:3001/en/login",
          reuseExistingServer: true,
          timeout: 120_000,
          stdout: "pipe",
          stderr: "pipe",
        },
        {
          command: "node node_modules/next/dist/bin/next start -p 3002",
          cwd: "apps/customer-web",
          url: "http://localhost:3002/privacy",
          reuseExistingServer: true,
          timeout: 120_000,
          stdout: "pipe",
          stderr: "pipe",
        },
      ],
});
