import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { directionFor } from "@waflo/i18n";
import { CustomerHeader, StateCard } from "../../page";
import {
  cardLocaleForRequest,
  CustomerPublicApiError,
  fetchCustomerApi,
  localeForRequest,
  type PublicMerchant,
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
    merchant?: PublicMerchant;
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

  const interfaceLocale = localeForRequest(
    query.lang === "en" || query.lang === "ar" ? query.lang : undefined,
    result?.program?.policy.primaryCustomerLocale ?? result?.merchant?.defaultLocale,
  );
  const cardLocale = result?.program
    ? cardLocaleForRequest(query.lang, result.program, requestHeaders.get("accept-language"))
    : interfaceLocale;
  const ar = interfaceLocale === "ar";
  const direction = directionFor(interfaceLocale);
  if (requestFailure) {
    const programMissing =
      requestFailure.status === 404 && requestFailure.code === "PUBLIC_PROGRAM_NOT_FOUND";
    return (
      <main className="customer-page customer-centered" lang={interfaceLocale} dir={direction}>
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
    canonical.searchParams.set("lang", cardLocale);
    redirect(canonical.toString());
  }
  if (result.status !== "active" || !result.merchant || !result.program) {
    const merchantUnknown = result.status === "unknown";
    return (
      <main className="customer-page customer-centered" lang={interfaceLocale} dir={direction}>
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
      lang={interfaceLocale}
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
        locale={interfaceLocale}
        merchantName={result.merchant.name}
        merchantLogoDataUri={result.merchant.brandLogoDataUri}
        {...(tenant ? { tenant } : {})}
      />
      <EnrollmentForm
        merchant={result.merchant}
        program={result.program}
        initialLocale={cardLocale}
        interfaceLocale={interfaceLocale}
        {...(tenant ? { tenant } : {})}
      />
    </main>
  );
}
