"use client";

import type { Locale } from "@waflo/contracts";
import { Card } from "@waflo/ui";
import { type AdminNavigationKey, adminCopy } from "../lib/admin-content";
import { RequireAdminCapability } from "./admin-session";

export function AdminPlaceholder({
  locale,
  section,
  permission,
}: {
  locale: Locale;
  section: AdminNavigationKey;
  permission: string;
}) {
  const text = adminCopy(locale);
  return (
    <RequireAdminCapability permission={permission} locale={locale}>
      <header className="admin-page-header">
        <span>{text.internal}</span>
        <h1>{text[section]}</h1>
      </header>
      <Card className="admin-coming-soon">
        <strong>{text[section]}</strong>
        <p>{text.comingSoon}</p>
      </Card>
    </RequireAdminCapability>
  );
}
