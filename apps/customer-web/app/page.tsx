import { Badge, Card } from "@waflo/ui";
import { ArrowRight, MapPin, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CustomerMerchantIdentity } from "./customer-merchant-identity";
import {
  fetchCustomerApi,
  localeForRequest,
  type PublicMerchant,
  type PublicProgram,
} from "./server-api";

export const dynamic = "force-dynamic";

export default async function MerchantProgramsPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; tenant?: string }>;
}) {
  const query = await searchParams;
  const requestHeaders = await headers();
  const directHost = requestHeaders.get("host") ?? "";
  const host = directHost;
  const localHost =
    directHost.includes("localhost") ||
    directHost.includes("127.0.0.1") ||
    directHost.includes(".lvh.me");
  const sharedStagingHost = directHost.split(":")[0] === "card-staging.waflo.app";
  const tenant = localHost || sharedStagingHost ? query.tenant : undefined;
  const result = await fetchCustomerApi<{
    status: string;
    merchant?: PublicMerchant;
    programs: PublicProgram[];
  }>("/v1/public/merchant-programs", host, tenant);
  const locale = localeForRequest(query.lang, result.merchant?.defaultLocale);
  const ar = locale === "ar";
  const linkParams = new URLSearchParams({ lang: locale });
  if (tenant) linkParams.set("tenant", tenant);
  const suffix = `?${linkParams.toString()}`;

  if (result.status === "active" && result.merchant && result.programs.length === 1) {
    const program = result.programs[0];
    if (!program) throw new Error("Single-program discovery result is unavailable.");
    const params = new URLSearchParams();
    if (tenant) params.set("tenant", tenant);
    params.set("lang", locale);
    const queryString = params.toString();
    redirect(`/join/${program.slug}${queryString ? `?${queryString}` : ""}`);
  }

  if (result.status !== "active" || !result.merchant) {
    return (
      <main className="customer-page customer-centered" lang={locale} dir={ar ? "rtl" : "ltr"}>
        <StateCard
          title={ar ? "هذه الصفحة غير متاحة" : "This page is unavailable"}
          body={
            ar
              ? "تحقق من الرابط أو تواصل مع التاجر مباشرة."
              : "Check the address or contact the merchant directly."
          }
        />
      </main>
    );
  }

  return (
    <main className="customer-page" lang={locale} dir={ar ? "rtl" : "ltr"}>
      <CustomerHeader
        locale={locale}
        merchantName={result.merchant.name}
        merchantLogoDataUri={result.merchant.brandLogoDataUri}
        {...(tenant ? { tenant } : {})}
      />
      <section className="customer-hero customer-hero--compact">
        <Badge tone="brand">{ar ? "مدعوم من Waflo" : "Powered by Waflo"}</Badge>
        <CustomerMerchantIdentity
          className="customer-merchant-mark"
          locale={locale}
          logoDataUri={result.merchant.brandLogoDataUri}
          name={result.merchant.name}
          showName={false}
        />
        <p className="customer-kicker">{result.merchant.name}</p>
        <h1>{ar ? "اختر بطاقة الولاء" : "Choose your loyalty card"}</h1>
        <p className="customer-lead">
          {ar
            ? "انضم خلال لحظات. لا تحتاج إلى تنزيل تطبيق."
            : "Join in moments. No app download is required."}
        </p>
      </section>
      {result.programs.length ? (
        <section className="program-grid" aria-label={ar ? "برامج الولاء" : "Loyalty programs"}>
          {result.programs.map((program) => {
            const copy = program.translations[locale] ?? program.translations.en;
            return (
              <Link
                className="program-choice"
                href={`/join/${program.slug}${suffix}`}
                key={program.slug}
              >
                <Card>
                  <span
                    className="program-choice__swatch"
                    style={{ background: program.theme.accentColor }}
                    aria-hidden="true"
                  />
                  <div>
                    <h2>{copy?.programName ?? program.slug}</h2>
                    <p>{copy?.shortDescription}</p>
                    <small>
                      <MapPin size={14} /> {program.locations.length}{" "}
                      {ar ? "موقع متاح" : "participating locations"}
                    </small>
                  </div>
                  <ArrowRight aria-hidden="true" />
                </Card>
              </Link>
            );
          })}
        </section>
      ) : (
        <StateCard
          title={ar ? "لا توجد بطاقة متاحة الآن" : "No card is available yet"}
          body={
            ar
              ? "سيعرض التاجر برنامجه هنا عند فتح التسجيل."
              : "The merchant’s program will appear here when enrollment opens."
          }
        />
      )}
      <footer className="customer-footer">
        <ShieldCheck size={17} />
        {ar ? "خصوصيتك مصممة بعناية · Tavrix LLC" : "Privacy by design · Tavrix LLC"}
      </footer>
    </main>
  );
}

export function CustomerHeader({
  locale,
  tenant,
  languagePath = "/",
  merchantName,
  merchantLogoDataUri,
}: {
  locale: "en" | "ar";
  tenant?: string;
  languagePath?: string;
  merchantName?: string;
  merchantLogoDataUri?: string | null | undefined;
}) {
  const nextLocale = locale === "ar" ? "en" : "ar";
  const homeParams = new URLSearchParams({ lang: locale });
  const languageParams = new URLSearchParams({ lang: nextLocale });
  if (tenant) {
    homeParams.set("tenant", tenant);
    languageParams.set("tenant", tenant);
  }
  return (
    <header className="customer-header">
      <Link href={`/?${homeParams.toString()}`}>
        {merchantName ? (
          <CustomerMerchantIdentity
            locale={locale}
            logoDataUri={merchantLogoDataUri}
            name={merchantName}
          />
        ) : (
          <Image
            className="customer-logo"
            src="/brand/waflo-logo-primary-horizontal.svg"
            alt="Waflo"
            width={280}
            height={80}
            priority
          />
        )}
      </Link>
      <Link className="customer-language" href={`${languagePath}?${languageParams.toString()}`}>
        {locale === "ar" ? "English" : "العربية"}
      </Link>
    </header>
  );
}

export function StateCard({ title, body }: { title: string; body: string }) {
  return (
    <section className="customer-state-card">
      <Image
        className="customer-logo"
        src="/brand/waflo-logo-primary-horizontal.svg"
        alt="Waflo"
        width={280}
        height={80}
      />
      <h1>{title}</h1>
      <p>{body}</p>
    </section>
  );
}
