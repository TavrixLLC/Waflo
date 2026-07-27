import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Building2, CreditCard, Smartphone, Sparkles } from "lucide-react";
import { messages, isLocale } from "@waflo/i18n";
import { Button, Card } from "@waflo/ui";
import { MarketingShell } from "../../components/marketing-shell";

export const metadata: Metadata = {
  title: "Wallet-first loyalty for local businesses",
};

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const ar = locale === "ar";
  const copy = messages[locale];
  const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "http://localhost:3001";
  const features = ar
    ? [
        {
          title: "مصمم للمحفظة الرقمية",
          description:
            "تجارب ولاء مبنية لتعمل مستقبلاً مع Apple Wallet وGoogle Wallet من دون تطبيق إضافي للعميل.",
        },
        {
          title: "إدارة واضحة للتاجر",
          description:
            "لوحة تحكم ثنائية اللغة لتنظيم الفروع والفريق والفوترة ضمن حدود الخطة المختارة.",
        },
        {
          title: "جاهز لنمو علامتك",
          description: "هوية مرنة ومراحل تطوير مدروسة تبدأ بأساس آمن وتتوسع مع احتياجات نشاطك.",
        },
      ]
    : [
        {
          title: "Designed for wallets",
          description:
            "Loyalty experiences built to support Apple Wallet and Google Wallet—without another customer app.",
        },
        {
          title: "Clear merchant control",
          description:
            "A bilingual dashboard for locations, teams, and billing within your selected plan.",
        },
        {
          title: "Ready to grow with you",
          description:
            "Flexible branding and a deliberate platform foundation that expands with your business.",
        },
      ];
  return (
    <MarketingShell locale={locale}>
      <section className="marketing-container marketing-hero">
        <div className="marketing-hero__content">
          <span className="marketing-kicker">
            <Sparkles size={16} aria-hidden="true" />
            {ar ? "ولاء رقمي للأعمال المحلية" : "Digital loyalty for local businesses"}
          </span>
          <h1>
            {ar ? (
              <>
                كل زيارة تستحق <span>سبباً للعودة.</span>
              </>
            ) : (
              <>
                Turn every visit into a <span>reason to return.</span>
              </>
            )}
          </h1>
          <p className="marketing-hero__lead">
            {ar
              ? "Waflo منصة ولاء رقمية تبدأ من المحفظة، وتمنح نشاطك تجربة مرنة من دون مطالبة العملاء بتثبيت تطبيق جديد."
              : "Waflo is a wallet-first loyalty platform that gives local businesses a flexible digital experience—without asking customers to install another app."}
          </p>
          <div className="marketing-hero__actions">
            <a href={`${dashboardUrl}/${locale}/signup`}>
              <Button>{ar ? "ابدأ تجربتك المجانية" : "Start your free trial"}</Button>
            </a>
            <a href={`/${locale}/pricing`}>
              <Button variant="secondary">{ar ? "استكشف الأسعار" : "Explore pricing"}</Button>
            </a>
          </div>
          <p className="marketing-trial-note">
            <CreditCard size={17} aria-hidden="true" />
            {copy.trial.pending}
          </p>
        </div>
        <div
          className="marketing-visual"
          role="img"
          aria-label={ar ? "رحلة الولاء مع Waflo" : "Waflo loyalty flow"}
        >
          <div className="marketing-flow">
            <div className="marketing-flow__top">
              <img className="marketing-flow__mark" src="/brand/waflo-mark-white.svg" alt="" />
              <span className="marketing-flow__status">
                {ar ? "تجربة ولاء ذكية" : "SMART LOYALTY"}
              </span>
            </div>
            <div className="marketing-flow__content">
              <h2>{ar ? "اكتشاف. زيارة. عودة. مكافأة." : "Discover. Visit. Return. Reward."}</h2>
              <p>
                {ar
                  ? "مسار واضح يساعد عميلك على العودة، ويحافظ على حضور علامتك في كل خطوة."
                  : "A clear path that encourages return visits and keeps your brand present at every step."}
              </p>
              <div className="marketing-flow__steps" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-section marketing-section--warm">
        <div className="marketing-container">
          <div className="marketing-section__heading">
            <h2>
              {ar
                ? "بساطة يشعر بها العميل. أساس يثق به التاجر."
                : "Simple for customers. Dependable for merchants."}
            </h2>
            <p>
              {ar
                ? "نبني Waflo حول خطوات واضحة، وتجربة قليلة الاحتكاك، وأساس يحمي حسابات التجار وبيانات مؤسساتهم."
                : "Waflo is built around clear actions, low-friction experiences, and a platform foundation that protects merchant accounts and organization data."}
            </p>
          </div>
          <div className="marketing-feature-grid">
            {features.map((feature, index) => (
              <Card className="marketing-feature" key={feature.title}>
                <span className="marketing-feature__number">0{index + 1}</span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-section">
        <div className="marketing-container">
          <div className="marketing-section__heading">
            <h2>{ar ? "للمقاهي والمخابز وأكثر." : "For cafés, bakeries, and beyond."}</h2>
            <p>
              {ar
                ? "سواء كنت تدير مقهى واحداً أو سلسلة فروع، تمنحك Waflo مساحة منظمة لتجهيز تجربة الولاء القادمة."
                : "Whether you run one café or several locations, Waflo gives you an organized place to prepare the loyalty experience ahead."}
            </p>
          </div>
          <div className="marketing-feature-grid">
            <Card className="marketing-feature">
              <span className="marketing-feature__number">
                <Building2 size={22} />
              </span>
              <h3>{ar ? "أنشطة محلية" : "Local businesses"}</h3>
              <p>
                {ar
                  ? "مقاهٍ، صالونات، مطاعم، مغاسل، متاجر وأعمال خدمية."
                  : "Cafés, salons, restaurants, car washes, shops, and service businesses."}
              </p>
            </Card>
            <Card className="marketing-feature">
              <span className="marketing-feature__number">
                <Smartphone size={22} />
              </span>
              <h3>{ar ? "لا تطبيق للعميل" : "No customer app"}</h3>
              <p>
                {ar
                  ? "تنضم التجربة إلى حياة العميل اليومية بدلاً من إضافة تطبيق آخر."
                  : "The experience fits into the customer’s day instead of adding another app."}
              </p>
            </Card>
            <Card className="marketing-feature">
              <span className="marketing-feature__number">
                <CreditCard size={22} />
              </span>
              <h3>{ar ? "فوترة واضحة" : "Clear billing"}</h3>
              <p>
                {ar
                  ? "خطة مختارة وحالة اشتراك وتجربة مجانية تظهر كل منها بوضوح."
                  : "Selected plan, subscription state, and trial status remain clearly distinct."}
              </p>
            </Card>
          </div>
        </div>
      </section>

      <section className="marketing-section">
        <div className="marketing-container marketing-cta">
          <div>
            <h2>{ar ? "اجعل الولاء يتحرك مع نشاطك." : "Make loyalty move with your business."}</h2>
            <p>
              {ar
                ? "ابدأ الإعداد الآن. التجربة المجانية لا تبدأ حتى تنشر أول برنامج ولاء."
                : "Set up now. Your trial will not start until your first loyalty program is published."}
            </p>
          </div>
          <a href={`${dashboardUrl}/${locale}/signup`}>
            <Button>{ar ? "إنشاء حساب تاجر" : "Create merchant account"}</Button>
          </a>
        </div>
      </section>
    </MarketingShell>
  );
}
