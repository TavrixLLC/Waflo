const checkoutSecretPatterns = [
  /\b(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]+\b/gu,
  /\b(?:cs|seti|pi)_(?:test|live)_[A-Za-z0-9_]+\b/gu,
  /\bwhsec_[A-Za-z0-9]+\b/gu,
  /\b(client_secret|token|authorization)=[^&\s]+/giu,
  /\b(?:authorization|bearer)\s+[^\s,;]+/giu,
];

/**
 * Keeps development-only Checkout Elements diagnostics useful without exposing
 * Stripe credentials or client secrets in the DOM or browser console.
 */
export function safeCheckoutElementsDiagnosticMessage(message: string): string {
  const redacted = checkoutSecretPatterns.reduce(
    (current, pattern) => current.replace(pattern, "[REDACTED]"),
    message,
  );
  return redacted
    .replace(/[\r\n\t]+/gu, " ")
    .trim()
    .slice(0, 500);
}
