import { CustomerCard } from "./customer-card";

export const dynamic = "force-dynamic";

export default async function CustomerCardPage({
  params,
}: {
  params: Promise<{ publicMembershipId: string }>;
}) {
  const { publicMembershipId } = await params;
  return <CustomerCard publicMembershipId={publicMembershipId} />;
}
