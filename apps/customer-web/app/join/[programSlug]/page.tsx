import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { directionFor } from "@waflo/i18n";
import { CustomerHeader, StateCard } from "../../page";
import {
  CustomerPublicApiError,
  fetchCustomerApi,
  localeForRequest,
  type PublicProgram,
} from "../../server-api";
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
  const localHost =
    directHost.includes("localhost") ||
    directHost.includes("127.0.0.1") ||
    directHost.includes(".lvh.me");
  const sharedStagingHost = directHost.split(":")[0] === "card-staging.waflo.app";
  const tenant = localHost || sharedStagingHost ? query.tenant : undefined;
  type PublicProgramResponse = {
    status: string;
    merchant?: { name: string; slug: string; defaultLocale: "en" | "ar" };
    program?: PublicProgram;
  };
  let result: PublicProgramResponse | undefined;
  let requestFailure: CustomerPublicApiError | undefined;
  try {
    result = await fetchCustomerApi<PublicProgramResponse>(
      `/v1/public/programs/${encodeURIComponent(programSlug)}`,
      directHost,
      tenant,
    );
  } catch (error) {
    requestFailure =
      error instanceof CustomerPublicApiError
        ? error
        : new CustomerPublicApiError(503, undefined, "The customer service is unavailable.");
  }

  const locale = localeForRequest(
    query.lang,
    result?.program?.policy.primaryCustomerLocale ?? result?.merchant?.defaultLocale,
  );
  const ar = locale === "ar";
  const direction = directionFor(locale);
  if (requestFailure) {
    const programMissing =
      requestFailure.status === 404 && requestFailure.code === "PUBLIC_PROGRAM_NOT_FOUND";
    return (
      <main className="customer-page customer-centered" lang={locale} dir={direction}>
        <StateCard
          title={
            programMissing
              ? ar
                ? "بطاقة الولاء غير متاحة"
                : "This loyalty card is unavailable"
              : ar
                ? "تعذر فتح صفحة التاجر"
                : "We could not open this merchant page"
          }
          body={
            programMissing
              ? ar
                ? "قد تكون البطاقة غير منشورة أو لم تعد متاحة. تواصل مع التاجر إذا كنت تتوقع رؤيتها هنا."
                : "It may not be published or is no longer available. Contact the merchant if you expected to find it here."
              : ar
                ? "تحقق من الرابط وحاول مرة أخرى. إذا استمرت المشكلة، حاول لاحقاً."
                : "Check the link and try again. If the problem continues, try again later."
          }
        />
      </main>
    );
  }
  if (!result) throw new Error("Customer join result is unexpectedly unavailable.");
  const directHostname = directHost.toLocaleLowerCase("en-US").split(":")[0] ?? "";
  const isProductionCompatibilityHost =
    process.env.DEPLOYMENT_ENVIRONMENT === "production" && directHostname === "card.waflo.app";
  if (
    isProductionCompatibilityHost &&
    result.status === "active" &&
    result.merchant &&
    result.program
  ) {
    const canonical = new URL(
      `/join/${encodeURIComponent(programSlug)}`,
      `https://${result.merchant.slug}.waflo.app`,
    );
    if (query.lang === "en" || query.lang === "ar") canonical.searchParams.set("lang", query.lang);
    redirect(canonical.toString());
  }
  if (result.status !== "active" || !result.merchant || !result.program) {
    const merchantUnknown = result.status === "unknown";
    return (
      <main className="customer-page customer-centered" lang={locale} dir={direction}>
        <StateCard
          title={
            merchantUnknown
              ? ar
                ? "لم يتم العثور على هذا التاجر"
                : "We could not find this merchant"
              : ar
                ? "هذه الصفحة غير متاحة"
                : "This merchant page is unavailable"
          }
          body={
            merchantUnknown
              ? ar
                ? "تحقق من الرابط أو تواصل مع التاجر مباشرةً."
                : "Check the link or contact the merchant directly."
              : ar
                ? "تواصل مع التاجر أو حاول مرة أخرى لاحقاً."
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
      dir={direction}
      style={
        {
          "--program-bg": result.program.theme.backgroundColor,
          "--program-ink": result.program.theme.foregroundColor,
          "--program-accent": result.program.theme.accentColor,
        } as React.CSSProperties
      }
    >
      <CustomerHeader
        locale={locale}
        merchantName={result.merchant.name}
        {...(tenant ? { tenant } : {})}
      />
      <EnrollmentForm
        merchant={result.merchant}
        program={result.program}
        initialLocale={locale}
        {...(tenant ? { tenant } : {})}
      />
    </main>
  );
}
