import "dotenv/config";
import { randomUUID } from "node:crypto";
import { defineConfig } from "vitest/config";

process.env.RATE_LIMIT_NAMESPACE = `${process.env.RATE_LIMIT_NAMESPACE ?? "vitest"}-${process.pid}-${randomUUID()}`;
process.env.APPLE_PASS_TYPE_IDENTIFIER ||= "pass.app.waflo.test-adapter";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/helpers/require-isolated-test-database.ts"],
          hookTimeout: 60_000,
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: "concurrency",
          include: ["tests/concurrency/**/*.test.ts"],
          setupFiles: ["tests/helpers/require-isolated-test-database.ts"],
          hookTimeout: 120_000,
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: "http",
          include: ["tests/http/**/*.test.ts"],
          setupFiles: ["tests/helpers/require-isolated-test-database.ts"],
          hookTimeout: 120_000,
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: "failure",
          include: ["tests/failure/**/*.test.ts"],
          setupFiles: ["tests/helpers/require-isolated-test-database.ts"],
          hookTimeout: 120_000,
          testTimeout: 120_000,
        },
      },
    ],
  },
});
