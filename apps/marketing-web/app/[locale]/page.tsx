import {
  ArrowRight,
  Check,
  CreditCard,
  Gift,
  MapPin,
  QrCode,
  Sparkles,
  UsersRound,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isInterfaceLocale } from "@waflo/i18n";
import {
  BusinessExplorer,
  FlowStory,
  HeroJourney,
  SidesExplorer,
  WalletDemo,
} from "../../components/landing-interactions";
import { MarketingShell } from "../../components/marketing-shell";
import { marketingCopy } from "../../lib/marketing-copy";
import { createMarketingMetadata, marketingStructuredData } from "../../lib/seo";

const featureIcons = [
  <Gift key="gift" />,
  <QrCode key="qr" />,
  <Sparkles key="sparkles" />,
  <UsersRound key="team" />,
];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return isInterfaceLocale(locale) ? createMarketingMetadata(locale, "home") : {};
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isInterfaceLocale(locale)) notFound();

  const copy = marketingCopy[locale];
  const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "https://dashboard.waflo.app";
  const contactHref = locale === "en" || locale === "ar" ? `/${locale}/contact` : "/en/contact";

  return (
    <MarketingShell locale={locale}>
      <section className="landing-hero" id="product" aria-labelledby="landing-title">
        <div className="marketing-container landing-hero__grid">
          <div className="landing-hero__content">
            <span className="landing-kicker landing-enter landing-enter--one">
              <Sparkles size={14} aria-hidden="true" />
              {copy.hero.eyebrow}
            </span>
            <h1 id="landing-title" className="landing-enter landing-enter--two">
              <span>{copy.hero.titleLine1} </span>
              <strong>{copy.hero.titleLine2}</strong>
            </h1>
            <p className="landing-hero__lede landing-enter landing-enter--three">
              {copy.hero.lede}
            </p>
            <div className="landing-hero__actions landing-enter landing-enter--four">
              <a
                className="wf-button wf-button--primary landing-button"
                href={`${dashboardUrl}/${locale}/signup`}
              >
                {copy.hero.primary}
                <ArrowRight className="landing-inline-arrow" size={17} aria-hidden="true" />
              </a>
              <a className="wf-button wf-button--secondary landing-button" href="#how-it-works">
                {copy.hero.secondary}
              </a>
            </div>
            <p className="landing-trial-note landing-enter landing-enter--four">
              <CreditCard size={15} aria-hidden="true" />
              {copy.hero.note}
            </p>
          </div>
          <div className="landing-enter landing-enter--demo">
            <HeroJourney copy={copy} />
          </div>
        </div>
      </section>

      <section
        className="landing-section landing-flow"
        id="how-it-works"
        aria-labelledby="flow-title"
      >
        <div className="marketing-container">
          <SectionHeading
            eyebrow={copy.flow.eyebrow}
            title={copy.flow.title}
            lede={copy.flow.lede}
            id="flow-title"
          />
          <FlowStory copy={copy} />
        </div>
      </section>

      <section className="landing-section landing-wallet" aria-labelledby="wallet-title">
        <div className="marketing-container landing-wallet__grid">
          <div className="landing-wallet__copy landing-reveal">
            <SectionHeading
              eyebrow={copy.wallet.eyebrow}
              title={copy.wallet.title}
              lede={copy.wallet.lede}
              id="wallet-title"
            />
            <ul className="landing-point-list">
              {copy.wallet.points.map((point, index) => (
                <li key={point.title} className={`landing-reveal landing-reveal--${index + 1}`}>
                  <span>
                    <Check size={16} aria-hidden="true" />
                  </span>
                  <div>
                    <h3>{point.title}</h3>
                    <p>{point.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="landing-reveal landing-reveal--2">
            <WalletDemo copy={copy} />
          </div>
        </div>
      </section>

      <section
        className="landing-section landing-sides"
        id="solutions"
        aria-labelledby="sides-title"
      >
        <div className="marketing-container">
          <SectionHeading
            eyebrow={copy.sides.eyebrow}
            title={copy.sides.title}
            id="sides-title"
            centered
          />
          <div className="landing-reveal">
            <SidesExplorer copy={copy} />
          </div>
        </div>
      </section>

      <section
        className="landing-section landing-features"
        id="features"
        aria-labelledby="features-title"
      >
        <div className="marketing-container">
          <SectionHeading
            eyebrow={copy.features.eyebrow}
            title={copy.features.title}
            id="features-title"
            centered
          />
          <div className="landing-features__grid">
            {copy.features.items.map((feature, index) => (
              <article
                key={feature.title}
                className={`landing-feature landing-reveal landing-reveal--${index + 1}`}
              >
                <span aria-hidden="true">{featureIcons[index]}</span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section landing-business" aria-labelledby="business-title">
        <div className="marketing-container landing-business__grid">
          <div className="landing-reveal">
            <SectionHeading
              eyebrow={copy.business.eyebrow}
              title={copy.business.title}
              lede={copy.business.lede}
              id="business-title"
            />
            <p className="landing-business__aside">
              <MapPin size={16} aria-hidden="true" /> {copy.sides.console.locations}
            </p>
          </div>
          <div className="landing-reveal landing-reveal--2">
            <BusinessExplorer copy={copy} />
          </div>
        </div>
      </section>

      <section className="landing-section landing-faq-section" id="faq" aria-labelledby="faq-title">
        <div className="marketing-container landing-faq-layout">
          <div className="landing-reveal">
            <SectionHeading eyebrow={copy.faq.eyebrow} title={copy.faq.title} id="faq-title" />
          </div>
          <div className="landing-faq landing-reveal landing-reveal--2">
            {copy.faq.items.map((item, index) => (
              <details key={item.question} open={index === 0}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section landing-cta-section" aria-labelledby="cta-title">
        <div className="marketing-container">
          <div className="landing-cta landing-reveal">
            <div>
              <span>{copy.cta.eyebrow}</span>
              <h2 id="cta-title">{copy.cta.title}</h2>
              <p>{copy.cta.lede}</p>
            </div>
            <div className="landing-cta__actions">
              <a className="wf-button wf-button--primary" href={`${dashboardUrl}/${locale}/signup`}>
                {copy.cta.primary}
              </a>
              <Link className="wf-button landing-cta__quiet" href={contactHref}>
                {copy.cta.secondary}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <script type="application/ld+json">
        {JSON.stringify(marketingStructuredData()).replaceAll("<", "\\u003c")}
      </script>
    </MarketingShell>
  );
}

function SectionHeading({
  eyebrow,
  title,
  lede,
  id,
  centered = false,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  id: string;
  centered?: boolean;
}) {
  return (
    <header
      className={`landing-heading${centered ? " landing-heading--centered" : ""} landing-reveal`}
    >
      <span className="landing-kicker">{eyebrow}</span>
      <h2 id={id}>{title}</h2>
      {lede ? <p>{lede}</p> : null}
    </header>
  );
}
