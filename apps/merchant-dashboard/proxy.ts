import { NextResponse, type NextRequest } from "next/server";

const dashboardSections = new Set([
  "overview",
  "programs",
  "customers",
  "locations",
  "team",
  "analytics",
  "exports",
  "billing",
  "settings",
  "security",
  "devices",
]);
const studioAreas = new Set([
  "overview",
  "how-it-works",
  "customers-locations",
  "engagement",
  "launch",
  "settings",
]);

function isInvalidDashboardPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if ((segments[0] !== "en" && segments[0] !== "ar") || segments[1] !== "dashboard") {
    return false;
  }
  const route = segments.slice(2);
  if (route.length === 0) return false;
  if (!dashboardSections.has(route[0] ?? "")) return true;
  if (route[0] !== "programs") return route.length !== 1;
  if (route.length === 1 || (route.length === 2 && route[1] === "new")) return false;
  if (route.length === 2 && route[1]) return false;
  return !(
    route.length === 3 &&
    Boolean(route[1]) &&
    route[1] !== "new" &&
    (route[2] === "edit" || studioAreas.has(route[2] ?? ""))
  );
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/en/login", request.url));
  }
  if (isInvalidDashboardPath(request.nextUrl.pathname)) {
    const locale = request.nextUrl.pathname.split("/")[1] === "ar" ? "ar" : "en";
    return NextResponse.rewrite(new URL(`/${locale}/not-found`, request.url), { status: 404 });
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    "x-waflo-locale",
    request.nextUrl.pathname.split("/")[1] === "ar" ? "ar" : "en",
  );
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = { matcher: ["/:path*"] };
