import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@waflo/i18n";
import { Card } from "@waflo/ui";
import { MarketingShell } from "../../../components/marketing-shell";
import { configuredSupportEmail, createMarketingMetadata } from "../../../lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return isLocale(locale) ? createMarketingMetadata(locale, "contact") : {};
}

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const ar = locale === "ar";
  const supportEmail = configuredSupportEmail();
  const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "https://dashboard.waflo.app";
  return (
    <MarketingShell locale={locale} path="/contact">
      <section className="marketing-container marketing-content">
        <span className="marketing-kicker">{ar ? "تواصل معنا" : "Contact Waflo"}</span>
        <h1>{ar ? "كيف يمكننا مساعدتك؟" : "How can we help?"}</h1>
        <p className="marketing-content__lead">
          {ar
            ? "تواصل معنا بشأن إعداد حساب التاجر أو بطاقات الولاء الرقمية أو دعم حسابك."
            : "Contact us about merchant setup, digital loyalty cards, or support for your account."}
        </p>
        <Card style={{ maxWidth: 700, padding: "2rem", marginTop: "2rem" }}>
          <strong>Waflo · Tavrix LLC</strong>
          <p style={{ color: "var(--waflo-muted)", lineHeight: 1.7 }}>
            {supportEmail
              ? ar
                ? "أرسل رسالتك إلى قناة الدعم الرسمية:"
                : "Send your message to our configured support channel:"
              : ar
                ? "قناة البريد العامة قيد الإعداد. يمكن للتجار الحاليين متابعة حساباتهم من لوحة التاجر."
                : "The public email channel is being finalized. Existing merchants can continue in the merchant dashboard."}
          </p>
          {supportEmail ? (
            <a className="marketing-contact-link" href={`mailto:${supportEmail}`}>
              {supportEmail}
            </a>
          ) : (
            <a className="marketing-contact-link" href={`${dashboardUrl}/${locale}/login`}>
              {ar ? "فتح لوحة التاجر" : "Open merchant dashboard"}
            </a>
          )}
        </Card>
      </section>
    </MarketingShell>
  );
}
