export function googleLinkErrorMessage(
  code: string | undefined,
  hasPassword: boolean,
  locale: "en" | "ar",
): string {
  const ar = locale === "ar";
  if (!hasPassword)
    return ar
      ? "أدخل كلمة مرور Waflo الحالية للمتابعة."
      : "Enter your current Waflo password to continue.";
  if (code === "REAUTHENTICATION_REQUIRED")
    return ar
      ? "تعذر التحقق من كلمة مرور Waflo. أعد إدخالها ثم حاول مرة أخرى."
      : "Waflo could not verify that password. Re-enter it and try again.";
  if (code === "PROVIDER_NOT_CONFIGURED")
    return ar
      ? "ربط Google غير مهيأ حالياً. حاول لاحقاً أو تواصل مع الدعم."
      : "Google linking is not configured right now. Try again later or contact support.";
  return ar ? "تعذر بدء ربط Google. حاول مرة أخرى." : "Unable to start Google linking. Try again.";
}
