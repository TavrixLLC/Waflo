import Image from "next/image";
import { headers } from "next/headers";
import { interfaceLocaleFor, interfaceTextLocaleFor } from "@waflo/i18n";

export default async function MerchantNotFound() {
  const requestedLocale = (await headers()).get("x-waflo-locale") ?? "en";
  const definition = interfaceLocaleFor(requestedLocale) ?? interfaceLocaleFor("en")!;
  const locale = interfaceTextLocaleFor(definition.id);
  const ar = locale === "ar";
  return (
    <main className="auth-panel" lang={definition.htmlLang} dir={definition.direction}>
      <section className="auth-card wf-card">
        <Image src="/brand/waflo-logo-primary-horizontal.svg" alt="Waflo" width={140} height={40} />
        <p className="auth-not-found__code">404</p>
        <h1>{ar ? "تعذر العثور على هذه الصفحة" : "This page could not be found"}</h1>
        <p className="auth-card__intro">
          {ar
            ? "تحقق من الرابط أو عُد إلى تسجيل الدخول."
            : "Check the address or return to merchant sign in."}
        </p>
        <a
          className="wf-button wf-button--primary auth-not-found__action"
          href={`/${definition.route}/login`}
        >
          {ar ? "العودة إلى تسجيل الدخول" : "Return to sign in"}
        </a>
      </section>
    </main>
  );
}
