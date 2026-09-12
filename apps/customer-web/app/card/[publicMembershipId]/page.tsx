import { CustomerCard } from "./customer-card";

export const dynamic = "force-dynamic";

export default async function CustomerCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicMembershipId: string }>;
  searchParams: Promise<{ tenant?: string | string[]; wallet?: string | string[] }>;
}) {
  const { publicMembershipId } = await params;
  const query = await searchParams;
  const tenant = typeof query.tenant === "string" ? query.tenant : undefined;
  const walletJourney = query.wallet === "prepare";
  return (
    <CustomerCard
      publicMembershipId={publicMembershipId}
      walletJourney={walletJourney}
      {...(tenant ? { tenant } : {})}
    />
  );
}
