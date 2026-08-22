"use client";

import { interfaceLocales, type InterfaceLocale } from "@waflo/i18n";
import { InterfaceLanguagePicker } from "@waflo/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";

export function MerchantLanguagePicker({
  locale,
  routePath,
  label,
}: {
  locale: InterfaceLocale;
  routePath: string;
  label: string;
}) {
  const router = useRouter();
  const hrefForLocale = useCallback(
    (target: InterfaceLocale) =>
      `/${target}${routePath.startsWith("/") ? routePath : `/${routePath}`}`,
    [routePath],
  );

  useEffect(() => {
    for (const target of interfaceLocales) {
      if (target.id !== locale) router.prefetch(hrefForLocale(target.id));
    }
  }, [hrefForLocale, locale, router]);

  return (
    <InterfaceLanguagePicker
      locale={locale}
      hrefForLocale={hrefForLocale}
      onLocaleChange={(target) => router.push(hrefForLocale(target))}
      persistSelection
      label={label}
    />
  );
}
