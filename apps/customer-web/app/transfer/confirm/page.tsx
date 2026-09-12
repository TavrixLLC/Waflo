import { TransferEmailConfirmation } from "./transfer-email-confirmation";

export const dynamic = "force-dynamic";

export default async function TransferConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const query = await searchParams;
  return <TransferEmailConfirmation locale={query.lang === "ar" ? "ar" : "en"} />;
}
