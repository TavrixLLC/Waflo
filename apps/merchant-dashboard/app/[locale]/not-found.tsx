import Image from "next/image";
import { headers } from "next/headers";
import { interfaceLocaleFor, localeRegistry } from "@waflo/i18n";

export default async function MerchantNotFound() {
  const requestedLocale = (await headers()).get("x-waflo-locale") ?? "en";
  const definition = interfaceLocaleFor(requestedLocale) ?? localeRegistry.en;
  const copy = definition.messages.auth.notFound;
  return (
    <main className="auth-panel" lang={definition.htmlLang} dir={definition.direction}>
      <section className="auth-card wf-card">
        <Image src="/brand/waflo-logo-primary-horizontal.svg" alt="Waflo" width={140} height={40} />
        <p className="auth-not-found__code">404</p>
        <h1>{copy.title}</h1>
        <p className="auth-card__intro">{copy.description}</p>
        <a
          className="wf-button wf-button--primary auth-not-found__action"
          href={`/${definition.route}/login`}
        >
          {copy.action}
        </a>
      </section>
    </main>
  );
}
