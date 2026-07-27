import type { Locale } from "@waflo/contracts";
import { LanguageSwitcher } from "@waflo/ui";
import Image from "next/image";
import type { ReactNode } from "react";

export function AuthLayout({ locale, children }: { locale: Locale; children: ReactNode }) {
  const ar = locale === "ar";
  return (
    <main className="auth-layout">
      <section className="auth-brand">
        <a href={process.env.NEXT_PUBLIC_MARKETING_URL ?? "http://localhost:3000"}>
          <Image
            className="auth-brand__logo"
            src="/brand/waflo-logo-white-horizontal.svg"
            alt="Waflo"
            width={280}
            height={80}
          />
        </a>
        <div className="auth-brand__message">
          <span>{ar ? "LOYALTY THAT FLOWS" : "LOYALTY THAT FLOWS"}</span>
          <h1>{ar ? "أساس قوي لعلاقة تدوم." : "A stronger foundation for every return."}</h1>
          <p>
            {ar
              ? "أنشئ حساب مؤسستك، جهّز فروعك وفريقك، واعرف بالضبط متى تبدأ تجربتك المجانية."
              : "Set up your organization, locations, and team—and know exactly when your free trial begins."}
          </p>
        </div>
        <small>Waflo · Tavrix LLC</small>
      </section>
      <section className="auth-panel">
        <div className="wf-card auth-card">
          <div className="auth-card__top">
            <Image
              src="/brand/waflo-logo-primary-horizontal.svg"
              alt="Waflo"
              width={280}
              height={80}
            />
            <LanguageSwitcher locale={locale} href={`/${locale === "ar" ? "en" : "ar"}/login`} />
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
