import { NextResponse, type NextRequest } from "next/server";
import { isInterfaceLocale } from "@waflo/i18n";

export function proxy(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const directHost = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  const publicHost = (forwardedHost?.split(":")[0] ?? directHost)?.toLowerCase();
  const target = request.nextUrl.clone();
  let redirect = false;

  if (publicHost === "www.waflo.app") {
    target.protocol = "https";
    target.hostname = "waflo.app";
    target.port = "";
    redirect = true;
  }
  if (target.pathname === "/") {
    const savedLocale = request.cookies?.get("waflo_interface_locale")?.value ?? "";
    target.pathname = `/${isInterfaceLocale(savedLocale) ? savedLocale : "en"}`;
    redirect = true;
  }
  if (redirect) return NextResponse.redirect(target, 308);
  const requestHeaders = new Headers(request.headers);
  const routeLocale = target.pathname.split("/")[1] ?? "";
  requestHeaders.set("x-waflo-locale", isInterfaceLocale(routeLocale) ? routeLocale : "en");
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/:path*"],
};
