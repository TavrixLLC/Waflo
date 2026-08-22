export type ReleaseEnvironment = "development" | "staging" | "production";

export type ReleaseReadinessStatus =
  | "READY"
  | "NOT_CONFIGURED"
  | "UNREACHABLE"
  | "INVALID_CONFIG"
  | "DEGRADED"
  | "DISABLED"
  | "CONFIG_MISSING"
  | "CONFIG_READY"
  | "PROVIDER_ERROR";

export interface ReleaseReadinessResult {
  status: ReleaseReadinessStatus;
  metadata?: Record<string, unknown>;
}

export interface ReleaseReadinessDecision {
  blockers: string[];
  warnings: string[];
}

export function evaluateReleaseReadiness(
  results: Readonly<Record<string, ReleaseReadinessResult>>,
  environment: ReleaseEnvironment,
): ReleaseReadinessDecision {
  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const [component, result] of Object.entries(results)) {
    // Apple Sign-In was deliberately removed from the product. Its absence is the
    // expected secure state and must not block Wallet-provider readiness.
    if (component === "APPLE_SIGNIN" && result.status === "NOT_CONFIGURED") continue;

    // Apple's production certificate can be validated locally before Apple/device
    // verification is complete. Permit that explicit state on staging only so the
    // release can be tested without misrepresenting production readiness.
    if (
      component === "APPLE_WALLET" &&
      result.status === "CONFIG_READY" &&
      environment === "staging"
    ) {
      warnings.push(`${component}:${result.status}`);
      continue;
    }

    if (result.status !== "READY") {
      blockers.push(`${component}:${result.status}`);
      continue;
    }

    // A demo Wallet implementation is useful in development but cannot validate a
    // deployed customer journey. Block it even when its in-process health is green.
    if (
      (component === "GOOGLE_WALLET" || component === "APPLE_WALLET") &&
      result.metadata?.demo === true &&
      environment !== "development"
    ) {
      blockers.push(`${component}:DEMO_MODE`);
    }
  }

  return { blockers, warnings };
}
