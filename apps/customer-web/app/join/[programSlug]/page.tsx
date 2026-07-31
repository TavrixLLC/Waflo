import { headers } from "next/headers";
import { CustomerHeader, StateCard } from "../../page";
import { fetchCustomerApi, localeForRequest, type PublicProgram } from "../../server-api";
import { EnrollmentForm } from "./enrollment-form";

export const dynamic = "force-dynamic";

export default async function JoinProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ programSlug: string }>;
  searchParams: Promise<{ lang?: string; tenant?: string }>;
}) {
  const { programSlug } = await params;
  const query = await searchParams;
  const requestHeaders = await headers();
  const directHost = requestHeaders.get("host") ?? "";
  const host =
    directHost.includes(".localhost") || directHost.includes(".lvh.me")
      ? directHost
      : (requestHeaders.get("x-forwarded-host") ?? directHost);
  const localHost =
    directHost.includes("localhost") ||
    directHost.includes("127.0.0.1") ||
    directHost.includes(".lvh.me");
  const tenant = localHost ? query.tenant : undefined;
  const result = await fetchCustomerApi<{
    status: string;
    merchant?: { name: string; slug: string; defaultLocale: "en" | "ar" };
    program?: PublicProgram;
  }>(`/v1/public/programs/${encodeURIComponent(programSlug)}`, host, tenant);
  const locale = localeForRequest(
    query.lang,
    result.program?.policy.primaryCustomerLocale ?? result.merchant?.defaultLocale,
  );
  if (result.status !== "active" || !result.merchant || !result.program) {
    return (
      <main
        className="customer-page customer-centered"
        lang={locale}
        dir={locale === "ar" ? "rtl" : "ltr"}
      >
        <StateCard
          title={locale === "ar" ? "هذا التاجر غير متاح" : "This merchant is unavailable"}
          body={
            locale === "ar"
              ? "تواصل مع التاجر أو حاول مرة أخرى لاحقًا."
              : "Contact the merchant or try again later."
          }
        />
      </main>
    );
  }
  return (
    <main
      className="customer-page join-page"
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      style={
        {
          "--program-bg": result.program.theme.backgroundColor,
          "--program-ink": result.program.theme.foregroundColor,
          "--program-accent": result.program.theme.accentColor,
        } as React.CSSProperties
      }
    >
      <CustomerHeader locale={locale} {...(tenant ? { tenant } : {})} />
      <EnrollmentForm
        merchant={result.merchant}
        program={result.program}
        initialLocale={locale}
        {...(tenant ? { tenant } : {})}
      />
    </main>
  );
}
