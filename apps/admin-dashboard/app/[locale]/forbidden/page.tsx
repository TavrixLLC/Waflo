import type { Locale } from "@waflo/contracts";
import { Alert } from "@waflo/ui";
import { adminCopy } from "../../../lib/admin-content";

export default async function ForbiddenPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  return (
    <main className="admin-gate">
      <Alert tone="danger" title={adminCopy(locale).forbidden} />
    </main>
  );
}
