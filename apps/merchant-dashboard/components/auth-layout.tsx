import { directionForInterface, messages, type InterfaceLocale } from "@waflo/i18n";
import { Gift, ShieldCheck } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { MerchantLanguagePicker } from "./merchant-language-picker";

const STAMP_IDS = ["stamp-1", "stamp-2", "stamp-3", "stamp-4", "stamp-5", "stamp-6"] as const;

export function AuthLayout({
  locale,
  routePath = "/login",
  children,
}: {
  locale: InterfaceLocale;
  routePath?: string;
  children: ReactNode;
}) {
  const interfaceDirection = directionForInterface(locale);
  const copy = messages[locale];
  return (
    <main className="auth-layout" dir={interfaceDirection}>
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
          <span>{copy.auth.layout.eyebrow}</span>
          <h1>{copy.auth.layout.headline}</h1>
          <p>{copy.auth.layout.description}</p>
          <div className="auth-loyalty-preview" aria-hidden="true">
            <div className="auth-loyalty-preview__identity">
              <span>W</span>
              <div>
                <small>{copy.auth.layout.loyaltyCard}</small>
                <strong>{copy.auth.layout.previewMerchantName}</strong>
              </div>
            </div>
            <div className="auth-loyalty-preview__stamps">
              {STAMP_IDS.map((stampId, index) => (
                <i className={index < 4 ? "is-filled" : ""} key={stampId} />
              ))}
            </div>
            <p>
              <span>
                <Gift size={15} /> {copy.auth.layout.visitsToReward}
              </span>
              <b dir="ltr" className="numeric-fraction">
                4 / 6
              </b>
            </p>
          </div>
        </div>
        <small className="auth-brand__security">
          <ShieldCheck size={16} />
          {copy.auth.layout.protectedByWaflo}
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
            <MerchantLanguagePicker
              locale={locale}
              routePath={routePath}
              label={copy.language.label}
            />
          </div>
          <div className="auth-card__body">{children}</div>
        </div>
      </section>
    </main>
  );
}
