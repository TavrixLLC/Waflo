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
  FileClock,
  Gauge,
  Gift,
  LockKeyhole,
  LogOut,
  MapPin,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiClientError, resetCsrf } from "../lib/api-client";
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
  programs: Gift,
  customers: Users,
  locations: MapPin,
  team: Users,
  analytics: BarChart3,
  billing: CreditCard,
  audit: FileClock,
  settings: Settings,
  security: ShieldCheck,
} as const;

const labels = {
  en: {
    overview: "Overview",
    programs: "Programs",
    customers: "Customers",
    locations: "Locations",
    team: "Team",
    analytics: "Analytics",
    billing: "Billing",
    audit: "Audit",
    settings: "Settings",
    security: "Security",
    logout: "Log out",
  },
  ar: {
    overview: "نظرة عامة",
    programs: "البرامج",
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
}: {
  locale: Locale;
  section: DashboardSection;
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
          />
        )}
      </div>
    );
  }

  const allSections = Object.keys(sectionIcons) as DashboardSection[];
  const accessibleSections =
    membership.role === "STAFF"
      ? allSections.filter((item) =>
          ["overview", "customers", "analytics", "security"].includes(item),
        )
      : membership.role === "MANAGER"
        ? allSections.filter((item) => !["billing", "audit", "settings"].includes(item))
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
}: {
  section: DashboardSection;
  locale: Locale;
  membership: MembershipView;
  onOrganizationChanged: () => Promise<void>;
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
      <ProgramsScreen locale={locale} membership={membership} />
    );
  }
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
