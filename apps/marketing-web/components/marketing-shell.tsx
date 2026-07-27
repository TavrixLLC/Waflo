import type { Locale } from "@waflo/contracts";
import { messages } from "@waflo/i18n";
import { Button, LanguageSwitcher } from "@waflo/ui";
import Image from "next/image";
import type { ReactNode } from "react";

const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "http://localhost:3001";

export function MarketingShell({ locale, children }: { locale: Locale; children: ReactNode }) {
  const copy = messages[locale];
  const alternate = locale === "en" ? "ar" : "en";
  return (
    <div className="marketing-shell">
      <header className="marketing-container marketing-header">
        <a href={`/${locale}`} className="marketing-logo" aria-label="Waflo home">
          {/* The approved official outlined logo is preserved as an external asset. */}
          <Image
            src="/brand/waflo-logo-primary-horizontal.svg"
            alt="Waflo"
            width={280}
            height={80}
          />
        </a>
        <nav className="marketing-nav" aria-label={locale === "ar" ? "التنقل الرئيسي" : "Main"}>
          <a href={`/${locale}`}>{copy.navigation.home}</a>
          <a href={`/${locale}/pricing`}>{copy.navigation.pricing}</a>
          <a href={`/${locale}/contact`}>{copy.navigation.contact}</a>
        </nav>
        <div className="marketing-actions">
          <LanguageSwitcher locale={locale} href={`/${alternate}`} />
          <a href={`${dashboardUrl}/${locale}/login`}>
            <Button variant="secondary">{copy.navigation.login}</Button>
          </a>
          <a href={`${dashboardUrl}/${locale}/signup`}>
            <Button>{copy.navigation.signup}</Button>
          </a>
        </div>
      </header>
      <main>{children}</main>
      <footer className="marketing-container marketing-footer">
        <div className="marketing-footer__top">
          <div>
            <Image
              src="/brand/waflo-logo-primary-horizontal.svg"
              alt="Waflo"
              width={280}
              height={80}
            />
            <p>{copy.brandTagline}</p>
          </div>
          <div className="marketing-footer__links">
            <a href={`/${locale}/pricing`}>{copy.navigation.pricing}</a>
            <a href={`/${locale}/contact`}>{copy.navigation.contact}</a>
            <a href={`/${locale}/privacy`}>{locale === "ar" ? "الخصوصية" : "Privacy"}</a>
            <a href={`/${locale}/terms`}>{locale === "ar" ? "الشروط" : "Terms"}</a>
          </div>
        </div>
        <div className="marketing-footer__legal">
          <span>
            © 2026 Tavrix LLC. {locale === "ar" ? "جميع الحقوق محفوظة." : "All rights reserved."}
          </span>
          <span>
            {locale === "ar"
              ? "Waflo منتج مملوك ومُدار بواسطة Tavrix LLC."
              : "Waflo is owned and operated by Tavrix LLC."}
          </span>
        </div>
      </footer>
    </div>
  );
}
