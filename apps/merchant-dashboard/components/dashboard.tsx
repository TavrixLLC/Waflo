"use client";

import type { Locale } from "@waflo/contracts";
import {
  Alert,
  Avatar,
  DropdownMenu,
  MobileNavigation,
  OrganizationSwitcher,
  Sidebar,
  TopNavigation,
} from "@waflo/ui";
import {
  BarChart3,
  CreditCard,
  Download,
  FileClock,
  Gauge,
  LockKeyhole,
  LogOut,
  MapPin,
  MonitorSmartphone,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Users,
  WalletCards,
} from "lucide-react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiClientError, apiFetch, resetCsrf } from "../lib/api-client";
import {
  AuditScreen,
  BillingScreen,
  FutureScreen,
  LocationsScreen,
  OverviewScreen,
  SecurityScreen,
  SettingsScreen,
  TeamScreen,
} from "./dashboard-screens";
import { ProgramsScreen } from "./programs-screen";
import {
  CustomersOperationsScreen,
  DevicesOperationsScreen,
  ExportsOperationsScreen,
  ManagerApprovalsScreen,
  OperationalAnalyticsScreen,
  RiskOperationsScreen,
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
}

const sectionIcons = {
  overview: Gauge,
  programs: WalletCards,
  customers: Users,
  devices: MonitorSmartphone,
  approvals: ShieldCheck,
  risk: ShieldAlert,
  locations: MapPin,
  team: Users,
  analytics: BarChart3,
  exports: Download,
  billing: CreditCard,
  audit: FileClock,
  settings: Settings,
  security: ShieldCheck,
} as const;

const labels = {
  en: {
    overview: "Overview",
    programs: "Loyalty Cards",
    customers: "Customers",
    devices: "Staff devices",
    approvals: "Manager approvals",
    risk: "Risk",
    locations: "Locations",
    team: "Team",
    analytics: "Analytics",
    exports: "Exports",
    billing: "Billing",
    audit: "Audit",
    settings: "Settings",
    security: "Security",
    logout: "Log out",
  },
  ar: {
    devices: "أجهزة الموظفين",
    approvals: "موافقات المدير",
    risk: "المخاطر",
    exports: "التصدير",
    overview: "نظرة عامة",
    programs: "بطاقات الولاء",
    customers: "العملاء",
    locations: "المواقع",
    team: "الفريق",
    analytics: "التحليلات",
    billing: "الفوترة",
    audit: "سجل التدقيق",
    settings: "الإعدادات",
    security: "الأمان",
    logout: "تسجيل الخروج",
  },
} as const;

export type DashboardSection = keyof typeof sectionIcons;

