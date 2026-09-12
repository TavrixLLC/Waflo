"use client";

import type { Locale } from "@waflo/contracts";
import { useParams } from "next/navigation";
import { AdminOverviewDashboard } from "../../../components/admin-overview-dashboard";

export default function OverviewPage() {
  const params = useParams<{ locale: Locale }>();
  return <AdminOverviewDashboard locale={params.locale} />;
}
