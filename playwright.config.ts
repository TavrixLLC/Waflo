import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const rateLimitNamespace = `playwright-${randomUUID()}`;

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
    baseURL: "http://localhost:3001",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testMatch: /platform\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "accessibility",
      testMatch: /accessibility\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
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
      url: "http://localhost:3002/?tenant=today",
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
