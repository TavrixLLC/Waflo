import {
  ArrowRight,
  Check,
  CreditCard,
  Gift,
  MapPin,
  QrCode,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Wallet,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isLocale } from "@waflo/i18n";
import { MarketingShell } from "../../components/marketing-shell";
import { createMarketingMetadata, marketingStructuredData } from "../../lib/seo";

const STAMP_IDS = ["stamp-1", "stamp-2", "stamp-3", "stamp-4", "stamp-5", "stamp-6"] as const;

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
  const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "https://dashboard.waflo.app";

  const flow = ar
    ? [
        ["01", "يزور", "يعود عميلك كما يفعل دائمًا. هذه هي اللحظة التي يبدأ فيها Waflo."],
        ["02", "ينضم", "يمسح رمزًا واحدًا وينضم من الويب من دون تنزيل تطبيق جديد."],
        ["03", "يجمع", "يسجل فريقك الزيارة فتظهر الأختام الممتلئة فورًا على البطاقة."],
        ["04", "يستحق", "عند اكتمال الأختام تصبح المكافأة واضحة وجاهزة للاستخدام."],
        ["05", "يعود", "يستخدم المكافأة وتبدأ دورة جديدة. الولاء يبقى بسيطًا وواضحًا."],
      ]
    : [
        [
          "01",
          "They visit",
          "A customer walks in and buys something. That is the only habit Waflo asks them to keep.",
        ],
        [
          "02",
          "They join",
          "One scan opens the web card. No new customer app and no account maze.",
        ],
        [
          "03",
          "They collect",
          "Your team records the visit and the card shows each filled stamp immediately.",
        ],
        [
          "04",
          "They earn",
          "When the card is full, the reward becomes unmistakable and ready to use.",
        ],
        [
          "05",
          "They return",
          "The reward is used, the next cycle starts empty, and the reason to come back remains.",
        ],
      ];

  const faq = ar
    ? [
        [
          "هل يحتاج العميل إلى تثبيت تطبيق؟",
          "لا. ينضم العميل من الويب ويمكنه حفظ البطاقة في Apple Wallet أو Google Wallet عندما تكون الخدمة متاحة.",
        ],
        [
          "كيف تُسجل الزيارة؟",
          "يمسح الموظف بطاقة العميل من تطبيق الفريق المرتبط بالموقع والصلاحية المناسبة.",
        ],
        ["هل أختار المكافأة؟", "نعم. تضبط عدد الأختام والمكافأة داخل بطاقة الولاء قبل النشر."],
        ["هل تعمل مع أكثر من فرع؟", "نعم. تدير الفروع والفريق من مساحة عمل واحدة وفق حدود باقتك."],
        ["ما اللغات المدعومة؟", "تدعم واجهات Waflo الإنجليزية والعربية بتخطيط RTL أصلي."],
        ["كم تكلف Waflo؟", "توجد باقات Starter وGrowth وScale مع دفع شهري أو ربع سنوي أو سنوي."],
      ]
    : [
        [
          "Do my customers need to install an app?",
          "No. They join on the web and can save the pass to Apple Wallet or Google Wallet when available.",
        ],
        [
          "How does a visit get recorded?",
          "A paired staff device scans the customer card with the location and permissions already known.",
        ],
        [
          "Can I choose the reward?",
          "Yes. Set the stamp goal and reward in the loyalty card before you publish.",
        ],
        [
          "Does it work across more than one location?",
          "Yes. Locations and team members stay together in one workspace, within your plan limits.",
        ],
        [
          "Which languages does Waflo support?",
          "The production experience supports English and Arabic with native RTL layout.",
        ],
        [
          "How much does Waflo cost?",
          "Choose Starter, Growth, or Scale with monthly, quarterly, or yearly billing.",
        ],
      ];

  return (
    <MarketingShell locale={locale}>
      <section className="marketing-hero" id="product">
        <div className="marketing-container marketing-hero__grid">
          <div className="marketing-hero__content">
            <span className="marketing-kicker marketing-enter marketing-enter--one">
              <Sparkles size={14} aria-hidden="true" />
              {ar ? "ولاء بسيط يعود مع العميل" : "A return journey, made visible"}
            </span>
            <h1 className="marketing-enter marketing-enter--two">
              {ar ? (
                <>
                  اجعل كل زيارة <span className="marketing-hero__accent">سببًا للعودة.</span>
                </>
              ) : (
                <>
                  Turn every visit{" "}
                  <span className="marketing-hero__accent">into a reason to return.</span>
                </>
              )}
            </h1>
            <p className="marketing-hero__lead marketing-enter marketing-enter--three">
              {ar
                ? "بطاقة ولاء يعيش عليها عميلك في الويب والمحفظة الرقمية، ومساحة واحدة تدير منها البطاقة والفروع والفريق."
                : "Waflo gives your customers a loyalty card that lives in their phone, while you run the program, locations, and team from one calm place."}
            </p>
            <div className="marketing-hero__actions marketing-enter marketing-enter--four">
              <a
                className="wf-button wf-button--primary marketing-button-link"
                href={`${dashboardUrl}/${locale}/signup`}
              >
                {ar ? "ابدأ مجانًا" : "Start free"}
                <ArrowRight className="marketing-inline-arrow" size={17} aria-hidden="true" />
              </a>
              <a
                className="wf-button wf-button--secondary marketing-button-link"
                href="#how-it-works"
              >
                {ar ? "شاهد كيف تعمل" : "See how it works"}
              </a>
            </div>
            <p className="marketing-trial-note marketing-enter marketing-enter--four">
              <CreditCard size={15} aria-hidden="true" />
              {ar
                ? "7 أيام تجريبية. البطاقة مطلوبة، ولا خصم اليوم."
                : "7-day trial. Payment method required; nothing charged today."}
            </p>
          </div>
          <HeroPass ar={ar} />
        </div>
      </section>

      <section className="marketing-flow marketing-section" id="how-it-works">
        <div className="marketing-container">
          <header className="marketing-section__heading marketing-section__heading--stacked">
            <span className="marketing-kicker">{ar ? "تدفق Waflo" : "The Waflo flow"}</span>
            <h2>{ar ? "بطاقة واحدة، وخمس لحظات." : "One card, five moments."}</h2>
            <p>
              {ar
                ? "الولاء يبدأ بزيارة حقيقية وينتهي بسبب واضح للعودة."
                : "Loyalty stays simple when the card tells the whole return story."}
            </p>
          </header>
          <div className="marketing-flow__layout">
            <ol className="marketing-flow__steps">
              {flow.map(([number, title, body]) => (
                <li key={number}>
                  <span>{number}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
            <div className="marketing-flow__preview">
              <CompactPass ar={ar} />
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-wallet marketing-section">
        <div className="marketing-container marketing-wallet__grid">
          <div>
            <span className="marketing-kicker">{ar ? "المحفظة أولًا" : "Wallet first"}</span>
            <h2>
              {ar
                ? "البطاقة تعيش حيث يوجد الهاتف أصلًا."
                : "The card lives where the phone already is."}
            </h2>
            <p>
              {ar
                ? "لا يحتاج العميل إلى تعلم منتج آخر. تنتقل البطاقة من الويب إلى المحفظة، وتبقى نسخة الويب جاهزة دائمًا."
                : "No customer app to learn. The card moves naturally from the web to the wallet, with the web experience always available."}
            </p>
            <ul>
              <li>
                <Wallet size={17} aria-hidden="true" />{" "}
                {ar ? "إضافة واضحة إلى المحفظة" : "A clear path to the wallet"}
              </li>
              <li>
                <ShieldCheck size={17} aria-hidden="true" />{" "}
                {ar ? "جلسة ويب آمنة ومحددة للتاجر" : "A secure, merchant-scoped web session"}
              </li>
              <li>
                <MapPin size={17} aria-hidden="true" />{" "}
                {ar
                  ? "فروع مشاركة من دون تتبع مباشر"
                  : "Participating locations without live tracking"}
              </li>
            </ul>
          </div>
          <div className="marketing-wallet__phone">
            <CompactPass ar={ar} />
          </div>
        </div>
      </section>

      <section className="marketing-section marketing-control" id="solutions">
        <div className="marketing-container">
          <header className="marketing-section__heading marketing-section__heading--center">
            <span className="marketing-kicker">
              {ar ? "جانبان، تدفق واحد" : "Two sides, one flow"}
            </span>
            <h2>{ar ? "سهل للعميل. واضح لك." : "Effortless for customers. Controlled for you."}</h2>
          </header>
          <div className="marketing-control__grid">
            <article>
              <span>{ar ? "تجربة العميل" : "Customer"}</span>
              <h3>{ar ? "لا شيء جديد ليتعلمه." : "Nothing new to learn."}</h3>
              <CompactPass ar={ar} small />
              <ul>
                <li>
                  <Check size={15} /> {ar ? "الانضمام من الويب" : "Join on the web"}
                </li>
                <li>
                  <Check size={15} /> {ar ? "التقدم ظاهر" : "Progress stays visible"}
                </li>
                <li>
                  <Check size={15} /> {ar ? "المكافأة واضحة" : "Reward state is explicit"}
                </li>
              </ul>
            </article>
            <article>
              <span>{ar ? "مساحة التاجر" : "Merchant"}</span>
              <h3>{ar ? "لا شيء مهم يُترك للتخمين." : "Nothing important left to guess."}</h3>
              <div className="marketing-console-preview">
                <div>
                  <b>{ar ? "بطاقة القهوة" : "Coffee Rewards"}</b>
                  <span>{ar ? "منشورة" : "Published"}</span>
                </div>
                <div>
                  <b>{ar ? "4 من 8 أختام" : "4 of 8 stamps"}</b>
                  <span>{ar ? "المكافأة: قهوة مجانية" : "Reward: Free coffee"}</span>
                </div>
                <div>
                  <b>{ar ? "3 فروع" : "3 locations"}</b>
                  <span>{ar ? "10 مقاعد فريق" : "10 team seats"}</span>
                </div>
              </div>
              <ul>
                <li>
                  <Check size={15} /> {ar ? "حالة الفوترة واضحة" : "Billing state stays visible"}
                </li>
                <li>
                  <Check size={15} /> {ar ? "المواقع مؤكدة" : "Exact locations are confirmed"}
                </li>
                <li>
                  <Check size={15} />{" "}
                  {ar ? "النشر يتحقق تلقائيًا" : "Publishing validates automatically"}
                </li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className="marketing-section marketing-feature-stories" id="features">
        <div className="marketing-container">
          <header className="marketing-section__heading marketing-section__heading--center">
            <span className="marketing-kicker">
              {ar ? "صُممت لطريقة عمل الولاء" : "Built for the way loyalty works"}
            </span>
            <h2>
              {ar ? "مساحة عمل هادئة للعودة الحقيقية." : "A calm workspace for real return visits."}
            </h2>
          </header>
          <div className="marketing-feature-stories__grid">
            <Feature
              icon={<Gift />}
              title={ar ? "ولاء بلا احتكاك" : "Loyalty without friction"}
              body={
                ar
                  ? "بطاقة رقمية بدل تطبيق آخر."
                  : "A digital card instead of another customer app."
              }
            />
            <Feature
              icon={<QrCode />}
              title={ar ? "فريق مرتبط بأمان" : "Your team and the card"}
              body={
                ar
                  ? "ربط الجهاز برمز قصير العمر وصلاحية معروفة."
                  : "Short-lived pairing with a known role and location."
              }
            />
            <Feature
              icon={<UsersRound />}
              title={ar ? "مكافآت تقررها أنت" : "Rewards you decide"}
              body={
                ar
                  ? "تضبط الهدف والمكافأة قبل النشر."
                  : "Set the goal and reward before publishing."
              }
            />
            <Feature
              icon={<MapPin />}
              title={ar ? "فروع وفريق" : "Locations and team"}
              body={
                ar
                  ? "كل العمليات داخل مساحة التاجر نفسها."
                  : "Keep real operations inside the same merchant workspace."
              }
            />
          </div>
        </div>
      </section>

      <section className="marketing-section marketing-businesses">
        <div className="marketing-container marketing-businesses__grid">
          <div>
            <span className="marketing-kicker">
              {ar ? "مصنوع للأماكن التي يعود إليها الناس" : "Made for places people come back to"}
            </span>
            <h2>
              {ar
                ? "ابدأ بالمقهى، واستمر مع أي زيارة تتكرر."
                : "From coffee counters to every repeat visit."}
            </h2>
            <div className="marketing-businesses__tags">
              {(ar
                ? ["المقاهي", "المطاعم", "الصالونات", "المخابز", "التجزئة", "الخدمات"]
                : ["Cafés", "Restaurants", "Salons", "Bakeries", "Retail", "Services"]
              ).map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <div className="marketing-store-state">
              <Image
                src={ar ? "/brand/google-play-badge-ar.png" : "/brand/google-play-badge-en.png"}
                alt={ar ? "احصل عليه من Google Play" : "Get it on Google Play"}
                width={646}
                height={250}
              />
              <span>
                {ar
                  ? "قريباً — رابط المتجر غير متاح بعد"
                  : "Coming soon — store link not yet available"}
              </span>
            </div>
          </div>
          <CompactPass ar={ar} />
        </div>
      </section>

      <section className="marketing-section marketing-faq-section" id="faq">
        <div className="marketing-container marketing-faq-layout">
          <div>
            <span className="marketing-kicker">{ar ? "قبل أن تبدأ" : "Before you start"}</span>
            <h2>{ar ? "أسئلة واضحة، وإجابات مباشرة." : "Questions before you start."}</h2>
          </div>
          <div className="marketing-faq">
            {faq.map(([question, answer], index) => (
              <details key={question} open={index === 0}>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-section">
        <div className="marketing-container marketing-cta">
          <div>
            <span>{ar ? "ابدأ زياراتك القادمة" : "Bring the next visit closer"}</span>
            <h2>{ar ? "امنحهم سببًا آخر للعودة." : "Give them a reason to come back."}</h2>
            <p>
              {ar
                ? "ابدأ بطاقتك الأولى، أضف طريقة الدفع، وابدأ 7 أيام تجريبية."
                : "Set up your card, choose your plan, and start a 7-day trial with nothing charged today."}
            </p>
          </div>
          <div className="marketing-cta__actions">
            <a className="wf-button wf-button--primary" href={`${dashboardUrl}/${locale}/signup`}>
              {ar ? "ابدأ مجانًا" : "Start free"}
            </a>
            <Link className="wf-button marketing-cta__quiet" href={`/${locale}/contact`}>
              {ar ? "تحدث معنا" : "Talk to us"}
            </Link>
          </div>
        </div>
      </section>

      <script type="application/ld+json">
        {JSON.stringify(marketingStructuredData()).replaceAll("<", "\\u003c")}
      </script>
    </MarketingShell>
  );
}

function HeroPass({ ar }: { ar: boolean }) {
  return (
    <div className="marketing-hero-stage marketing-product-reveal" aria-hidden="true">
      <div className="marketing-phone-shell">
        <div className="marketing-phone-shell__screen" />
        <span>{ar ? "في المحفظة" : "In the wallet"}</span>
      </div>
      <div className="marketing-hero-stage__pass">
        <CompactPass ar={ar} />
      </div>
      <span className="marketing-scan-cue">
        <QrCode size={15} /> {ar ? "يمسحها الفريق" : "Staff scans"}
      </span>
      <div className="marketing-stage-rail">
        <span>{ar ? "يزور" : "Visit"}</span>
        <span>{ar ? "يجمع" : "Collect"}</span>
        <span>{ar ? "يعود" : "Return"}</span>
      </div>
    </div>
  );
}

function CompactPass({ ar, small = false }: { ar: boolean; small?: boolean }) {
  return (
    <article className={`marketing-pass${small ? " marketing-pass--small" : ""}`}>
      <div className="marketing-pass__head">
        <span>W</span>
        <div>
          <small>{ar ? "مكافآت القهوة" : "Coffee rewards"}</small>
          <strong>{ar ? "بيت القهوة" : "Coffee House"}</strong>
        </div>
      </div>
      <div className="marketing-pass__stamps">
        {STAMP_IDS.map((stampId, index) => (
          <span className={index < 4 ? "is-filled" : ""} key={stampId}>
            {index < 4 ? <Check size={14} /> : null}
          </span>
        ))}
      </div>
      <div className="marketing-pass__meta">
        <strong>{ar ? "4 من 6 · قهوة مجانية" : "4/6 · Free coffee"}</strong>
        <small>{ar ? "today.waflo.app" : "today.waflo.app"}</small>
      </div>
      <div className="marketing-pass__foot">
        <span>
          <Wallet size={14} /> {ar ? "إضافة للمحفظة" : "Add to wallet"}
        </span>
        <span>{ar ? "السجل" : "History"}</span>
      </div>
    </article>
  );
}

function Feature({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <article className="marketing-feature-card">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}
