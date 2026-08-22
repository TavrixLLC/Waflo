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
  return isLocale(locale) ? createMarketingMetadata(locale, "terms") : {};
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const ar = locale === "ar";
  return (
    <MarketingShell locale={locale} path="/terms">
      <article className="marketing-container marketing-content">
        <span className="marketing-kicker">{ar ? "الشروط" : "Terms"}</span>
        <h1>{ar ? "شروط استخدام Waflo" : "Waflo Terms of Service"}</h1>
        <p className="marketing-content__lead">
          {ar
            ? "هذه الشروط وثيقة تشغيلية أولية ستخضع لمراجعة قانونية قبل الإطلاق العام."
            : "These terms are an initial operating document and will receive legal review before public launch."}
        </p>
        <div className="marketing-legal">
          <p>
            <strong>{ar ? "تاريخ السريان:" : "Effective date:"}</strong>{" "}
            {configuredLegalEffectiveDate(locale)}
          </p>
          <h2>{ar ? "الخدمة" : "The service"}</h2>
          <p>
            {ar
              ? "تقدم Tavrix LLC منصة Waflo لمساعدة الأعمال المحلية على إنشاء وإدارة بطاقات وبرامج الولاء الرقمية. قد يعتمد توفر مزودي المحفظة على تهيئة الخدمة وبرنامج التاجر."
              : "Tavrix LLC provides Waflo to help local businesses create and manage digital loyalty cards and programs. Wallet-provider availability may depend on service and merchant-program configuration."}
          </p>
          <h2>{ar ? "الحسابات" : "Accounts"}</h2>
          <p>
            {ar
              ? "يتحمل المستخدم مسؤولية حماية بيانات الدخول، وصحة المعلومات التي يقدمها، واستخدام الصلاحيات وفق تفويض مؤسسته."
              : "Users are responsible for safeguarding credentials, providing accurate information, and using permissions within their organization’s authority."}
          </p>
          <h2>{ar ? "الخطط والفوترة" : "Plans and billing"}</h2>
          <p>
            {ar
              ? "تبدأ التجربة المجانية لمدة 7 أيام بعد اختيار الباقة ووتيرة الدفع وإضافة طريقة دفع صالحة وتأكيد الاشتراك. نوضح السعر وتاريخ أول دفعة قبل التأكيد."
              : "The seven-day free trial starts after you choose a plan and billing cadence, add a valid payment method, and confirm the subscription. We show the price and first charge date before confirmation."}
          </p>
          <h2>{ar ? "المراجعة القانونية" : "Legal review"}</h2>
          <p>
            {ar
              ? "لا تمثل هذه النسخة نصيحة قانونية نهائية، وستُستبدل بنسخة معتمدة قبل الإطلاق."
              : "This version is not final legal advice and will be replaced by an approved version before launch."}
          </p>
          <p>
            <a href={`/${locale}/contact`}>{ar ? "تواصل مع Waflo" : "Contact Waflo"}</a>
            {" · "}
            <a href={`/${locale}/refunds`}>
              {ar ? "سياسة الفوترة والاسترداد" : "Billing & Refund Policy"}
            </a>
          </p>
        </div>
      </article>
    </MarketingShell>
  );
}
