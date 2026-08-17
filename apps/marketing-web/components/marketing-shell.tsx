"use client";

import type { Locale } from "@waflo/contracts";
import { messages } from "@waflo/i18n";
import { LanguageSwitcher } from "@waflo/ui";
import { ArrowRight, Menu, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "https://dashboard.waflo.app";

export function MarketingShell({
  locale,
  path = "",
  children,
}: {
  locale: Locale;
  path?: string;
  children: ReactNode;
}) {
  const copy = messages[locale];
  const ar = locale === "ar";
  const alternate = ar ? "en" : "ar";
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  const links = [
    { href: `/${locale}#product`, label: ar ? "المنتج" : "Product" },
    { href: `/${locale}#how-it-works`, label: ar ? "كيف تعمل" : "How it works" },
    { href: `/${locale}/pricing`, label: copy.navigation.pricing },
    { href: `/${locale}#solutions`, label: ar ? "لمن تناسب" : "Solutions" },
    { href: `/${locale}#faq`, label: ar ? "الأسئلة" : "FAQ" },
  ];

  return (
    <div className="marketing-shell">
      <header className="marketing-navbar">
        <nav
          className="marketing-container marketing-navbar__inner"
          aria-label={ar ? "التنقل الرئيسي" : "Main"}
        >
          <Link
            href={`/${locale}`}
            className="marketing-logo"
            aria-label={ar ? "صفحة Waflo الرئيسية" : "Waflo home"}
          >
            <Image
              src="/brand/waflo-logo-primary-horizontal.svg"
              alt="Waflo"
              width={280}
              height={80}
              priority
            />
          </Link>

          <ul className="marketing-nav">
            {links.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
          </ul>

          <div className="marketing-actions">
            <LanguageSwitcher locale={locale} href={`/${alternate}${path}`} />
            <a className="marketing-login-link" href={`${dashboardUrl}/${locale}/login`}>
              {copy.navigation.login}
            </a>
            <a
              className="wf-button wf-button--primary marketing-button-link"
              href={`${dashboardUrl}/${locale}/signup`}
            >
              {ar ? "ابدأ الآن" : "Get started"}
              <ArrowRight className="marketing-inline-arrow" size={16} aria-hidden="true" />
            </a>
            <button
              type="button"
              className="marketing-menu-button"
              aria-label={ar ? "فتح القائمة" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={20} aria-hidden="true" />
            </button>
          </div>
        </nav>
      </header>

      {menuOpen ? (
        <div
          className="marketing-mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-label={ar ? "القائمة" : "Menu"}
        >
          <div className="marketing-mobile-menu__top">
            <Image
              src="/brand/waflo-logo-white-horizontal.svg"
              alt="Waflo"
              width={280}
              height={80}
            />
            <button
              type="button"
              aria-label={ar ? "إغلاق القائمة" : "Close menu"}
              onClick={() => setMenuOpen(false)}
            >
              <X size={22} aria-hidden="true" />
            </button>
          </div>
          <nav aria-label={ar ? "قائمة الهاتف" : "Mobile"}>
            {links.map((link) => (
              <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)}>
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="marketing-mobile-menu__actions">
            <LanguageSwitcher locale={locale} href={`/${alternate}${path}`} />
            <a
              className="wf-button marketing-mobile-menu__primary"
              href={`${dashboardUrl}/${locale}/signup`}
            >
              {ar ? "ابدأ الآن" : "Get started"}
            </a>
            <a
              className="wf-button marketing-mobile-menu__secondary"
              href={`${dashboardUrl}/${locale}/login`}
            >
              {copy.navigation.login}
            </a>
          </div>
        </div>
      ) : null}

      <main>{children}</main>

      <footer className="marketing-footer">
        <div className="marketing-container marketing-footer__grid">
          <div className="marketing-footer__brand">
            <Image
              src="/brand/waflo-logo-primary-horizontal.svg"
              alt="Waflo"
              width={280}
              height={80}
            />
            <p>
              {ar
                ? "منصة ولاء رقمية تجعل العملاء يعودون."
                : "A digital loyalty platform for businesses people come back to."}
            </p>
            <span className="marketing-footer__label">{ar ? "اللغة" : "Language"}</span>
            <LanguageSwitcher locale={locale} href={`/${alternate}${path}`} />
          </div>
          <FooterColumn
            title={ar ? "المنتج" : "Product"}
            links={[
              [ar ? "كيف تعمل" : "How it works", `/${locale}#how-it-works`],
              [ar ? "تجربة المحفظة" : "Wallet experience", `/${locale}#product`],
              [copy.navigation.pricing, `/${locale}/pricing`],
              [ar ? "أنواع الأعمال" : "Business types", `/${locale}#solutions`],
            ]}
          />
          <FooterColumn
            title={ar ? "الشركة" : "Company"}
            links={[
              [ar ? "تواصل معنا" : "Contact", `/${locale}/contact`],
              [copy.navigation.login, `${dashboardUrl}/${locale}/login`],
            ]}
          />
          <FooterColumn
            title={ar ? "المصادر" : "Resources"}
            links={[
              [ar ? "الأسئلة" : "FAQ", `/${locale}#faq`],
              [ar ? "الأسعار" : "Pricing", `/${locale}/pricing`],
            ]}
          />
          <FooterColumn
            title={ar ? "قانوني" : "Legal"}
            links={[
              [ar ? "الشروط" : "Terms", `/${locale}/terms`],
              [ar ? "الخصوصية" : "Privacy", `/${locale}/privacy`],
              [ar ? "الفوترة والاسترداد" : "Refund policy", `/${locale}/refunds`],
            ]}
          />
        </div>
        <div className="marketing-container marketing-footer__legal">
          <span>© 2026 Tavrix LLC. {ar ? "جميع الحقوق محفوظة." : "All rights reserved."}</span>
          <span>
            {ar
              ? "Waflo منتج مملوك ومدار بواسطة Tavrix LLC."
              : "Waflo is owned and operated by Tavrix LLC."}
          </span>
        </div>
      </footer>
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div className="marketing-footer__column">
      <h2>{title}</h2>
      {links.map(([label, href]) => (
        <Link href={href} key={`${label}-${href}`}>
          {label}
        </Link>
      ))}
    </div>
  );
}
