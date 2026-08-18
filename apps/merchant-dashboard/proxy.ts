import { NextResponse, type NextRequest } from "next/server";

const interfaceLocalePattern = "(?:en|ar|ku-badini|ku-sorani)";

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
  if (
    !new RegExp(`^${interfaceLocalePattern}$`, "u").test(segments[0] ?? "") ||
    segments[1] !== "dashboard"
  ) {
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
    const preferred = request.cookies.get("waflo_interface_locale")?.value;
    const locale = new RegExp(`^${interfaceLocalePattern}$`, "u").test(preferred ?? "")
      ? preferred
      : "en";
    return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
  }
  if (isInvalidDashboardPath(request.nextUrl.pathname)) {
    const candidate = request.nextUrl.pathname.split("/")[1];
    const locale = new RegExp(`^${interfaceLocalePattern}$`, "u").test(candidate ?? "")
      ? candidate
      : "en";
    return NextResponse.rewrite(new URL(`/${locale}/not-found`, request.url), { status: 404 });
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    "x-waflo-locale",
    new RegExp(`^${interfaceLocalePattern}$`, "u").test(
      request.nextUrl.pathname.split("/")[1] ?? "",
    )
      ? (request.nextUrl.pathname.split("/")[1] ?? "en")
      : "en",
  );
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = { matcher: ["/:path*"] };
