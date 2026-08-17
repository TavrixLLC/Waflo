import type { Locale } from "@waflo/contracts";
import { LanguageSwitcher } from "@waflo/ui";
import { Gift, ShieldCheck } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

const STAMP_IDS = ["stamp-1", "stamp-2", "stamp-3", "stamp-4", "stamp-5", "stamp-6"] as const;

export function AuthLayout({ locale, children }: { locale: Locale; children: ReactNode }) {
  const ar = locale === "ar";
  return (
    <main className="auth-layout">
      <section className="auth-brand">
        <a href={process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://waflo.app"}>
          <Image
            className="auth-brand__logo"
            src="/brand/waflo-logo-white-horizontal.svg"
            alt="Waflo"
            width={280}
            height={80}
          />
        </a>
        <div className="auth-brand__message">
          <span>LOYALTY THAT FLOWS</span>
          <h1>{ar ? "كل زيارة تصبح سبباً للعودة." : "Every visit becomes a reason to return."}</h1>
          <p>
            {ar
              ? "أنشئ برنامج ولاء رقمياً واضحاً لعملائك، من أول زيارة إلى أول مكافأة."
              : "A calm, secure home for your loyalty program—from the first visit to the first reward."}
          </p>
          <div className="auth-loyalty-preview" aria-hidden="true">
            <div className="auth-loyalty-preview__identity">
              <span>W</span>
              <div>
                <small>{ar ? "بطاقة الولاء" : "LOYALTY CARD"}</small>
                <strong>{ar ? "مقهى وافلو" : "Waflo Coffee"}</strong>
              </div>
            </div>
            <div className="auth-loyalty-preview__stamps">
              {STAMP_IDS.map((stampId, index) => (
                <i className={index < 4 ? "is-filled" : ""} key={stampId} />
              ))}
            </div>
            <p>
              <span>
                <Gift size={15} /> {ar ? "باقي زيارتان للمكافأة" : "2 visits to your reward"}
              </span>
              <b dir="ltr" className="numeric-fraction">
                4 / 6
              </b>
            </p>
          </div>
        </div>
        <small className="auth-brand__security">
          <ShieldCheck size={16} />
          {ar ? "محمي بعناية من Waflo" : "Protected with care by Waflo"}
        </small>
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
          <div className="auth-card__body">{children}</div>
        </div>
      </section>
    </main>
  );
}
