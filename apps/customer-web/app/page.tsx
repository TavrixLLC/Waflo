import { Alert, Badge, Button, Card } from "@waflo/ui";
import { Clock3, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

type Resolution =
  | {
      status: "active";
      merchant: {
        id: string;
        name: string;
        slug: string;
        defaultLocale: "en" | "ar";
        hostname: string;
      };
    }
  | { status: "unknown" | "reserved" | "suspended" | "malformed" };

async function resolveMerchant(host: string, tenant?: string): Promise<Resolution> {
  const apiUrl = process.env.API_PUBLIC_URL ?? "http://localhost:4000";
  const url = new URL("/v1/public/merchant-host/resolve", apiUrl);
  url.searchParams.set("host", host);
  if (tenant) url.searchParams.set("tenant", tenant);

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return { status: "unknown" };
    const payload = (await response.json()) as { data?: Resolution };
    return payload.data ?? { status: "unknown" };
  } catch {
    return { status: "unknown" };
  }
}

export default async function MerchantPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; tenant?: string }>;
}) {
  const requestHeaders = await headers();
  const query = await searchParams;
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
  const resolution = await resolveMerchant(host, query.tenant);
  const locale =
    query.lang === "ar" || query.lang === "en"
      ? query.lang
      : resolution.status === "active"
        ? resolution.merchant.defaultLocale
        : "en";
  const ar = locale === "ar";

  if (resolution.status !== "active") {
    const suspended = resolution.status === "suspended";
    return (
      <main className="customer-page" dir={ar ? "rtl" : "ltr"} lang={locale}>
        <section className="customer-state-card">
          <img
            className="customer-logo"
            src="/brand/waflo-logo-primary-horizontal.svg"
            alt="Waflo"
          />
          <span className="customer-kicker">{suspended ? "503" : "404"}</span>
          <h1>
            {ar
              ? suspended
                ? "هذه الصفحة غير متاحة مؤقتاً"
                : "لم نعثر على هذا التاجر"
              : suspended
                ? "This page is temporarily unavailable"
                : "We could not find this merchant"}
          </h1>
          <p>
            {ar
              ? suspended
                ? "يرجى المحاولة لاحقاً أو التواصل مع التاجر مباشرة."
                : "تحقق من الرابط ثم حاول مرة أخرى."
              : suspended
                ? "Please try again later or contact the merchant directly."
                : "Check the address and try again."}
          </p>
          <a href="https://waflo.app">
            <Button>{ar ? "زيارة Waflo" : "Visit Waflo"}</Button>
          </a>
        </section>
      </main>
    );
  }

  const merchant = resolution.merchant;
  return (
    <main className="customer-page" dir={ar ? "rtl" : "ltr"} lang={locale}>
      <header className="customer-header">
        <img className="customer-logo" src="/brand/waflo-logo-primary-horizontal.svg" alt="Waflo" />
        <a
          className="customer-language"
          href={`/?lang=${ar ? "en" : "ar"}${query.tenant ? `&tenant=${query.tenant}` : ""}`}
        >
          {ar ? "English" : "العربية"}
        </a>
      </header>

      <section className="customer-hero">
        <Badge tone="brand">{ar ? "مدعوم من Waflo" : "Powered by Waflo"}</Badge>
        <span className="customer-merchant-mark" aria-hidden="true">
          {merchant.name.slice(0, 1).toLocaleUpperCase(locale)}
        </span>
        <p className="customer-kicker">{merchant.name}</p>
        <h1>{ar ? "تجربة الولاء قيد التحضير" : "The loyalty experience is being prepared"}</h1>
        <p className="customer-lead">
          {ar
            ? "يجهّز هذا التاجر تجربة ولاء جديدة. لا يوجد برنامج منشور أو تسجيل عملاء في هذه المرحلة."
            : "This merchant is preparing a new loyalty experience. No program is published and customer enrollment is not active yet."}
        </p>
        <Alert
          tone="info"
          title={ar ? "لا يلزمك إجراء أي شيء الآن" : "Nothing is required from you yet"}
        >
          {ar
            ? "عد لاحقاً عندما يعلن التاجر عن إطلاق برنامجه."
            : "Return when the merchant announces that its program is live."}
        </Alert>
      </section>

      <section className="customer-facts" aria-label={ar ? "معلومات الصفحة" : "Page information"}>
        <Card>
          <Clock3 aria-hidden="true" />
          <h2>{ar ? "قريباً" : "Coming later"}</h2>
          <p>{ar ? "النشر يبدأ في مرحلة لاحقة." : "Publishing starts in a later phase."}</p>
        </Card>
        <Card>
          <ShieldCheck aria-hidden="true" />
          <h2>{ar ? "صفحة آمنة" : "Safe by design"}</h2>
          <p>{ar ? "لا تطلب هذه الصفحة بياناتك." : "This page does not ask for your data."}</p>
        </Card>
        <Card>
          <MapPin aria-hidden="true" />
          <h2>{ar ? "من التاجر" : "From the merchant"}</h2>
          <p>{ar ? "سيشارك التاجر تفاصيل الإطلاق." : "The merchant will share launch details."}</p>
        </Card>
      </section>

      <footer className="customer-footer">
        <Sparkles aria-hidden="true" size={18} />
        <span>{ar ? "تجربة مدعومة من Waflo" : "An experience powered by Waflo"}</span>
      </footer>
    </main>
  );
}
