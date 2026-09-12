import { isInterfaceLocale, messages, type InterfaceMessages } from "@waflo/i18n";
import type { Metadata } from "next";

type AuthMetadataKey = keyof InterfaceMessages["auth"]["metadata"];

export async function authPageMetadata(
  params: Promise<{ locale: string }>,
  key: AuthMetadataKey,
): Promise<Metadata> {
  const { locale } = await params;
  const copy = isInterfaceLocale(locale) ? messages[locale] : messages.en;
  return { title: copy.auth.metadata[key] };
}
