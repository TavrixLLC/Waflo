import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Building2, CreditCard, Smartphone, Sparkles } from "lucide-react";
import Image from "next/image";
import { messages, isLocale } from "@waflo/i18n";
import { Card } from "@waflo/ui";
import { MarketingShell } from "../../components/marketing-shell";
import { createMarketingMetadata, marketingStructuredData } from "../../lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return isLocale(locale) ? createMarketingMetadata(locale, "home") : {};
}

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
            <a
              className="wf-button wf-button--primary marketing-button-link"
              href={`${dashboardUrl}/${locale}/signup`}
            >
              {ar ? "ابدأ تجربتك المجانية" : "Start your free trial"}
            </a>
            <a
              className="wf-button wf-button--secondary marketing-button-link"
              href={`/${locale}/pricing`}
            >
              {ar ? "استكشف الأسعار" : "Explore pricing"}
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
              <Image
                className="marketing-flow__mark"
                src="/brand/waflo-mark-white.svg"
                alt=""
                width={48}
                height={48}
              />
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

      <section className="marketing-section marketing-section--warm" id="features">
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
                <Building2 size={22} aria-hidden="true" />
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
                <Smartphone size={22} aria-hidden="true" />
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
                <CreditCard size={22} aria-hidden="true" />
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

      <section className="marketing-section marketing-section--warm" id="faq">
        <div className="marketing-container">
          <div className="marketing-section__heading">
            <h2>{ar ? "أسئلة شائعة" : "Frequently asked questions"}</h2>
            <p>
              {ar
                ? "إجابات مباشرة عن تجربة الولاء للتاجر والعميل."
                : "Straight answers about the merchant and customer loyalty experience."}
            </p>
          </div>
          <div className="marketing-faq">
            {(ar
              ? [
                  {
                    question: "ما هي Waflo؟",
                    answer:
                      "Waflo منصة ولاء رقمية تساعد الأعمال المحلية على إنشاء بطاقات ولاء وإدارة الفروع والفريق وتقدم العملاء.",
                  },
                  {
                    question: "كيف تعمل بطاقات الولاء؟",
                    answer:
                      "ينضم العميل من الويب ويحصل على بطاقة بعضوية فريدة. يمسح الموظف رمز العضوية لإضافة الأختام أو استبدال المكافأة وفق إعدادات البرنامج.",
                  },
                  {
                    question: "هل يحتاج العميل إلى تثبيت تطبيق؟",
                    answer:
                      "لا. يعمل المسار المعتاد عبر ويب العميل، ويمكن للعميل إضافة البطاقة إلى محفظته الرقمية عندما تكون خدمة المحفظة مهيأة.",
                  },
                  {
                    question: "هل تدعم Waflo ‏Apple Wallet وGoogle Wallet؟",
                    answer:
                      "Waflo مهيأة لإصدار وتحديث بطاقات Apple Wallet وGoogle Wallet. يعتمد التوفر على إعداد مزود الخدمة وبرنامج التاجر.",
                  },
                  {
                    question: "كيف يضيف الموظفون الأختام؟",
                    answer:
                      "يستخدم الموظف المخوّل تطبيق Waflo للموظفين لمسح رمز العضوية ثم تنفيذ إضافة ختم أو استبدال مكافأة.",
                  },
                  {
                    question: "هل يمكن إدارة أكثر من فرع؟",
                    answer:
                      "نعم. تعتمد حدود الفروع ومقاعد الفريق وبرامج الولاء على الخطة المختارة.",
                  },
                ]
              : [
                  {
                    question: "What is Waflo?",
                    answer:
                      "Waflo is a digital loyalty platform that helps local businesses create loyalty cards and manage locations, teams, and customer progress.",
                  },
                  {
                    question: "How do loyalty cards work?",
                    answer:
                      "A customer joins on the web and receives a card with a unique membership. Staff scan its credential to add stamps or redeem a reward under the program rules.",
                  },
                  {
                    question: "Does the customer need to install an app?",
                    answer:
                      "No. The normal customer journey runs through Customer Web, with an option to add the card to a digital wallet when that provider is configured.",
                  },
                  {
                    question: "Does Waflo support Apple Wallet and Google Wallet?",
                    answer:
                      "Waflo is built to issue and update Apple Wallet and Google Wallet passes. Availability depends on provider configuration and the merchant program.",
                  },
                  {
                    question: "How do staff issue stamps?",
                    answer:
                      "Authorized staff use the Waflo Staff app to scan the membership credential, then issue a stamp or redeem a reward.",
                  },
                  {
                    question: "Can a merchant manage multiple locations?",
                    answer:
                      "Yes. Location, team-seat, and loyalty-program limits depend on the selected plan.",
                  },
                ]
            ).map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
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
          <a
            className="wf-button wf-button--primary marketing-button-link"
            href={`${dashboardUrl}/${locale}/signup`}
          >
            {ar ? "إنشاء حساب تاجر" : "Create merchant account"}
          </a>
        </div>
      </section>
      <script
        type="application/ld+json"
        // The static payload contains only visible, verified Waflo organization/site facts.
      >
        {JSON.stringify(marketingStructuredData()).replaceAll("<", "\\u003c")}
      </script>
    </MarketingShell>
  );
}
