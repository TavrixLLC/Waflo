"use client";

import type { Locale } from "@waflo/contracts";
import {
  directionForInterface,
  messages,
  type InterfaceLocale,
  type InterfaceMessages,
} from "@waflo/i18n";
import {
  Alert,
  Avatar,
  DropdownMenu,
  InterfaceLanguagePicker,
  Modal,
  OrganizationSwitcher,
  Sidebar,
} from "@waflo/ui";
import {
  BarChart3,
  CreditCard,
  Download,
  Gauge,
  LockKeyhole,
  LogOut,
  MapPin,
  Menu,
  Settings,
  Users,
  WalletCards,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ApiClientError, apiFetch, resetCsrf } from "../lib/api-client";
import {
  BillingScreen,
  FutureScreen,
  LocationsScreen,
  OverviewScreen,
  SecurityScreen,
  SettingsScreen,
  TeamScreen,
} from "./dashboard-screens";
import { ProgramsScreen } from "./programs-screen";
import type { StudioArea } from "./program-studio-presentation";
import {
  CustomersOperationsScreen,
  ExportsOperationsScreen,
  OperationalAnalyticsScreen,
} from "./w4-operations-screens";

export interface MembershipView {
  id: string;
  role: "OWNER" | "MANAGER" | "STAFF";
  organization: {
    id: string;
    name: string;
    merchantSlug: string;
    defaultLocale: "EN" | "AR";
    selectedPlan: "STARTER" | "GROWTH" | "SCALE";
    onboardingState: "BUSINESS" | "LOCATION" | "COMPLETE";
  };
}

export interface MeView {
  id: string;
  displayName: string;
  email: string;
  preferredLocale: "EN" | "AR";
  lastSelectedOrganizationId: string | null;
  memberships: MembershipView[];
  accountState: {
    email: "unverified" | "verified";
    onboarding:
      | "business_required"
      | "location_required"
      | "billing_identity_required"
      | "payment_method_required"
      | "trial_confirmation_required"
      | "complete";
    billing:
      | "none"
      | "trialing"
      | "active"
      | "past_due_grace"
      | "action_required"
      | "restricted"
      | "canceled"
      | "paused";
    access: "onboarding_only" | "full" | "read_only_billing_recovery";
    organizationId: string | null;
    billingAttention: boolean;
  } | null;
}

type MerchantShellCopy = InterfaceMessages["merchant"]["shell"];
type BillingAttentionCopy = InterfaceMessages["merchant"]["billingAttention"];

function billingAttentionCopy(
  state: NonNullable<MeView["accountState"]>,
  copy: BillingAttentionCopy,
) {
  if (state.billing === "action_required") {
    return {
      message: copy.actionRequiredMessage,
      action: copy.actionRequiredAction,
    };
  }
  if (state.billing === "past_due_grace") {
    return {
      message: copy.pastDueMessage,
      action: copy.pastDueAction,
    };
  }
  if (state.billing === "paused") {
    return {
      message: copy.pausedMessage,
      action: copy.pausedAction,
    };
  }
  if (state.billing === "canceled") {
    return {
      message: copy.canceledMessage,
      action: copy.canceledAction,
    };
  }
  if (state.billing === "none") {
    return {
      message: copy.setupMessage,
      action: copy.setupAction,
    };
  }
  return {
    message: copy.renewalMessage,
    action: copy.renewalAction,
  };
}

const sectionIcons = {
  overview: Gauge,
  programs: WalletCards,
  customers: Users,
  locations: MapPin,
  team: Users,
  analytics: BarChart3,
  exports: Download,
  billing: CreditCard,
  settings: Settings,
  security: LockKeyhole,
} as const;

export type DashboardSection = keyof typeof sectionIcons;

const primarySections: DashboardSection[] = [
  "overview",
  "programs",
  "customers",
  "locations",
  "team",
  "analytics",
  "exports",
  "billing",
];
const accountSections: DashboardSection[] = ["settings", "security"];
const mobilePrimarySections: DashboardSection[] = ["overview", "programs", "customers", "team"];

