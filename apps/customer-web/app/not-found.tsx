import Image from "next/image";
import { headers } from "next/headers";

export default async function CustomerNotFound() {
  const locale = (await headers()).get("x-waflo-locale") === "ar" ? "ar" : "en";
  const ar = locale === "ar";
  return (
    <main className="customer-page customer-centered" lang={locale} dir={ar ? "rtl" : "ltr"}>
      <section className="customer-state-card">
        <Image
          className="customer-logo"
          src="/brand/waflo-logo-primary-horizontal.svg"
          alt="Waflo"
          width={280}
          height={80}
        />
        <p className="customer-kicker">404</p>
        <h1>{ar ? "تعذر العثور على هذه الصفحة" : "This page could not be found"}</h1>
        <p>
          {ar
            ? "تحقق من الرابط أو عُد إلى صفحة بطاقات الولاء."
            : "Check the address or return to the loyalty-card page."}
        </p>
        <a className="wf-button wf-button--primary" href={`/?lang=${locale}`}>
          {ar ? "العودة" : "Return"}
        </a>
      </section>
    </main>
  );
}
