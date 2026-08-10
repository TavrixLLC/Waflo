export type ApplePushDisposition = "SUCCESS" | "INVALID_TOKEN" | "RETRY" | "REJECTED";

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
