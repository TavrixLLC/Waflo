export type ApplePushDisposition = "SUCCESS" | "INVALID_TOKEN" | "RETRY" | "REJECTED";
export type ApplePassPushOutcome = "SENT" | "NO_ACTIVE_WALLET_HOLDER";

/**
 * Wallet pass update pushes are not application background notifications.
 * Apple requires an empty JSON dictionary for the pass web-service update
 * flow; the pass type identifier remains the APNs topic.
 */
export function applePassUpdateRequestHeaders(passTypeIdentifier: string) {
  return {
    "apns-topic": passTypeIdentifier,
    "content-type": "application/json",
  };
}

export function appleCampaignDeliveryUpdate(outcome: ApplePassPushOutcome, completedAt: Date) {
  return outcome === "SENT"
    ? {
        status: "SUCCEEDED" as const,
        logicalSentAt: completedAt,
        completedAt,
        safeFailureCode: null,
      }
    : {
        status: "SKIPPED" as const,
        completedAt,
        safeSkipCode: "NO_ACTIVE_WALLET_HOLDER",
        safeFailureCode: null,
      };
}

const invalidApplePushTokenReasons = new Set([
  "BadDeviceToken",
  "DeviceTokenNotForTopic",
  "ExpiredToken",
  "Unregistered",
]);

export function classifyApplePushResponse(status: number, reason?: string): ApplePushDisposition {
  if (status >= 200 && status < 300) return "SUCCESS";
  if (reason && invalidApplePushTokenReasons.has(reason)) return "INVALID_TOKEN";
  if (status === 0 || status === 429 || status >= 500) return "RETRY";
  return "REJECTED";
}