export function DashboardApplication({
  locale,
  section,
  programsView = "library",
  legacyProgramCreate = false,
}: {
  locale: Locale;
  section: DashboardSection;
  programsView?: "library" | "gallery";
  legacyProgramCreate?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<MeView | null>(null);
  const [activeId, setActiveId] = useState<string>("");
  const [error, setError] = useState("");
  const copy = labels[locale];

  const loadMe = useCallback(async () => {
    try {
      const result = await apiFetch<MeView>("/v1/auth/me");
      if (result.memberships.length === 0) {
        router.replace(`/${locale}/onboarding/business`);
        return;
      }
      setMe(result);
      setActiveId(
        result.memberships.some(
          (membership) => membership.organization.id === result.lastSelectedOrganizationId,
        )
          ? (result.lastSelectedOrganizationId ?? result.memberships[0]?.organization.id ?? "")
          : (result.memberships[0]?.organization.id ?? ""),
      );
    } catch (caught) {
      if (
        caught instanceof ApiClientError &&
        (caught.code === "AUTH_REQUIRED" || caught.code === "SESSION_EXPIRED")
      ) {
        router.replace(`/${locale}/session-expired`);
        return;
      }
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : locale === "ar"
            ? "تعذر تحميل لوحة التحكم."
            : "Unable to load the dashboard.",
      );
    }
  }, [locale, router]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const membership = me?.memberships.find((item) => item.organization.id === activeId);

  async function switchOrganization(organizationId: string) {
    if (!me) return;
    await apiFetch(`/v1/organizations/${organizationId}/select`, { method: "POST" });
    setActiveId(organizationId);
  }

  async function logout() {
    await apiFetch("/v1/auth/logout", { method: "POST" });
    resetCsrf();
    router.replace(`/${locale}/logged-out`);
  }

  async function switchLanguage() {
    const target = locale === "ar" ? "en" : "ar";
    await apiFetch("/v1/auth/me", {
      method: "PATCH",
      body: JSON.stringify({ preferredLocale: target }),
    });
    const nextPath = pathname.replace(/^\/(en|ar)/, `/${target}`);
    window.location.assign(nextPath);
  }

  if (!me || !membership) {
    return (
      <div className="dashboard-loading">
        {error ? (
          <Alert tone="danger" title={error} />
        ) : (
          <Image
            src="/brand/waflo-logo-primary-horizontal.svg"
            alt="Waflo"
            width={280}
            height={80}
            loading="eager"
          />
        )}
      </div>
    );
  }

  const allSections = Object.keys(sectionIcons) as DashboardSection[];
  const accessibleSections =
    membership.role === "STAFF"
      ? allSections.filter((item) => ["overview", "security"].includes(item))
      : membership.role === "MANAGER"
        ? allSections.filter((item) => !["billing", "audit", "settings", "exports"].includes(item))
        : allSections;
  const navigation = accessibleSections.map((item) => {
    const Icon = sectionIcons[item];
    return (
      <a
        href={`/${locale}/dashboard${item === "overview" ? "" : `/${item}`}`}
        className={`dashboard-nav-link ${item === section ? "dashboard-nav-link--active" : ""}`}
        key={item}
      >
        <Icon size={18} aria-hidden="true" />
        {copy[item]}
      </a>
    );
  });
  const screen = (
    <DashboardScreen
      section={section}
      locale={locale}
      membership={membership}
      onOrganizationChanged={loadMe}
      programsView={programsView}
      legacyProgramCreate={legacyProgramCreate}
    />
  );

  return (
    <div className="dashboard-layout">
      <Sidebar
        logo={
          <Image src="/brand/waflo-logo-white-horizontal.svg" alt="Waflo" width={280} height={80} />
        }
        organization={
          <OrganizationSwitcher
            label={locale === "ar" ? "تبديل المؤسسة" : "Switch organization"}
            organizations={me.memberships.map((item) => ({
              id: item.organization.id,
              name: item.organization.name,
            }))}
            value={activeId}
            onChange={(id) => void switchOrganization(id)}
          />
        }
        navigation={navigation}
        footer={
          <a className="dashboard-sidebar-user" href={`/${locale}/dashboard/security`}>
            <Avatar name={me.displayName} />
            <span>
              <strong>{me.displayName}</strong>
              <small>{membership.role}</small>
            </span>
          </a>
        }
      />
      <div className="dashboard-main">
        <TopNavigation
          title={copy[section]}
          actions={
            <>
              <MobileNavigation label={locale === "ar" ? "فتح التنقل" : "Open navigation"}>
                {navigation}
              </MobileNavigation>
              <button
                type="button"
                className="wf-language-switcher"
                onClick={() => void switchLanguage()}
              >
                {locale === "ar" ? "English" : "العربية"}
              </button>
              <DropdownMenu label={<Avatar name={me.displayName} />}>
                <a className="dashboard-nav-link" href={`/${locale}/dashboard/security`}>
                  <LockKeyhole size={17} /> {copy.security}
                </a>
                <button type="button" className="dashboard-nav-link" onClick={() => void logout()}>
                  <LogOut size={17} /> {copy.logout}
                </button>
              </DropdownMenu>
            </>
          }
        />
        <main className="dashboard-content">{screen}</main>
      </div>
    </div>
  );
}

function DashboardScreen({
  section,
  locale,
  membership,
  onOrganizationChanged,
  programsView,
  legacyProgramCreate,
}: {
  section: DashboardSection;
  locale: Locale;
  membership: MembershipView;
  onOrganizationChanged: () => Promise<void>;
  programsView: "library" | "gallery";
  legacyProgramCreate: boolean;
}) {
  if (section === "overview") return <OverviewScreen locale={locale} membership={membership} />;
  if (section === "programs") {
    return membership.role === "STAFF" ? (
      <Alert
        title={
          locale === "ar"
            ? "لا يسمح لدورك بفتح استوديو الولاء."
            : "Your role does not allow access to Loyalty Studio."
        }
        tone="danger"
      />
    ) : (
      <ProgramsScreen
        locale={locale}
        membership={membership}
        view={programsView}
        legacyCreate={legacyProgramCreate}
      />
    );
  }
  if (section === "customers")
    return membership.role === "STAFF" ? (
      <MerchantOperationsDenied locale={locale} />
    ) : (
      <CustomersOperationsScreen locale={locale} membership={membership} />
    );
  if (section === "devices")
    return membership.role === "STAFF" ? (
      <MerchantOperationsDenied locale={locale} />
    ) : (
      <DevicesOperationsScreen locale={locale} membership={membership} />
    );
  if (section === "approvals")
    return membership.role === "STAFF" ? (
      <MerchantOperationsDenied locale={locale} />
    ) : (
      <ManagerApprovalsScreen locale={locale} membership={membership} />
    );
  if (section === "risk")
    return membership.role === "STAFF" ? (
      <MerchantOperationsDenied locale={locale} />
    ) : (
      <RiskOperationsScreen locale={locale} membership={membership} />
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
  if (section === "audit") return <AuditScreen locale={locale} membership={membership} />;
  if (section === "settings") {
    return (
      <SettingsScreen
        locale={locale}
        membership={membership}
        onOrganizationChanged={onOrganizationChanged}
      />
    );
  }
  if (section === "security") return <SecurityScreen locale={locale} membership={membership} />;
  return <FutureScreen locale={locale} section={section} />;
}

function MerchantOperationsDenied({ locale }: { locale: Locale }) {
  return (
    <Alert
      tone="danger"
      title={
        locale === "ar"
          ? "يتطلب هذا القسم صلاحيات المدير أو المالك."
          : "This section requires Manager or Owner permission."
      }
    />
  );
}
