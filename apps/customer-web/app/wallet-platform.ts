export type WalletPlatform = "ios" | "android" | "desktop";

export function walletPlatform(userAgent: string, maxTouchPoints = 0): WalletPlatform {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && maxTouchPoints > 1)) {
    return "ios";
  }
  return "desktop";
}
