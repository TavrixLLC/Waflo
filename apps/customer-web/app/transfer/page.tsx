import { TransferFlow } from "./transfer-flow";

export const dynamic = "force-dynamic";

export default async function TransferPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const query = await searchParams;
  const locale = query.lang === "ar" ? "ar" : "en";
  return <TransferFlow initialLocale={locale} />;
}
