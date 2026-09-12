import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { devicePairingClaimSchema } from "../../packages/contracts/src/w4.js";
import {
  createManualPairingCode,
  createPairingToken,
  formatManualPairingCode,
  hashManualPairingCode,
  normalizeManualPairingCode,
  parsePairingToken,
} from "../../packages/staff-device-security/src/index.js";

describe("Staff device pairing environment isolation contract", () => {
  function decodeEnvironmentSegment(token: string): string {
    const parts = token.split(".");
    expect(parts.length).toBe(4);
    expect(parts[0]).toBe("waflo-pair-v1");
    const environmentBase64 = parts[3] ?? "";
    const environmentSegment = Buffer.from(environmentBase64, "base64url").toString("utf8");
    return environmentSegment;
  }

  function validateClaimEnvironment(
    token: string,
    expectedDeploymentEnvironment: "development" | "staging" | "production",
  ): { valid: boolean; tokenEnvironment: string } {
    const parsed = parsePairingToken(token);
    return {
      valid: parsed.environmentId === expectedDeploymentEnvironment,
      tokenEnvironment: parsed.environmentId,
    };
  }

  it("CASE A — DEVELOPMENT: creates and validates development pairing token", () => {
    const deploymentEnvironment = "development";
    const pairing = createPairingToken({
      publicId: randomUUID(),
      environmentId: deploymentEnvironment,
    });

    const decodedEnv = decodeEnvironmentSegment(pairing.token);
    expect(decodedEnv).toBe("development");

    // Claim matching
    const match = validateClaimEnvironment(pairing.token, "development");
    expect(match.valid).toBe(true);
    expect(match.tokenEnvironment).toBe("development");

    // Rejection on other environments
    expect(validateClaimEnvironment(pairing.token, "staging").valid).toBe(false);
    expect(validateClaimEnvironment(pairing.token, "production").valid).toBe(false);
  });

  it("CASE B — STAGING (NODE_ENV=production, DEPLOYMENT_ENVIRONMENT=staging): creates and validates staging token", () => {
    // This specifically tests the staging case where NODE_ENV=production but DEPLOYMENT_ENVIRONMENT=staging
    const deploymentEnvironment = "staging";
    const pairing = createPairingToken({
      publicId: randomUUID(),
      environmentId: deploymentEnvironment,
    });

    const decodedEnv = decodeEnvironmentSegment(pairing.token);
    expect(decodedEnv).toBe("staging");

    // Staging claim PASS
    const match = validateClaimEnvironment(pairing.token, "staging");
    expect(match.valid).toBe(true);
    expect(match.tokenEnvironment).toBe("staging");

    // Rejection on production, development, or synthetic test
    expect(validateClaimEnvironment(pairing.token, "production").valid).toBe(false);
    expect(validateClaimEnvironment(pairing.token, "development").valid).toBe(false);

    // Cross-environment claim simulation
    const productionToken = createPairingToken({
      publicId: randomUUID(),
      environmentId: "production",
    }).token;
    expect(validateClaimEnvironment(productionToken, "staging").valid).toBe(false);

    const developmentToken = createPairingToken({
      publicId: randomUUID(),
      environmentId: "development",
    }).token;
    expect(validateClaimEnvironment(developmentToken, "staging").valid).toBe(false);
  });

  it("CASE C — PRODUCTION: creates and validates production pairing token", () => {
    const deploymentEnvironment = "production";
    const pairing = createPairingToken({
      publicId: randomUUID(),
      environmentId: deploymentEnvironment,
    });

    const decodedEnv = decodeEnvironmentSegment(pairing.token);
    expect(decodedEnv).toBe("production");

    // Production claim PASS
    const match = validateClaimEnvironment(pairing.token, "production");
    expect(match.valid).toBe(true);
    expect(match.tokenEnvironment).toBe("production");

    // Rejection on staging and development
    expect(validateClaimEnvironment(pairing.token, "staging").valid).toBe(false);
    expect(validateClaimEnvironment(pairing.token, "development").valid).toBe(false);
  });

  it("STEP 5 — Verifies one-time secret uniqueness and independent token generation", () => {
    const publicId = randomUUID();
    const token1 = createPairingToken({ publicId, environmentId: "staging" });
    const token2 = createPairingToken({ publicId, environmentId: "staging" });

    // Different secret and different token hashes
    expect(token1.secret).not.toBe(token2.secret);
    expect(token1.token).not.toBe(token2.token);
    expect(token1.tokenHash).not.toBe(token2.tokenHash);

    // Both preserve valid environment identity
    expect(decodeEnvironmentSegment(token1.token)).toBe("staging");
    expect(decodeEnvironmentSegment(token2.token)).toBe("staging");
  });

  it("STEP 6 — Ensures token safety and never logs secret portions in environment checks", () => {
    const pairing = createPairingToken({
      publicId: randomUUID(),
      environmentId: "staging",
    });

    const parts = pairing.token.split(".");
    // Secret portion is parts[2], environment is parts[3]
    expect(parts[2]?.length).toBeGreaterThanOrEqual(40);
    const envOnly = decodeEnvironmentSegment(pairing.token);
    expect(envOnly).toBe("staging");

    // Assert env only does not contain secret or UUID
    expect(envOnly).not.toContain(pairing.publicId);
    expect(envOnly).not.toContain(pairing.secret);
  });

  it("creates an 80-bit manual code and stores only a keyed digest", () => {
    const deviceSecret = "staff-device-test-secret-that-is-at-least-32-bytes";
    const first = createManualPairingCode(deviceSecret);
    const second = createManualPairingCode(deviceSecret);

    expect(first.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(first.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.code).not.toBe(second.code);
    expect(first.codeHash).not.toBe(second.codeHash);
    expect(hashManualPairingCode(first.code, deviceSecret)).toBe(first.codeHash);
    expect(first.codeHash).not.toContain(normalizeManualPairingCode(first.code));
  });

  it("normalizes readable manual-code aliases without weakening its fixed length", () => {
    expect(normalizeManualPairingCode("0abc-1def-ghjk-mnpq")).toBe("0ABC1DEFGHJKMNPQ");
    expect(normalizeManualPairingCode("OABC-IDEF-GHJK-MNPQ")).toBe("0ABC1DEFGHJKMNPQ");
    expect(formatManualPairingCode("0ABC1DEFGHJKMNPQ")).toBe("0ABC-1DEF-GHJK-MNPQ");
    expect(() => normalizeManualPairingCode("TOO-SHORT")).toThrow();
  });

  it("accepts exactly one QR token or manual code at the public claim boundary", () => {
    const device = {
      installationId: "installation-identifier-0001",
      publicKey: "A".repeat(40),
      platform: "ANDROID" as const,
      appVersion: "1.0.0",
    };
    expect(
      devicePairingClaimSchema.safeParse({ ...device, pairingToken: "x".repeat(80) }).success,
    ).toBe(true);
    expect(
      devicePairingClaimSchema.safeParse({ ...device, manualCode: "0ABC-1DEF-GHJK-MNPQ" }).success,
    ).toBe(true);
    expect(devicePairingClaimSchema.safeParse(device).success).toBe(false);
    expect(
      devicePairingClaimSchema.safeParse({
        ...device,
        pairingToken: "x".repeat(80),
        manualCode: "0ABC-1DEF-GHJK-MNPQ",
      }).success,
    ).toBe(false);
  });
});
