"use client";

import { interfaceLanguageGroups, interfaceLocales, type InterfaceLocale } from "@waflo/i18n";
import { InterfaceLanguagePicker } from "@waflo/ui";
import { ArrowRight, Menu, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { marketingCopy } from "../lib/marketing-copy";

const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "https://dashboard.waflo.app";

export function MarketingShell({
  locale,
  path = "",
  children,
}: {
  locale: InterfaceLocale;
  path?: string;
  children: ReactNode;
}) {
  const copy = marketingCopy[locale];
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [condensed, setCondensed] = useState(false);

  const hrefForLocale = useCallback(
    (target: InterfaceLocale) => {
      const targetPath = target.startsWith("ku-") && path ? "" : path;
      return `/${target}${targetPath}`;
    },
    [path],
  );

  useEffect(() => {
    for (const target of interfaceLocales) router.prefetch(hrefForLocale(target.id));
  }, [hrefForLocale, router]);

  useEffect(() => {
    const onScroll = () => setCondensed(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (menuOpen && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    }
    if (!menuOpen && dialog.open) dialog.close();
  }, [menuOpen]);

  const localizedDocument = (documentPath: string) =>
    locale === "en" || locale === "ar" ? `/${locale}${documentPath}` : `/en${documentPath}`;
  const pricingHref = localizedDocument("/pricing");
  const contactHref = localizedDocument("/contact");
  const links = [
    { href: `/${locale}#product`, label: copy.nav.product },
    { href: `/${locale}#how-it-works`, label: copy.nav.how },
    { href: pricingHref, label: copy.nav.pricing },
    { href: `/${locale}#solutions`, label: copy.nav.solutions },
    { href: `/${locale}#faq`, label: copy.nav.faq },
  ];

  function persistLocale(target: InterfaceLocale) {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    // biome-ignore lint/suspicious/noDocumentCookie: Cross-browser persistence for a closed locale union.
    document.cookie = `waflo_interface_locale=${target}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <div className="marketing-shell landing-shell">
      <a className="landing-skip-link" href="#main-content">
        {copy.nav.skip}
      </a>
      <header className={`marketing-navbar${condensed ? " is-condensed" : ""}`}>
        <nav
          className="marketing-container marketing-navbar__inner"
          aria-label={copy.nav.mainLabel}
        >
          <Link
            href={`/${locale}`}
            className="marketing-logo"
            aria-label={`Waflo · ${copy.nav.product}`}
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
            <InterfaceLanguagePicker
              locale={locale}
              hrefForLocale={hrefForLocale}
              persistSelection
              label={copy.footer.language}
              className="landing-language-picker"
              onLocaleChange={(target) => router.push(hrefForLocale(target))}
            />
            <a className="marketing-login-link" href={`${dashboardUrl}/${locale}/login`}>
              {copy.nav.login}
            </a>
            <a
              className="wf-button wf-button--primary marketing-button-link"
              href={`${dashboardUrl}/${locale}/signup`}
            >
              {copy.nav.start}
              <ArrowRight className="landing-inline-arrow" size={16} aria-hidden="true" />
            </a>
            <button
              type="button"
              className="marketing-menu-button"
              aria-label={copy.nav.menu}
              aria-expanded={menuOpen}
              aria-controls="marketing-mobile-dialog"
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={20} aria-hidden="true" />
            </button>
          </div>
        </nav>
      </header>

      <dialog
        ref={dialogRef}
        id="marketing-mobile-dialog"
        className="marketing-mobile-menu"
        aria-labelledby="marketing-mobile-title"
        onCancel={(event) => {
          event.preventDefault();
          closeMenu();
        }}
        onClose={() => setMenuOpen(false)}
      >
        <div className="marketing-mobile-menu__top">
          <Image src="/brand/waflo-logo-white-horizontal.svg" alt="Waflo" width={280} height={80} />
          <h2 id="marketing-mobile-title">{copy.nav.mobileLabel}</h2>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label={copy.nav.close}
            onClick={closeMenu}
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <nav aria-label={copy.nav.mobileLabel}>
          {links.map((link) => (
            <Link key={link.href} href={link.href} onClick={closeMenu}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="marketing-mobile-menu__languages">
          <span>{copy.footer.language}</span>
          <div className="marketing-mobile-menu__language-options">
            {interfaceLocales.map((target) => (
              <Link
                key={target.id}
                href={hrefForLocale(target.id)}
                lang={target.htmlLang}
                aria-current={target.id === locale ? "page" : undefined}
                onClick={() => {
                  persistLocale(target.id);
                  closeMenu();
                }}
              >
                {target.nativeName}
              </Link>
            ))}
          </div>
          <small lang="ku" dir="rtl">
            {interfaceLanguageGroups.kurdish.nativeName}
          </small>
        </div>
        <div className="marketing-mobile-menu__actions">
          <a
            className="wf-button marketing-mobile-menu__primary"
            href={`${dashboardUrl}/${locale}/signup`}
          >
            {copy.nav.start}
          </a>
          <a
            className="wf-button marketing-mobile-menu__secondary"
            href={`${dashboardUrl}/${locale}/login`}
          >
            {copy.nav.login}
          </a>
        </div>
      </dialog>

      <main id="main-content">{children}</main>

      <footer className="marketing-footer">
        <div className="marketing-container marketing-footer__grid">
          <div className="marketing-footer__brand">
            <Image
              src="/brand/waflo-logo-primary-horizontal.svg"
              alt="Waflo"
              width={280}
              height={80}
            />
            <p>{copy.footer.tagline}</p>
            <span className="marketing-footer__label">{copy.footer.language}</span>
            <InterfaceLanguagePicker
              locale={locale}
              hrefForLocale={hrefForLocale}
              persistSelection
              label={copy.footer.language}
              className="landing-language-picker"
              onLocaleChange={(target) => router.push(hrefForLocale(target))}
            />
          </div>
          <FooterColumn
            title={copy.footer.product}
            links={[
              [copy.footer.how, `/${locale}#how-it-works`],
              [copy.footer.wallet, `/${locale}#product`],
              [copy.nav.pricing, pricingHref],
              [copy.footer.business, `/${locale}#solutions`],
            ]}
          />
          <FooterColumn
            title={copy.footer.company}
            links={[
              [copy.footer.contact, contactHref],
              [copy.nav.login, `${dashboardUrl}/${locale}/login`],
            ]}
          />
          <FooterColumn
            title={copy.footer.resources}
            links={[
              [copy.nav.faq, `/${locale}#faq`],
              [copy.nav.pricing, pricingHref],
            ]}
          />
          <FooterColumn
            title={copy.footer.legal}
            links={[
              [copy.footer.terms, localizedDocument("/terms")],
              [copy.footer.privacy, localizedDocument("/privacy")],
              [copy.footer.refunds, localizedDocument("/refunds")],
            ]}
          />
        </div>
        <div className="marketing-container marketing-footer__legal">
          <span>© 2026 Tavrix LLC. {copy.footer.rights}</span>
          <span>{copy.footer.ownedBy}</span>
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
