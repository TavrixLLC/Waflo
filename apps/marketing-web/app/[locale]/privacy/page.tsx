import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@waflo/i18n";
import { MarketingShell } from "../../../components/marketing-shell";
import { configuredLegalEffectiveDate, createMarketingMetadata } from "../../../lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return isLocale(locale) ? createMarketingMetadata(locale, "privacy") : {};
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const ar = locale === "ar";
  return (
    <MarketingShell locale={locale} path="/privacy">
      <article className="marketing-container marketing-content">
        <span className="marketing-kicker">{ar ? "الخصوصية" : "Privacy"}</span>
        <h1>{ar ? "سياسة خصوصية Waflo" : "Waflo Privacy Policy"}</h1>
        <p className="marketing-content__lead">
          {ar
            ? "توضح هذه الوثيقة المبادئ الأولية لمعالجة بيانات حسابات التجار. ستخضع لمراجعة قانونية قبل الإطلاق العام."
            : "This document outlines the initial principles for handling merchant account data. It will receive legal review before public launch."}
        </p>
        <div className="marketing-legal">
          <p>
            <strong>{ar ? "تاريخ السريان:" : "Effective date:"}</strong>{" "}
            {configuredLegalEffectiveDate(locale)}
          </p>
          <h2>{ar ? "الجهة المسؤولة" : "Who operates Waflo"}</h2>
          <p>
            {ar
              ? "Waflo مملوك ومُدار بواسطة Tavrix LLC."
              : "Waflo is owned and operated by Tavrix LLC."}
          </p>
          <h2>{ar ? "البيانات التي نعالجها" : "Data we process"}</h2>
          <p>
            {ar
              ? "بيانات الحساب والمؤسسة والجلسة اللازمة لتقديم المنصة وتأمينها، إضافة إلى سجلات تدقيق وأحداث أمان محدودة."
              : "Account, organization, and session data needed to provide and secure the platform, plus limited audit and security records."}
          </p>
          <h2>{ar ? "الأمان والاحتفاظ" : "Security and retention"}</h2>
          <p>
            {ar
              ? "نستخدم تجزئة قوية لكلمات المرور، وجلسات قابلة للإلغاء، وضوابط وصول متعددة المستأجرين. تُحدد مدد الاحتفاظ النهائية بعد المراجعة القانونية."
              : "We use strong password hashing, revocable sessions, and tenant-scoped access controls. Final retention periods will be set after legal review."}
          </p>
          <h2>{ar ? "التواصل" : "Contact"}</h2>
          <p>
            {ar
              ? "يمكنك استخدام صفحة التواصل العامة للوصول إلى قناة Waflo المعتمدة عند تهيئتها."
              : "Use the public contact page to reach Waflo through the configured support channel."}{" "}
            <a href={`/${locale}/contact`}>{ar ? "تواصل مع Waflo" : "Contact Waflo"}</a>
          </p>
        </div>
      </article>
    </MarketingShell>
  );
}
