import { notFound } from "next/navigation";
import { AdminPlaceholder } from "../../../../components/admin-placeholder";
import { adminNavigation } from "../../../../lib/admin-content";

export default async function SectionPage({
  params,
}: {
  params: Promise<{ locale: string; section: string }>;
}) {
  const { locale, section } = await params;
  const item = adminNavigation.find((candidate) => candidate.href === `/${section}`);
  if (!item || item.key === "overview") notFound();
  return (
    <AdminPlaceholder
      locale={locale === "ar" ? "ar" : "en"}
      section={item.key}
      permission={item.permission}
    />
  );
}
