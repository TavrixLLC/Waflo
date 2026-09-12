"use client";

import type { Locale } from "@waflo/contracts";
import { Alert, Badge, Button, Skeleton } from "@waflo/ui";
import {
  Activity,
  BadgeDollarSign,
  CreditCard,
  FileClock,
  Gauge,
  LogOut,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { AdminApiError, adminApi, resetAdminCsrf } from "../lib/admin-api";
import { adminCopy, adminDirection, visibleAdminNavigation } from "../lib/admin-content";

export interface AdminMe {
  publicId: string;
  displayName: string;
  preferredLocale: Locale;
  role: "SUPER_ADMIN" | "PRICING_ADMIN" | "FINANCE" | "SUPPORT" | "READ_ONLY";
  permissions: string[];
  lastLoginAt: string | null;
  session: { createdAt: string; expiresAt: string; lastActiveAt: string };
}

interface AdminOverview {
  status: "operational";
  environment: string;
  release: string;
}

const SessionContext = createContext<{ me: AdminMe; overview: AdminOverview } | null>(null);

const icons = {
  overview: Gauge,
  customers: Users,
  pricing: BadgeDollarSign,
  repricing: FileClock,
  finance: CreditCard,
  stripeHealth: Activity,
  audit: ShieldCheck,
  settings: Settings,
} as const;

export function useAdminSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useAdminSession must be used within AdminShell.");
  return value;
}

export function AdminShell({ locale, children }: { locale: Locale; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const text = adminCopy(locale);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; me: AdminMe; overview: AdminOverview }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let active = true;
    void Promise.all([
      adminApi<AdminMe>("/v1/admin/me"),
      adminApi<AdminOverview>("/v1/admin/overview"),
    ])
      .then(([me, overview]) => {
        if (active) setState({ kind: "ready", me, overview });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (
          error instanceof AdminApiError &&
          ["ADMIN_AUTH_REQUIRED", "ADMIN_SESSION_EXPIRED"].includes(error.code)
        ) {
          router.replace(`/${locale}/login?reason=session`);
          return;
        }
        setState({ kind: "error", message: error instanceof Error ? error.message : text.loading });
      });
    return () => {
      active = false;
    };
  }, [locale, router, text.loading]);

  const navigation = useMemo(
    () => (state.kind === "ready" ? visibleAdminNavigation(state.me.permissions) : []),
    [state],
  );

  async function logout() {
    try {
      await adminApi("/v1/admin/auth/logout", { method: "POST", body: JSON.stringify({}) });
    } catch {
      // The local session is discarded even when the API cannot be reached.
    } finally {
      resetAdminCsrf();
      router.replace(`/${locale}/login`);
    }
  }

  if (state.kind === "loading") {
    return (
      <main className="admin-gate" aria-busy="true">
        <Skeleton height="1rem" />
        <span>{text.loading}</span>
      </main>
    );
  }
  if (state.kind === "error") {
    return (
      <main className="admin-gate">
        <Alert tone="danger" title={state.message} />
      </main>
    );
  }
  return (
    <SessionContext.Provider value={{ me: state.me, overview: state.overview }}>
      <div className="admin-shell" dir={adminDirection(locale)}>
        <aside className="admin-sidebar">
          <div className="admin-wordmark">
            <span aria-hidden="true">W</span>
            <div>
              <strong>{text.product}</strong>
              <small>{text.internal}</small>
            </div>
          </div>
          <nav aria-label={text.internal}>
            {navigation.map((item) => {
              const Icon = icons[item.key];
              const href = `/${locale}${item.href}`;
              const selected = pathname === href;
              return (
                <Link href={href} aria-current={selected ? "page" : undefined} key={item.key}>
                  <Icon size={18} aria-hidden="true" />
                  {text[item.key]}
                </Link>
              );
            })}
          </nav>
          <div className="admin-authority-strip">
            <Badge tone="brand">{state.me.role.replaceAll("_", " ")}</Badge>
            <strong>{state.me.displayName}</strong>
            <small>{state.me.publicId}</small>
            <Button variant="ghost" onClick={() => void logout()}>
              <LogOut size={16} aria-hidden="true" />
              {text.signOut}
            </Button>
          </div>
        </aside>
        <main className="admin-main">{children}</main>
      </div>
    </SessionContext.Provider>
  );
}

export function RequireAdminCapability({
  permission,
  locale,
  children,
}: {
  permission: string;
  locale: Locale;
  children: ReactNode;
}) {
  const { me } = useAdminSession();
  if (!me.permissions.includes(permission)) {
    return <Alert tone="danger" title={adminCopy(locale).forbidden} />;
  }
  return children;
}
