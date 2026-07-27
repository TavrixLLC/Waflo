import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
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
          hookTimeout: 60_000,
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: "concurrency",
          include: ["tests/concurrency/**/*.test.ts"],
          hookTimeout: 120_000,
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: "http",
          include: ["tests/http/**/*.test.ts"],
          hookTimeout: 120_000,
          testTimeout: 120_000,
        },
      },
    ],
  },
});
