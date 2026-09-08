import { describe, expect, it } from "vitest";
import { evaluateReleaseReadiness } from "../../apps/api/src/readiness-policy.js";

describe("release readiness policy", () => {
  const readyJourney = {
    DATABASE: { status: "READY" as const },
    REDIS: { status: "READY" as const },
    OBJECT_STORAGE: { status: "READY" as const },
    SMTP: { status: "READY" as const },
    GOOGLE_SIGNIN: { status: "READY" as const },
    APPLE_SIGNIN: { status: "NOT_CONFIGURED" as const },
    GOOGLE_WALLET: { status: "READY" as const, metadata: { demo: false } },
    APPLE_WALLET: { status: "READY" as const, metadata: { demo: false } },
    STRIPE: { status: "READY" as const },
    OPERATIONAL_WORKER: { status: "READY" as const },
    WALLET_WORKER: { status: "READY" as const },
    KEY_ROTATION_CONFIG: { status: "READY" as const },
  };

  it("accepts the deliberately removed Apple Sign-In surface", () => {
    expect(evaluateReleaseReadiness(readyJourney, "production")).toEqual({
      blockers: [],
      warnings: [],
    });
  });

  it("warns on degraded staging wallet worker while still blocking catalog drift and demo Wallets", () => {
    expect(
      evaluateReleaseReadiness(
        {
          ...readyJourney,
          STRIPE: { status: "INVALID_CONFIG" },
          WALLET_WORKER: { status: "DEGRADED" },
          GOOGLE_WALLET: { status: "READY", metadata: { demo: true } },
        },
        "staging",
      ),
    ).toEqual({
      blockers: ["GOOGLE_WALLET:DEMO_MODE", "STRIPE:INVALID_CONFIG"],
      warnings: ["WALLET_WORKER:DEGRADED"],
    });
  });

  it("still blocks degraded wallet worker outside staging", () => {
    expect(
      evaluateReleaseReadiness(
        {
          ...readyJourney,
          WALLET_WORKER: { status: "DEGRADED" },
        },
        "production",
      ),
    ).toEqual({
      blockers: ["WALLET_WORKER:DEGRADED"],
      warnings: [],
    });
  });

  it("allows Apple external certification only as an explicit staging warning", () => {
    const configurationReady = {
      ...readyJourney,
      APPLE_WALLET: { status: "CONFIG_READY" as const, metadata: { demo: false } },
    };
    expect(evaluateReleaseReadiness(configurationReady, "staging")).toEqual({
      blockers: [],
      warnings: ["APPLE_WALLET:CONFIG_READY"],
    });
    expect(evaluateReleaseReadiness(configurationReady, "production")).toEqual({
      blockers: ["APPLE_WALLET:CONFIG_READY"],
      warnings: [],
    });
  });
});
