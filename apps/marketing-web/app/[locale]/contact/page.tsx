import { notFound } from "next/navigation";
import { isLocale } from "@waflo/i18n";
import { Card } from "@waflo/ui";
import { MarketingShell } from "../../../components/marketing-shell";

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const ar = locale === "ar";
  return (
    <MarketingShell locale={locale}>
      <section className="marketing-container marketing-content">
        <span className="marketing-kicker">{ar ? "تواصل معنا" : "Contact Waflo"}</span>
        <h1>{ar ? "نحن نجهّز قنوات التواصل." : "We’re preparing our support channels."}</h1>
        <p className="marketing-content__lead">
          {ar
            ? "ستُنشر قنوات المبيعات والدعم الرسمية هنا قبل الإطلاق العام. يمكنك في الوقت الحالي متابعة إعداد حسابك من لوحة التاجر."
            : "Official sales and support channels will be published here before public launch. For now, you can continue setting up your account in the merchant dashboard."}
        </p>
        <Card style={{ maxWidth: 700, padding: "2rem", marginTop: "2rem" }}>
          <strong>Waflo · Tavrix LLC</strong>
          <p style={{ color: "var(--waflo-muted)", lineHeight: 1.7 }}>
            {ar
              ? "لن نعرض عنواناً أو وسيلة اتصال غير مؤكدة. ستتم مراجعة هذه الصفحة قبل الإطلاق."
              : "We will not publish an unverified address or contact method. This page will be reviewed before launch."}
          </p>
        </Card>
      </section>
    </MarketingShell>
  );
}
