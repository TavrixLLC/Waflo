import Image from "next/image";
import { headers } from "next/headers";

export default async function NotFound() {
  const locale = (await headers()).get("x-waflo-locale") === "ar" ? "ar" : "en";
  const ar = locale === "ar";
  return (
    <main className="marketing-container marketing-content" lang={locale} dir={ar ? "rtl" : "ltr"}>
      <Image src="/brand/waflo-logo-primary-horizontal.svg" alt="Waflo" width={140} height={40} />
      <p className="marketing-kicker" style={{ marginTop: "4rem" }}>
        404
      </p>
      <h1>{ar ? "هذه الصفحة خرجت عن المسار." : "This page has moved out of the flow."}</h1>
      <p className="marketing-content__lead">
        {ar ? "تعذر العثور على الصفحة التي طلبتها." : "The page you requested could not be found."}
      </p>
      <a className="wf-button wf-button--primary marketing-button-link" href={`/${locale}`}>
        {ar ? "العودة إلى الرئيسية" : "Return home"}
      </a>
    </main>
  );
}
