import type { Locale } from "@waflo/contracts";
import { AdminCustomer360 } from "../../../../../components/admin-customer-360";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ locale: string; customerId: string }>;
}) {
  const { locale, customerId } = await params;
  return (
    <AdminCustomer360 customerId={customerId} locale={locale === "ar" ? "ar" : ("en" as Locale)} />
  );
}