interface DashboardContextValue {
  /** Route-selected display locale. Structural direction always derives from this metadata. */
  interfaceLocale: InterfaceLocale;
  /** Legacy two-language UI text selection; never use this for structural direction. */
  locale: Locale;
  me: MeView;
  membership: MembershipView;
  reloadMemberships: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

function useDashboard(): DashboardContextValue {
  const context = useContext(DashboardContext);
  if (!context) throw new Error("Dashboard content must be rendered inside DashboardShell.");
  return context;
}

function allowedSections(role: MembershipView["role"]): DashboardSection[] {
  if (role === "STAFF") return ["overview", "security"];
  if (role === "MANAGER") {
    return ["overview", "programs", "customers", "locations", "team", "analytics", "security"];
  }
  return [...primarySections, ...accountSections];
}

function sectionHref(locale: InterfaceLocale, section: DashboardSection): string {
  return `/${locale}/dashboard${section === "overview" ? "" : `/${section}`}`;
}

function DashboardBoot({ copy, error }: { copy: MerchantShellCopy; error: string }) {
  return (
    <div className="dashboard-layout dashboard-layout--boot" aria-busy={!error}>
      <aside className="wf-sidebar dashboard-sidebar-placeholder">
        <Image src="/brand/waflo-logo-white-horizontal.svg" alt="Waflo" width={280} height={80} />
        <div className="dashboard-boot-lines" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </aside>
      <main className="dashboard-main">
        <header className="dashboard-mobile-header">
          <Image
            src="/brand/waflo-logo-primary-horizontal.svg"
            alt="Waflo"
            width={280}
            height={80}
          />
        </header>
        <div className="dashboard-content">
          {error ? (
            <Alert tone="danger" title={error} />
          ) : (
            <div className="dashboard-route-loading" role="status">
              <span className="wf-spinner" aria-hidden="true" />
              {copy.preparingAccount}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export function DashboardShell({
  locale,
  interfaceLocale = locale,
  children,
}: {
  locale: Locale;
  interfaceLocale?: InterfaceLocale;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<MeView | null>(null);
  const [activeId, setActiveId] = useState("");
  const [error, setError] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const copy = messages[interfaceLocale].merchant.shell;
  const attentionCopy = messages[interfaceLocale].merchant.billingAttention;
  const languageCopy = messages[interfaceLocale].language;
  const routeLocale = interfaceLocale;
  const interfaceDirection = directionForInterface(interfaceLocale);

  const loadMe = useCallback(async () => {
    try {
      const result = await apiFetch<MeView>("/v1/auth/me");
      if (result.memberships.length === 0) {
        router.replace(`/${routeLocale}/onboarding/business`);
        return;
      }
      if (result.accountState?.access === "onboarding_only") {
        const query = new URLSearchParams();
        if (result.accountState.organizationId)
          query.set("organization", result.accountState.organizationId);
        query.set("resume", result.accountState.onboarding);
        router.replace(`/${routeLocale}/onboarding/business?${query.toString()}`);
        return;
      }
      const nextActiveId = result.memberships.some(
        (membership) => membership.organization.id === result.lastSelectedOrganizationId,
      )
        ? (result.lastSelectedOrganizationId ?? result.memberships[0]?.organization.id ?? "")
        : (result.memberships[0]?.organization.id ?? "");
      setMe(result);
      setActiveId(nextActiveId);
      setError("");
    } catch (caught) {
      if (
        caught instanceof ApiClientError &&
        (caught.code === "AUTH_REQUIRED" || caught.code === "SESSION_EXPIRED")
      ) {
        router.replace(`/${routeLocale}/session-expired`);
        return;
      }
      setError(caught instanceof ApiClientError ? caught.message : copy.accountLoadFailed);
    }
  }, [copy.accountLoadFailed, routeLocale, router]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);
  useEffect(() => {
    const refresh = () => void loadMe();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [loadMe]);

  const membership = me?.memberships.find((item) => item.organization.id === activeId);
  const sections = useMemo(() => allowedSections(membership?.role ?? "STAFF"), [membership?.role]);

  async function switchOrganization(organizationId: string) {
    if (!me || organizationId === activeId) return;
    await apiFetch(`/v1/organizations/${organizationId}/select`, { method: "POST" });
    await loadMe();
  }

  async function logout() {
    await apiFetch("/v1/auth/logout", { method: "POST" });
    resetCsrf();
    router.replace(`/${routeLocale}/logged-out`);
  }

  async function switchLanguage(target: InterfaceLocale) {
    const suffix = pathname.replace(/^\/(en|ar|ku-badini|ku-sorani)(?=\/|$)/, "");
    const targetPath = `/${target}${suffix || "/dashboard"}`;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    // Cookie Store is not yet available in every supported browser. The value is a closed locale union.
    // biome-ignore lint/suspicious/noDocumentCookie: Browser-compatible persistence for the selected interface locale.
    document.cookie = `waflo_interface_locale=${target}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    if (target === "en" || target === "ar") {
      try {
        await apiFetch("/v1/auth/me", {
          method: "PATCH",
          body: JSON.stringify({ preferredLocale: target }),
        });
      } catch {
        // Route and the interface-locale cookie remain authoritative for this browser.
      }
    }
    router.push(targetPath);
  }

  if (!me || !membership) return <DashboardBoot copy={copy} error={error} />;

  const currentSection =
    sections.find((section) => {
      const href = sectionHref(routeLocale, section);
      return pathname === href || (section !== "overview" && pathname.startsWith(`${href}/`));
    }) ?? "overview";

  function navLink(section: DashboardSection, mobile = false) {
    const Icon = sectionIcons[section];
    return (
      <Link
        href={sectionHref(routeLocale, section)}
        className={`dashboard-nav-link ${currentSection === section ? "dashboard-nav-link--active" : ""}`}
        key={section}
        aria-current={currentSection === section ? "page" : undefined}
        data-mobile={mobile || undefined}
        {...(mobile ? { onClick: () => setMobileMenuOpen(false) } : {})}
      >
        <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
        <span>{copy[section]}</span>
      </Link>
    );
  }

  const desktopPrimary = primarySections.filter((section) => sections.includes(section));
  const desktopAccount = accountSections.filter((section) => sections.includes(section));
  const mobilePrimary = mobilePrimarySections.filter((section) => sections.includes(section));
  const mobileMore = sections.filter((section) => !mobilePrimary.includes(section));

  return (
    <DashboardContext.Provider
      value={{ interfaceLocale, locale, me, membership, reloadMemberships: loadMe }}
    >
      <div className="dashboard-layout" dir={interfaceDirection}>
        <Sidebar
          logo={
            <Link href={`/${routeLocale}/dashboard`} aria-label={copy.overview}>
              <Image
                src="/brand/waflo-logo-primary-horizontal.svg"
                alt="Waflo"
                width={280}
                height={80}
              />
            </Link>
          }
          organization={
            <OrganizationSwitcher
              label={copy.chooseOrganization}
              organizations={me.memberships.map((item) => ({
                id: item.organization.id,
                name: item.organization.name,
              }))}
              value={activeId}
              onChange={(id) => void switchOrganization(id)}
            />
          }
          navigation={
            <>
              <div className="dashboard-nav-group">
                {desktopPrimary.map((item) => navLink(item))}
              </div>
              {desktopAccount.length ? (
                <div className="dashboard-nav-group dashboard-nav-group--account">
                  <span className="dashboard-nav-label">{copy.administration}</span>
                  {desktopAccount.map((item) => navLink(item))}
                </div>
              ) : null}
            </>
          }
          footer={
            <Link className="dashboard-sidebar-user" href={`/${routeLocale}/dashboard/security`}>
              <Avatar name={me.displayName} />
              <span>
                <strong>{me.displayName}</strong>
                <small>{me.email}</small>
              </span>
            </Link>
          }
        />

        <div className="dashboard-main">
          <header className="dashboard-topbar">
            <div className="dashboard-mobile-brand">
              <Image
                src="/brand/waflo-logo-primary-horizontal.svg"
                alt="Waflo"
                width={280}
                height={80}
              />
              <span>{copy[currentSection]}</span>
            </div>
            <div className="dashboard-topbar__actions">
              <InterfaceLanguagePicker
                locale={routeLocale}
                hrefForLocale={(target) => {
                  const suffix = pathname.replace(/^\/(en|ar|ku-badini|ku-sorani)(?=\/|$)/, "");
                  return `/${target}${suffix || "/dashboard"}`;
                }}
                onLocaleChange={switchLanguage}
                label={languageCopy.label}
                className="dashboard-language"
              />
              <DropdownMenu label={<Avatar name={me.displayName} />}>
                <Link className="dashboard-menu-link" href={`/${routeLocale}/dashboard/security`}>
                  <LockKeyhole size={17} aria-hidden="true" /> {copy.security}
                </Link>
                <button type="button" className="dashboard-menu-link" onClick={() => void logout()}>
                  <LogOut size={17} aria-hidden="true" /> {copy.logout}
                </button>
              </DropdownMenu>
            </div>
          </header>

          {me.accountState?.billingAttention ? (
            <div
              className={`billing-attention-banner billing-attention-banner--${me.accountState.access}`}
              role="status"
            >
              <span>{billingAttentionCopy(me.accountState, attentionCopy).message}</span>
              <Link href={`/${routeLocale}/dashboard/billing`}>
                {billingAttentionCopy(me.accountState, attentionCopy).action}
              </Link>
            </div>
          ) : null}

          <main className="dashboard-content">{children}</main>

          <nav className="dashboard-mobile-tabs" aria-label={copy.primaryNavigation}>
            {mobilePrimary.map((item) => navLink(item, true))}
            <button
              type="button"
              className={`dashboard-nav-link ${mobileMenuOpen || mobileMore.includes(currentSection) ? "dashboard-nav-link--active" : ""}`}
              aria-expanded={mobileMenuOpen}
              aria-controls="dashboard-mobile-more"
              aria-haspopup="dialog"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu size={19} strokeWidth={1.75} aria-hidden="true" />
              <span>{copy.more}</span>
            </button>
          </nav>

          <Modal
            open={mobileMenuOpen}
            title={copy.more}
            closeLabel={copy.close}
            onClose={() => setMobileMenuOpen(false)}
            className="dashboard-mobile-more__dialog"
          >
            <nav id="dashboard-mobile-more" className="dashboard-mobile-more__navigation">
              {mobileMore.map((item) => navLink(item, true))}
            </nav>
          </Modal>
        </div>
      </div>
    </DashboardContext.Provider>
  );
}

export function DashboardRoute({
  section,
  programsView = "library",
  legacyProgramCreate = false,
  builderProgramId,
  studioProgramId,
  studioArea,
  changeProgramId,
}: {
  section: DashboardSection;
  programsView?: "library" | "gallery" | "builder" | "studio";
  legacyProgramCreate?: boolean;
  builderProgramId?: string;
  studioProgramId?: string;
  studioArea?: StudioArea;
  changeProgramId?: string;
}) {
  const { interfaceLocale, locale, me, membership, reloadMemberships } = useDashboard();
  if (section === "overview") return <OverviewScreen locale={locale} membership={membership} />;
  if (
    me.accountState?.access === "read_only_billing_recovery" &&
    !["billing", "security", "analytics"].includes(section)
  ) {
    return <BillingRecoveryOnly locale={locale} />;
  }
  if (section === "programs") {
    return membership.role === "STAFF" ? (
      <MerchantOperationsDenied locale={locale} />
    ) : (
      <ProgramsScreen
        interfaceLocale={interfaceLocale}
        locale={locale}
        membership={membership}
        view={programsView}
        legacyCreate={legacyProgramCreate}
        {...(builderProgramId ? { builderProgramId } : {})}
        {...(studioProgramId ? { studioProgramId } : {})}
        {...(studioArea ? { studioArea } : {})}
        {...(changeProgramId ? { changeProgramId } : {})}
      />
    );
  }
  if (section === "customers")
    return membership.role === "STAFF" ? (
      <MerchantOperationsDenied locale={locale} />
    ) : (
      <CustomersOperationsScreen locale={locale} membership={membership} />
    );
  if (section === "analytics")
    return membership.role === "STAFF" ? (
      <MerchantOperationsDenied locale={locale} />
    ) : (
      <OperationalAnalyticsScreen locale={locale} membership={membership} />
    );
  if (section === "exports")
    return membership.role !== "OWNER" ? (
      <MerchantOperationsDenied locale={locale} />
    ) : (
      <ExportsOperationsScreen locale={locale} membership={membership} />
    );
  if (section === "locations") return <LocationsScreen locale={locale} membership={membership} />;
  if (section === "team") return <TeamScreen locale={locale} membership={membership} />;
  if (section === "billing") return <BillingScreen locale={locale} membership={membership} />;
  if (section === "settings") {
    return (
      <SettingsScreen
        locale={locale}
        membership={membership}
        onOrganizationChanged={reloadMemberships}
      />
    );
  }
  if (section === "security") return <SecurityScreen locale={locale} membership={membership} />;
  return <FutureScreen locale={locale} section={section} />;
}

function BillingRecoveryOnly({ locale }: { locale: Locale }) {
  return (
    <div className="dashboard-restricted-state">
      <Alert
        tone="warning"
        title={
          locale === "ar"
            ? "هذا القسم متاح للعرض بعد استعادة الاشتراك"
            : "Restore your subscription to use this section"
        }
      >
        {locale === "ar"
          ? "بياناتك محفوظة. حدّث الفوترة لاستعادة التغييرات والعمليات."
          : "Your data is preserved. Update billing to restore changes and operations."}
      </Alert>
      <Link className="wf-button wf-button--primary" href={`/${locale}/dashboard/billing`}>
        {locale === "ar" ? "فتح الفوترة" : "Open Billing"}
      </Link>
    </div>
  );
}

function MerchantOperationsDenied({ locale }: { locale: Locale }) {
  return (
    <Alert
      tone="danger"
      title={
        locale === "ar"
          ? "لا تملك الصلاحية لفتح هذا القسم."
          : "You do not have permission to open this section."
      }
    />
  );
}
